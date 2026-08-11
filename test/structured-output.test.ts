import { describe, expect, it, vi } from 'vitest';
import { InvalidRequestError, OutputValidationError } from '../src/domain/errors.js';
import { RequestExecutor } from '../src/execution/executor.js';
import { unsupportedSchemaKeywords, validateStructuredOutput } from '../src/execution/structured-output.js';
import type { ProviderAdapter } from '../src/ports/provider.js';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { InMemoryHealthStore } from '../src/stores/memory-health-store.js';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';

const schema = { type: 'object', additionalProperties: false, properties: { answer: { type: 'string', minLength: 1 } }, required: ['answer'] };

function setup(firstOutput: string, secondOutput = '{"answer":"fallback"}', maxCostUsd = 1) {
  const first = { ...defaultModels[0]!, id: 'first', provider: 'first', pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } };
  const second = { ...defaultModels[1]!, id: 'second', provider: 'second', pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 2 } };
  const request = { messages: [{ role: 'user' as const, content: 'answer as JSON' }], maxOutputTokens: 10, responseFormat: { type: 'json-schema' as const, schema }, policy: { maxCostUsd } };
  const route = new DeterministicRouter(new InMemoryModelRegistry([first, second])).decide('structured', request);
  const firstComplete = vi.fn(async () => ({ output: firstOutput, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.001 }, finishReason: 'stop' as const }));
  const secondComplete = vi.fn(async () => ({ output: secondOutput, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.002 }, finishReason: 'stop' as const }));
  const providers: ProviderAdapter[] = [
    { name: 'first', listModels: () => [first], complete: firstComplete, stream: async function* () {} },
    { name: 'second', listModels: () => [second], complete: secondComplete, stream: async function* () {} },
  ];
  const health = new InMemoryHealthStore();
  return { request, route, firstComplete, secondComplete, health, executor: new RequestExecutor(providers, new InMemoryUsageLedger(), health) };
}

describe('structured output validation', () => {
  it('validates nested values and compares object enums independent of key order', () => {
    expect(validateStructuredOutput('{"payload":{"b":2,"a":1}}', { type: 'object', properties: { payload: { enum: [{ a: 1, b: 2 }] } }, required: ['payload'] })).toEqual([]);
    expect(validateStructuredOutput('{"answer":""}', schema)).toContain('$.answer: shorter than minLength');
    expect(unsupportedSchemaKeywords({ type: 'mystery' })).toContain('$.type: invalid JSON Schema type');
    expect(unsupportedSchemaKeywords({ type: 'string', pattern: '(a+)+$' })).toContain("$: unsupported keyword 'pattern'");
  });

  it('escalates to an alternative when JSON is malformed or violates the schema', async () => {
    const { request, route, executor, health, secondComplete } = setup('{"wrong":true}');
    const result = await executor.execute({ requestId: 'structured', request, route, signal: new AbortController().signal });

    expect(result.output).toBe('{"answer":"fallback"}');
    expect(result.provider).toBe('second');
    expect(secondComplete).toHaveBeenCalledOnce();
    expect(health.snapshot().find((entry) => entry.modelId === 'first')).toMatchObject({ successes: 1, failures: 0, consecutiveFailures: 0 });
  });

  it('does not escalate when fallback is disabled', async () => {
    const setupResult = setup('not-json');
    const request = { ...setupResult.request, policy: { ...setupResult.request.policy, allowFallback: false } };
    await expect(setupResult.executor.execute({ requestId: 'structured', request, route: setupResult.route, signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(OutputValidationError);
    expect(setupResult.secondComplete).not.toHaveBeenCalled();
  });

  it('rejects unsupported schema keywords before making a paid provider call', async () => {
    const setupResult = setup('{"answer":"ok"}');
    const request = { ...setupResult.request, responseFormat: { type: 'json-schema' as const, schema: { $ref: '#/$defs/answer', $defs: { answer: { type: 'string' } } } } };
    await expect(setupResult.executor.execute({ requestId: 'structured', request, route: setupResult.route, signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(InvalidRequestError);
    expect(setupResult.firstComplete).not.toHaveBeenCalled();
  });

  it('stops escalation when the next estimate would exceed the total cost ceiling', async () => {
    const setupResult = setup('not-json', '{"answer":"unused"}', 0.00003);
    await expect(setupResult.executor.execute({ requestId: 'structured', request: setupResult.request, route: setupResult.route, signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(OutputValidationError);
    expect(setupResult.secondComplete).not.toHaveBeenCalled();
  });
});

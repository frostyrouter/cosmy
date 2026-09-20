import { describe, expect, it } from 'vitest';
import { DeepSeekV4FlashClassifier } from '../src/providers/deepseek-classifier.js';
import { extractFeatures } from '../src/routing/features.js';

const demandVector = {
  version: 'v1',
  technicalDifficulty: 0.8,
  reasoningDepth: 0.7,
  creativity: 0.2,
  designSkill: 0.1,
  factualPrecision: 0.9,
  qualityRequirement: 0.85,
  ambiguity: 0.4,
  toolComplexity: 0.3,
  contextComplexity: 0.5,
  codingIntensity: 0.9,
  safetyStakes: 0.2,
};

describe('DeepSeek V4 Flash classifier', () => {
  it('requests JSON classification and validates the response', async () => {
    const controller = new AbortController();
    const request = { messages: [{ role: 'user' as const, content: 'Design a TypeScript router' }] };
    const classifier = new DeepSeekV4FlashClassifier({ apiKey: 'secret', http: { request: async (url, init) => {
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      expect(init.signal).toBe(controller.signal);
      expect(init.headers).toMatchObject({ authorization: 'Bearer secret' });
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        model: 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
        tool_choice: { type: 'function', function: { name: 'classify_request' } },
        tools: [{ type: 'function', function: { name: 'classify_request', strict: true } }],
      });
      expect(body.tools[0].function.parameters.additionalProperties).toBe(false);
      expect(body.tools[0].function.parameters.properties.demandVector.properties).toHaveProperty('designSkill');
      expect(body.tools[0].function.parameters.properties.demandVector.properties).not.toHaveProperty('domainSpecialization');
      expect(body.messages[0].content).toContain('call classify_request exactly once');
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'classify_request', arguments: JSON.stringify({ demandVector, deepReasoningRequired: true, confidence: 0.94 }) } }] } }] }), { status: 200 });
    } } });

    const result = await classifier.classify({ request, deterministicFeatures: extractFeatures(request), signal: controller.signal });
    expect(result.demandVector.qualityRequirement).toBe(0.85);
    expect(result.deepReasoningRequired).toBe(true);
    expect(result.classifierMetadata).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash', classifierVersion: 'deepseek-demand-v1' });
  });

  it('rejects structured output outside the capability range', async () => {
    const request = { messages: [{ role: 'user' as const, content: 'hello' }] };
    const payload = { choices: [{ message: { tool_calls: [{ type: 'function', function: {
      name: 'classify_request',
      arguments: JSON.stringify({ demandVector: { ...demandVector, creativity: 1.1 }, deepReasoningRequired: false, confidence: 1 }),
    } }] } }] };
    const classifier = new DeepSeekV4FlashClassifier({
      apiKey: 'secret',
      http: { request: async () => new Response(JSON.stringify(payload), { status: 200 }) },
    });

    await expect(classifier.classify({ request, deterministicFeatures: extractFeatures(request), signal: new AbortController().signal })).rejects.toThrow('failed validation');
  });

  it('rejects oversized classifier input before network IO', async () => {
    let called = false;
    const request = { messages: [{ role: 'user' as const, content: 'too large' }] };
    const classifier = new DeepSeekV4FlashClassifier({ apiKey: 'secret', maxInputChars: 2, http: { request: async () => { called = true; throw new Error('unreachable'); } } });
    await expect(classifier.classify({ request, deterministicFeatures: extractFeatures(request), signal: new AbortController().signal })).rejects.toThrow('exceeds');
    expect(called).toBe(false);
  });

  it('rejects an invalid classifier input bound at configuration time', () => {
    expect(() => new DeepSeekV4FlashClassifier({ apiKey: 'secret', maxInputChars: 0 })).toThrow('positive finite');
  });
});

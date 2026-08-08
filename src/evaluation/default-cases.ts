import type { EvaluationCase } from './harness.js';

export const defaultEvaluationCases: readonly EvaluationCase[] = [
  { id: 'simple-rewrite', tags: ['text', 'cost-sensitive'], request: { messages: [{ role: 'user', content: 'Rewrite this email politely' }], maxOutputTokens: 200 }, acceptableModelIds: ['sim-small-text', 'sim-balanced', 'sim-frontier'] },
  { id: 'technical-debug', tags: ['technical', 'reasoning'], request: { messages: [{ role: 'user', content: 'Debug this TypeScript API and explain the tradeoffs' }], maxOutputTokens: 1_000 }, acceptableModelIds: ['sim-balanced', 'sim-frontier'] },
  { id: 'tool-workflow', tags: ['tools', 'reasoning'], request: { messages: [{ role: 'user', content: 'Analyze the customer account and compare the available actions' }], tools: [{ name: 'lookup_account', inputSchema: { type: 'object' } }], maxOutputTokens: 800 }, acceptableModelIds: ['sim-balanced', 'sim-frontier'] },
  { id: 'structured-answer', tags: ['structured-output'], request: { messages: [{ role: 'user', content: 'Return the answer as JSON' }], responseFormat: { type: 'json-schema', schema: { type: 'object' } }, maxOutputTokens: 400 }, acceptableModelIds: ['sim-small-text', 'sim-balanced', 'sim-frontier'] },
  { id: 'large-context', tags: ['context', 'quality'], request: { messages: [{ role: 'user', content: 'Analyze this attached file and summarize the important findings' }], maxOutputTokens: 2_000, policy: { dataClass: 'confidential' } }, acceptableModelIds: ['sim-balanced', 'sim-frontier'] },
];

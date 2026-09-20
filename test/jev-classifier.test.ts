import { describe, expect, it } from 'vitest';
import { JevClassifier } from '../src/providers/jev-classifier.js';
import { extractFeatures } from '../src/routing/features.js';

const scoreAxes = [
  'technicalDifficulty', 'reasoningDepth', 'creativity', 'designSkill', 'factualPrecision',
  'qualityRequirement', 'ambiguity', 'toolComplexity', 'contextComplexity', 'codingIntensity',
  'safetyStakes',
] as const;

function scoreAnswers(score: number, confidence: number): Record<string, unknown> {
  return Object.fromEntries(scoreAxes.map((axis) => [axis, {
    type: 'score',
    score,
    legend: { 0: 'none', 3: 'low', 6: 'high', 9: 'extreme' },
    confidence,
  }]));
}

describe('Jev classifier', () => {
  it('asks one question per demand axis and validates the response', async () => {
    const controller = new AbortController();
    const request = { messages: [{ role: 'user' as const, content: 'Design a TypeScript router' }] };
    const classifier = new JevClassifier({ apiKey: 'secret', http: { request: async (url, init) => {
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(init.signal).toBe(controller.signal);
      expect(init.headers).toMatchObject({ authorization: 'Bearer secret' });
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('jev-latest');
      expect(body.state).toMatchObject({
        messages: [{ role: 'user', content: 'Design a TypeScript router' }],
        deterministicFacts: { hasTools: false, needsStructuredOutput: false },
      });
      for (const axis of scoreAxes) {
        expect(body.questions[axis]).toMatchObject({ type: 'score' });
        expect(body.questions[axis].criteria).toHaveLength(10);
      }
      expect(body.questions.deepReasoning).toMatchObject({ type: 'noul' });
      expect(Object.keys(body.questions)).toHaveLength(scoreAxes.length + 1);
      const answers = { ...scoreAnswers(7.2, 0.8), technicalDifficulty: { type: 'score', score: 9, confidence: 0.9 }, deepReasoning: { type: 'noul', noul: 0.9 } };
      return new Response(JSON.stringify({ model: 'jev-latest', answers, usage: { input_tokens: 100, output_tokens: 24 } }), { status: 200 });
    } } });

    const result = await classifier.classify({ request, deterministicFeatures: extractFeatures(request), signal: controller.signal });
    expect(result.demandVector.qualityRequirement).toBeCloseTo(0.8);
    expect(result.demandVector.technicalDifficulty).toBe(1);
    expect(result.deepReasoningRequired).toBe(true);
    expect(result.confidence).toBeCloseTo((0.8 * 10 + 0.9) / 11);
    expect(result.classifierMetadata).toEqual({ provider: 'typesafe', model: 'jev-latest', classifierVersion: 'jev-demand-v1' });
  });

  it('marks deep reasoning not required below the noul threshold', async () => {
    const request = { messages: [{ role: 'user' as const, content: 'hello' }] };
    const answers = { ...scoreAnswers(4.5, 0.9), deepReasoning: { type: 'noul', noul: 0.2 } };
    const classifier = new JevClassifier({ apiKey: 'secret', http: { request: async () => new Response(JSON.stringify({ answers }), { status: 200 }) } });
    const result = await classifier.classify({ request, deterministicFeatures: extractFeatures(request), signal: new AbortController().signal });
    expect(result.deepReasoningRequired).toBe(false);
    expect(result.demandVector.creativity).toBeCloseTo(0.5);
  });

  it('rejects malformed answers', async () => {
    const request = { messages: [{ role: 'user' as const, content: 'hello' }] };
    const answers = { ...scoreAnswers(2, 0.8), creativity: { type: 'score', score: 'high' }, deepReasoning: { type: 'noul', noul: 0.1 } };
    const classifier = new JevClassifier({ apiKey: 'secret', http: { request: async () => new Response(JSON.stringify({ answers }), { status: 200 }) } });
    await expect(classifier.classify({ request, deterministicFeatures: extractFeatures(request), signal: new AbortController().signal })).rejects.toThrow('invalid');
  });

  it('rejects oversized classifier input before network IO', async () => {
    let called = false;
    const request = { messages: [{ role: 'user' as const, content: 'too large' }] };
    const classifier = new JevClassifier({ apiKey: 'secret', maxInputChars: 2, http: { request: async () => { called = true; throw new Error('unreachable'); } } });
    await expect(classifier.classify({ request, deterministicFeatures: extractFeatures(request), signal: new AbortController().signal })).rejects.toThrow('exceeds');
    expect(called).toBe(false);
  });

  it('rejects an invalid classifier input bound at configuration time', () => {
    expect(() => new JevClassifier({ apiKey: 'secret', maxInputChars: 0 })).toThrow('positive finite');
  });
});

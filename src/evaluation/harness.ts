import type { ResponseRequest } from '../domain/types.js';
import type { DeterministicRouter } from '../routing/router.js';

export interface EvaluationCase {
  id: string;
  request: ResponseRequest;
  acceptableModelIds: string[];
  tags: string[];
}

export interface EvaluationResult {
  caseId: string;
  passed: boolean;
  selectedModelId?: string;
  selectedProvider?: string;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  quality: number;
  error?: string;
}

export interface EvaluationSummary {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  averageCostUsd: number;
  averageLatencyMs: number;
  averageQuality: number;
  byTag: Record<string, { total: number; passed: number; passRate: number }>;
  results: EvaluationResult[];
}

export function evaluateRouting(router: DeterministicRouter, cases: readonly EvaluationCase[]): EvaluationSummary {
  const results = cases.map((testCase) => {
    try {
      const decision = router.decide(`eval_${testCase.id}`, testCase.request);
      const selected = decision.selected;
      return { caseId: testCase.id, passed: testCase.acceptableModelIds.includes(selected.model.id), selectedModelId: selected.model.id, selectedProvider: selected.model.provider, estimatedCostUsd: selected.estimatedCostUsd, estimatedLatencyMs: selected.estimatedLatencyMs, quality: selected.model.coordinates.quality };
    } catch (error) {
      return { caseId: testCase.id, passed: false, estimatedCostUsd: 0, estimatedLatencyMs: 0, quality: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const totalCases = results.length;
  const passedCases = results.filter((result) => result.passed).length;
  const average = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const byTag: EvaluationSummary['byTag'] = {};
  for (const testCase of cases) for (const tag of testCase.tags) {
    const entry = byTag[tag] ??= { total: 0, passed: 0, passRate: 0 };
    entry.total += 1;
    if (results.find((result) => result.caseId === testCase.id)?.passed) entry.passed += 1;
    entry.passRate = entry.passed / entry.total;
  }
  return { totalCases, passedCases, failedCases: totalCases - passedCases, passRate: totalCases ? passedCases / totalCases : 1, averageCostUsd: average(results.map((result) => result.estimatedCostUsd)), averageLatencyMs: average(results.map((result) => result.estimatedLatencyMs)), averageQuality: average(results.map((result) => result.quality)), byTag, results };
}

export function assertEvaluation(summary: EvaluationSummary, minimumPassRate: number): void {
  if (summary.passRate < minimumPassRate) throw new Error(`Evaluation pass rate ${summary.passRate.toFixed(3)} is below required ${minimumPassRate.toFixed(3)}`);
}

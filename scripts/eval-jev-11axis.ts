#!/usr/bin/env tsx
/**
 * eval-jev-11axis.ts — Evaluate the Jev routing classifier on the 11-axis eval set.
 *
 * - Loads a labeled JSONL eval set (default data/eval-11axis-200.jsonl; ground truth
 *   via HEADS heuristic, validated against src/routing/vector.ts)
 * - Calls the real JevClassifier (POST {TYPESAFE_BASE_URL}/v1/systemone, jev-latest)
 * - Reports valid rate, per-axis MAE, deepReasoningRequired accuracy,
 *   confidence MAE, and perfect-routing rates at 0.10/0.15/0.20/0.25
 *
 * Usage:
 *   set -a; source .env; set +a
 *   npx tsx scripts/eval-jev-11axis.ts --in data/eval-11axis-200.jsonl --out data/eval-report-jev.json
 *   # options: --limit N --concurrency N (default 8) --timeout-ms N (default 20000)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { ProviderError } from '../src/domain/errors.js';
import type { RequestDemandVector, ResponseRequest } from '../src/domain/types.js';
import { JevClassifier } from '../src/providers/jev-classifier.js';
import { extractFeatures } from '../src/routing/features.js';

const AXES = [
  'technicalDifficulty', 'reasoningDepth', 'creativity', 'designSkill', 'factualPrecision',
  'qualityRequirement', 'ambiguity', 'toolComplexity', 'contextComplexity', 'codingIntensity',
  'safetyStakes',
] as const;

interface EvalRecord {
  id: string;
  prompt: string;
  messages: { role: 'user' | 'system' | 'assistant' | 'tool'; content: string }[];
  demandVector: RequestDemandVector;
  deepReasoningRequired: boolean;
  confidence: number;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputPath = arg('in') ?? 'data/eval-11axis-200.jsonl';
const outputPath = arg('out') ?? 'data/eval-report-jev.json';
const limit = Number(arg('limit') ?? 0);
const concurrency = Math.max(1, Number(arg('concurrency') ?? 8));
const timeoutMs = Math.max(1, Number(arg('timeout-ms') ?? 20_000));
const maxAttempts = 3;

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) { console.error('TYPESAFE_API_KEY is required (source .env or export it)'); process.exit(1); }
const classifier = new JevClassifier({
  apiKey,
  ...(process.env.TYPESAFE_BASE_URL ? { baseUrl: process.env.TYPESAFE_BASE_URL } : {}),
  ...(process.env.TYPESAFE_CLASSIFIER_MODEL ? { model: process.env.TYPESAFE_CLASSIFIER_MODEL } : {}),
});

const lines = (await readFile(inputPath, 'utf8')).split('\n').filter((line) => line.trim());
const records: EvalRecord[] = lines.map((line) => JSON.parse(line)).slice(0, limit > 0 ? limit : undefined);
console.log(`Loaded ${records.length} eval records from ${inputPath}`);

interface RowResult {
  id: string;
  prompt: string;
  gt: { demandVector: RequestDemandVector; deepReasoningRequired: boolean; confidence: number };
  pred?: { demandVector: RequestDemandVector; deepReasoningRequired: boolean; confidence: number };
  error?: string;
  elapsed_s: number;
  max_err?: number;
}

async function classifyWithRetry(rec: EvalRecord): Promise<RowResult> {
  const request: ResponseRequest = { messages: rec.messages };
  const features = extractFeatures(request);
  const gt = { demandVector: rec.demandVector, deepReasoningRequired: rec.deepReasoningRequired, confidence: rec.confidence };
  const start = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await classifier.classify({ request, deterministicFeatures: features, signal: AbortSignal.timeout(timeoutMs) });
      return { id: rec.id, prompt: rec.prompt, gt, pred: result, elapsed_s: (Date.now() - start) / 1000 };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError ? error.retryable : true;
      if (!retryable || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return { id: rec.id, prompt: rec.prompt, gt, error: message, elapsed_s: (Date.now() - start) / 1000 };
}

const results: RowResult[] = new Array(records.length);
let cursor = 0;
let completed = 0;
const startAll = Date.now();
await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, async () => {
  while (cursor < records.length) {
    const index = cursor++;
    const rec = records[index]!;
    const row = await classifyWithRetry(rec);
    if (row.pred) {
      row.max_err = Math.max(...AXES.map((axis) => Math.abs(row.pred!.demandVector[axis] - rec.demandVector[axis])));
      console.log(`[${String(index).padStart(3, '0')}] ${rec.id} VALID max_err=${row.max_err.toFixed(3)} deep=${row.pred.deepReasoningRequired === rec.deepReasoningRequired ? 'OK' : 'WRONG'} t=${row.elapsed_s.toFixed(1)}s`);
    } else {
      console.log(`[${String(index).padStart(3, '0')}] ${rec.id} INVALID (${row.error})`);
    }
    results[index] = row;
    completed += 1;
  }
}));
const elapsedAll = (Date.now() - startAll) / 1000;

const total = records.length;
const valid = results.filter((row) => row.pred).length;
const invalidReasons: Record<string, number> = {};
for (const row of results) if (!row.pred) { const key = (row.error ?? 'unknown').slice(0, 80); invalidReasons[key] = (invalidReasons[key] ?? 0) + 1; }

const perAxisAbs = Object.fromEntries(AXES.map((axis) => [axis, [] as number[]]));
const confAbs: number[] = [];
const maxErrs: number[] = [];
let deepCorrect = 0;
let deepTotal = 0;
const thresholds = [0.10, 0.15, 0.20, 0.25];
const perfectCounts = Object.fromEntries(thresholds.map((thr) => [thr, 0]));
results.forEach((row, index) => {
  if (!row.pred) return;
  const rec = records[index]!;
  for (const axis of AXES) perAxisAbs[axis]!.push(Math.abs(row.pred.demandVector[axis] - rec.demandVector[axis]));
  maxErrs.push(row.max_err!);
  confAbs.push(Math.abs(row.pred.confidence - rec.confidence));
  deepTotal += 1;
  if (row.pred.deepReasoningRequired === rec.deepReasoningRequired) deepCorrect += 1;
  for (const thr of thresholds) {
    const confThr = thr <= 0.15 ? thr : 0.2;
    if (row.max_err! < thr && row.pred.deepReasoningRequired === rec.deepReasoningRequired && Math.abs(row.pred.confidence - rec.confidence) < confThr) perfectCounts[thr]! += 1;
  }
});

const mean = (values: number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const perAxisMae = Object.fromEntries(AXES.map((axis) => [axis, mean(perAxisAbs[axis]!)]));
const allAxisErrors = AXES.flatMap((axis) => perAxisAbs[axis]!);
const summary = {
  model: classifier.name,
  dataset: inputPath,
  total,
  valid,
  invalid: total - valid,
  valid_rate: total ? valid / total : 0,
  deep_accuracy: deepTotal ? deepCorrect / deepTotal : null,
  deep_correct: deepCorrect,
  deep_total: deepTotal,
  per_axis_mae: perAxisMae,
  overall_mae: mean(allAxisErrors),
  conf_mae: mean(confAbs),
  avg_max_err: mean(maxErrs),
  perfect_counts: perfectCounts,
  perfect_rates: Object.fromEntries(thresholds.map((thr) => [String(thr), total ? perfectCounts[thr]! / total : 0])),
  invalid_reasons: invalidReasons,
  elapsed_all_s: elapsedAll,
  avg_per_query_s: total ? elapsedAll / total : 0,
};

console.log('\n' + '='.repeat(70));
console.log(`EVAL DONE ${valid}/${total} valid (${((valid / total) * 100).toFixed(1)}%)`);
if (valid) {
  console.log(`Overall MAE ${summary.overall_mae!.toFixed(3)} avg_max_err ${summary.avg_max_err!.toFixed(3)} conf_mae ${summary.conf_mae!.toFixed(3)} deep_acc ${(summary.deep_accuracy! * 100).toFixed(1)}%`);
  for (const thr of thresholds) console.log(`  perfect <${thr.toFixed(2)} : ${perfectCounts[thr]}/${total} = ${((perfectCounts[thr]! / total) * 100).toFixed(2)}%`);
}
console.log('='.repeat(70));

await writeFile(outputPath, JSON.stringify({ summary, results }, null, 2));

const mdPath = outputPath.replace(/\.json$/u, '.md');
const md: string[] = [
  `# Jev Classifier Eval — 11-axis (${total} queries)`,
  '',
  `**Model:** \`${classifier.name}\` via TypeSafe \`/v1/systemone\` — 11 parallel Score questions (10-level rubric, normalized /9) + 1 Noul (deepReasoning, threshold 0.5), single call per query.`,
  `**Dataset:** \`${inputPath}\` — ${total} eval queries (ground truth via HEADS heuristic validated against \`src/routing/vector.ts\`)`,
  `**Date:** ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  '## Summary',
  '',
  `- **Total queries:** ${total}`,
  `- **Valid classifications:** ${valid}/${total} = ${((valid / total) * 100).toFixed(1)}%`,
  `- **Invalid rate:** ${(((total - valid) / total) * 100).toFixed(1)}% — reasons: ${JSON.stringify(invalidReasons)}`,
];
if (valid) {
  md.push(
    `- **Overall MAE (11 axes):** ${summary.overall_mae!.toFixed(3)}`,
    `- **Avg max per-query error:** ${summary.avg_max_err!.toFixed(3)}`,
    `- **Confidence MAE:** ${summary.conf_mae!.toFixed(3)}`,
    `- **deepReasoningRequired accuracy:** ${(summary.deep_accuracy! * 100).toFixed(1)}% (${deepCorrect}/${deepTotal})`,
  );
  for (const thr of thresholds) md.push(`- **Perfect routing <${thr.toFixed(2)} (all 11 axes + deep + conf):** ${perfectCounts[thr]}/${total} = ${((perfectCounts[thr]! / total) * 100).toFixed(1)}%`);
  md.push('', '### Per-axis MAE', '', '| axis | MAE |', '|------|-----|');
  for (const axis of AXES) md.push(`| ${axis} | ${perAxisMae[axis] === null ? '—' : perAxisMae[axis]!.toFixed(3)} |`);
}
md.push('', '## Timing', '', `- Total wall ${elapsedAll.toFixed(1)}s, avg ${(elapsedAll / total).toFixed(2)}s/query at concurrency ${concurrency}`, '', `*Full JSON at \`${outputPath}\`*`, '');
await writeFile(mdPath, md.join('\n'));
console.log(`Wrote ${outputPath} and ${mdPath}`);

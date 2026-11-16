#!/usr/bin/env npx tsx
/**
 * build-router-dataset.ts — Node counterpart to build-router-dataset.py
 * Emits the same 11-axis JSONL (Zod-validated) without Python deps.
 * Good for CI dry-runs: `npx tsx scripts/build-router-dataset.ts --limit 200 --dry-run`
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { parseRequestClassification } from '../src/routing/vector.js';

type DemandVector = {
  version: 'v1';
  technicalDifficulty: number;
  reasoningDepth: number;
  creativity: number;
  designSkill: number;
  factualPrecision: number;
  qualityRequirement: number;
  ambiguity: number;
  toolComplexity: number;
  contextComplexity: number;
  codingIntensity: number;
  safetyStakes: number;
};

const SYSTEM_PROMPT =
  'You are the semantic classifier for an AI model router. Analyze the supplied request and call classify_request exactly once. Every numeric field must be a finite number from 0 to 1. Scores represent the minimum capability demanded by the request, not the quality of your own answer. designSkill measures the need for visual hierarchy, layout, typography, interaction patterns, and coherent design-language execution; score it independently from open-ended creativity. Set deepReasoningRequired only when deliberate multi-step reasoning materially improves correctness. Do not answer the request.';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

const pat = {
  codeBlock: /```|^ *(?:function|class|import |export |const |let |var |def |fn |SELECT |INSERT |FROM |WHERE )\b/m,
  inlineCode: /`[^`]+`/,
  lang: /\b(typescript|javascript|python|rust|go|java|sql|api|sdk|schema|database|kubernetes|terraform|docker|react|next\.js|fastify|postgres|redis|graphql|openapi)\b/gi,
  creative: /\b(imagine|story|poem|creative|metaphor|brainstorm|tagline|fiction|character|beautiful|playful|moodboard|narrative|illustration)\b/gi,
  reasoning: /\b(compare|analyze|tradeoff|derive|prove|why|design|optimize|debug|evaluate|reason|step-by-step|chain-of-thought|architecture|refactor|algorithm|complexity)\b/gi,
  design: /\b(layout|typography|visual hierarchy|interaction|design system|component|grid|spacing|color palette|figma|css|tailwind|responsive|accessibility|a11y|ux|ui\b|wireframe|mockup|brand)\b/gi,
  factual: /\b(factual|accurate|precise|cite|source|verify|evidence|grounded|based on|according to|research|benchmark|metric)\b/gi,
  stakes: /\b(medical|legal|financial|contract|payment|pii|privacy|confidential|restricted|production|deploy|migrate|irreversible|delete|refund)\b/gi,
  ambiguity: /\b(whatever|something|somehow|maybe|possibly|unclear|vague|not sure|help|any|etc\.|stuff|things)\b/gi,
  multistep: /\b(first|then|after that|next|finally|step \d|phase|plan|roadmap|migrate|cascade|fallback|retry|escalat)\b/gi,
};

function countRe(text: string, re: RegExp): number {
  const r = new RegExp(re.source, re.flags);
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) n++;
  return n;
}
const hasCode = (t: string) => pat.codeBlock.test(t) || pat.inlineCode.test(t);
const wordCount = (t: string) => Math.max(1, (t.match(/\S+/g) || []).length);
const norm = (c: number, words: number, scale = 25) => clamp01(c / Math.max(1, words / scale));

const HEADS: Record<keyof Omit<DemandVector, 'version'>, { bias: number; w: number[] }> = {
  technicalDifficulty: { bias: -1.2, w: [3.2, -0.8, 0.6, -0.4, 0.2, 0, -0.5, 0.4, 1.8, 0.7, 0.3, 0.4, 0.2, 0.2] },
  reasoningDepth: { bias: -1.0, w: [0.5, -0.6, 3.0, 0.2, 0.4, 0.3, -0.4, 1.2, 0.3, 0.6, 0.4, 0.3, 0.5, 0.3] },
  creativity: { bias: -1.4, w: [-0.6, 3.4, -0.4, 0.6, -0.3, -0.2, 0.2, -0.2, -0.2, -0.2, -0.1, -0.1, 0.2, 0] },
  designSkill: { bias: -1.6, w: [-0.4, 0.8, 0.2, 3.6, 0.1, -0.1, -0.2, -0.2, 0.1, -0.1, 0.1, 0, 0.1, 0] },
  factualPrecision: { bias: -0.9, w: [0.2, -0.4, 0.3, -0.2, 3.0, 0.6, -0.6, 0.1, 0, 0.5, 0.9, 0.2, 0.3, 0.1] },
  qualityRequirement: { bias: -0.6, w: [0.4, 0.3, 0.5, 0.3, 0.5, 0.7, -0.3, 0.3, 0.2, 0.4, 0.3, 0.6, 0.8, 0.2] },
  ambiguity: { bias: -1.1, w: [-0.5, -0.3, -0.5, -0.3, -0.6, -0.2, 3.2, -0.8, -0.4, -0.3, -0.4, -0.4, -0.3, -0.2] },
  toolComplexity: { bias: -1.3, w: [0.6, -0.2, 0.5, -0.1, 0.2, 0.2, -0.3, 0.8, 0.2, 2.2, 0.6, 0.3, 0.2, 0.5] },
  contextComplexity: { bias: -1.0, w: [0.2, 0, 0.3, 0, 0.1, 0.1, 0.1, 0.4, 0.1, 0.3, 0.2, 1.6, 0.6, 1.0] },
  codingIntensity: { bias: -1.5, w: [1.6, -0.6, 0.4, -0.3, -0.1, 0, -0.4, 0.2, 2.4, 0.5, 0.2, 0.2, 0.1, 0.1] },
  safetyStakes: { bias: -1.8, w: [0.1, -0.2, 0.1, -0.1, 0.4, 3.4, -0.2, 0.1, 0, 0.2, 0.2, 0.3, 0.4, 0.1] },
};
function scoreHead(head: { bias: number; w: number[] }, feats: number[]) {
  let logit = head.bias;
  for (let i = 0; i < head.w.length; i++) logit += head.w[i]! * (feats[i] ?? 0);
  return sigmoid(logit);
}
function buildFeats(text: string, hasTools = false, hasStructured = false, inputTokens?: number, messageCount = 1, maxOutputTokens = 1000) {
  const words = wordCount(text);
  const feats = [
    norm(countRe(text, pat.lang) + (pat.lang.test(text) ? 0.5 : 0) + (hasCode(text) ? 1 : 0), words),
    norm(countRe(text, pat.creative), words),
    norm(countRe(text, pat.reasoning), words),
    norm(countRe(text, pat.design), words),
    norm(countRe(text, pat.factual), words),
    norm(countRe(text, pat.stakes), words),
    norm(countRe(text, pat.ambiguity), words),
    norm(countRe(text, pat.multistep), words),
    hasCode(text) ? 1 : 0,
    hasTools ? 1 : 0,
    hasStructured ? 1 : 0,
    (inputTokens ?? words * 1.3) > 800 ? 1 : (inputTokens ?? words * 1.3) > 300 ? 0.5 : 0,
    maxOutputTokens > 3000 ? 1 : maxOutputTokens > 1200 ? 0.5 : 0,
    messageCount > 3 ? 1 : messageCount > 1 ? 0.5 : 0,
  ];
  return { feats, words };
}
function classify(text: string, feats: number[], words: number, hasTools: boolean) {
  const axes: Omit<DemandVector, 'version'> = {
    technicalDifficulty: scoreHead(HEADS.technicalDifficulty, feats),
    reasoningDepth: scoreHead(HEADS.reasoningDepth, feats),
    creativity: scoreHead(HEADS.creativity, feats),
    designSkill: scoreHead(HEADS.designSkill, feats),
    factualPrecision: scoreHead(HEADS.factualPrecision, feats),
    qualityRequirement: scoreHead(HEADS.qualityRequirement, feats),
    ambiguity: scoreHead(HEADS.ambiguity, feats),
    toolComplexity: scoreHead(HEADS.toolComplexity, feats),
    contextComplexity: scoreHead(HEADS.contextComplexity, feats),
    codingIntensity: scoreHead(HEADS.codingIntensity, feats),
    safetyStakes: scoreHead(HEADS.safetyStakes, feats),
  };
  if (words < 6 && (feats[0] ?? 0) < 0.1 && (feats[2] ?? 0) < 0.1 && !hasCode(text) && !hasTools) {
    for (const k of Object.keys(axes) as Array<keyof typeof axes>) {
      if (k === 'ambiguity') continue;
      axes[k] = Math.min(axes[k]!, 0.25);
    }
    axes.ambiguity = Math.max(axes.ambiguity!, 0.35);
    axes.qualityRequirement = Math.min(axes.qualityRequirement!, 0.35);
  }
  const demandVector: DemandVector = { version: 'v1', ...Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, clamp01(v)])) as Omit<DemandVector, 'version'> };
  const deep = demandVector.reasoningDepth > 0.55 || demandVector.codingIntensity > 0.62 || (demandVector.technicalDifficulty > 0.68 && demandVector.reasoningDepth > 0.45) || /step[- ]by[- ]step|chain of thought|think through|prove|algorithm|optimize|refactor/i.test(text);
  const vals = Object.values(axes);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const std = Math.sqrt(variance);
  let confidence = clamp01(0.62 + std * 1.1 - axes.ambiguity! * 0.25);
  if (words < 8) confidence = Math.min(confidence, 0.72);
  if (hasCode(text) || hasTools || pat.design.test(text)) confidence = Math.min(1, confidence + 0.08);
  confidence = Math.round(confidence * 100) / 100;
  return { demandVector, deepReasoningRequired: deep, confidence };
}

function makeRecord(id: string, prompt: string, meta: Record<string, string>, feats: number[], words: number, overrides?: Partial<Omit<DemandVector, 'version'>>, hasTools = false) {
  let { demandVector, deepReasoningRequired, confidence } = classify(prompt, feats, words, hasTools);
  if (overrides) {
    for (const [k, v] of Object.entries(overrides) as Array<[keyof Omit<DemandVector, 'version'>, number]>) demandVector[k] = clamp01(v);
    deepReasoningRequired = demandVector.reasoningDepth > 0.55 || demandVector.codingIntensity > 0.62 || deepReasoningRequired;
  }
  const rec = { id, prompt, messages: [{ role: 'user', content: prompt }], demandVector, deepReasoningRequired, confidence, meta };
  // Zod validate (throws if drift)
  parseRequestClassification({ demandVector, deepReasoningRequired, confidence, classifierMetadata: { provider: 'synthetic', model: 'blend-v1', classifierVersion: '11axis-v1' } });
  return rec;
}

// synthetic blend that exercises all 11 axes (for --dry-run / offline CI)
const SYNTHETIC: Array<[string, Record<string, string>, Partial<Omit<DemandVector, 'version'>>?]> = [
  ['Write a Python function to reverse a string', { source: 'synthetic/nvidia', license: 'CC0' }, { codingIntensity: 0.92, technicalDifficulty: 0.62, reasoningDepth: 0.28 }],
  ['Create a responsive SaaS dashboard with visual hierarchy, typography, spacing, and color palette', { source: 'synthetic/uicrit', license: 'CC0' }, { designSkill: 0.88, creativity: 0.18 }],
  ['Write a poem about autumn leaves with vivid metaphors and playful rhythm', { source: 'synthetic/promptbank', license: 'CC0' }, { creativity: 0.88, designSkill: 0.11, reasoningDepth: 0.22 }],
  ['Brainstorm 10 taglines for a fintech startup targeting millennials', { source: 'synthetic/promptbank', license: 'CC0' }, { creativity: 0.82, designSkill: 0.14 }],
  ['Fix the Figma auto-layout spacing and fix typography scale for mobile breakpoints', { source: 'synthetic/uicrit', license: 'CC0' }, { designSkill: 0.91, creativity: 0.21, technicalDifficulty: 0.52 }],
  ['Delete all user data and refund without audit trail', { source: 'synthetic/rail', license: 'CC0' }, { safetyStakes: 0.93 }],
  ['Design a lock-free concurrent queue with ABA prevention for a real-time trading system', { source: 'synthetic/anasnassar', license: 'CC0' }, { technicalDifficulty: 0.92, reasoningDepth: 0.88, codingIntensity: 0.95 }],
  ['What is the capital of France?', { source: 'synthetic/atekrugis', license: 'CC0' }, { factualPrecision: 0.55, qualityRequirement: 0.32 }],
  ['Compare microservices vs monolith for a startup', { source: 'synthetic/nvidia', license: 'CC0' }, { reasoningDepth: 0.62, technicalDifficulty: 0.58 }],
  ['Fix this React error: Cannot read properties of undefined', { source: 'synthetic/atekrugis', license: 'CC0' }, { codingIntensity: 0.88 }],
  ['Summarize this paragraph: Hugging Face hosts models and datasets.', { source: 'synthetic/atekrugis', license: 'CC0' }, { qualityRequirement: 0.32 }],
  ['Plan a research project comparing small LMs on math reasoning', { source: 'synthetic/nvidia', license: 'CC0' }, { reasoningDepth: 0.72, qualityRequirement: 0.78 }],
  ['Explain how DNS works with citations and verify sources', { source: 'synthetic/nvidia', license: 'CC0' }, { factualPrecision: 0.85, reasoningDepth: 0.55 }],
  ['Call the lookup tool with {"query":"weather in Paris"} and return structured JSON', { source: 'synthetic/tool', license: 'CC0' }, { toolComplexity: 0.88, factualPrecision: 0.72 }],
  ['hello', { source: 'synthetic/hello', license: 'CC0' }, {}],
];

function args() {
  const m = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[++i]! : 'true';
      m.set(k, v);
    }
  }
  return m;
}

async function main() {
  const a = args();
  if (a.has('to-sft')) {
    const inp = a.get('in') ?? 'data/router-11axis.jsonl';
    const out = a.get('out') ?? 'data/gemma-sft.jsonl';
    const raw = readFileSync(inp, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const lines = raw.map((r: any) => {
      const user_content = JSON.stringify({ messages: [{ role: 'user', content: r.prompt }], tools: [], responseFormat: 'text', stream: false, requestedOutputTokens: 1000, deterministicFacts: { inputTokens: Math.max(1, Math.ceil(r.prompt.length / 4)), messageCount: 1, modalities: ['text'], hasTools: false, needsStructuredOutput: false, needsStreaming: false } });
      const assistant_content = JSON.stringify({ demandVector: r.demandVector, deepReasoningRequired: r.deepReasoningRequired, confidence: r.confidence });
      return JSON.stringify({ messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user_content }, { role: 'assistant', content: assistant_content }], text: `<start_of_turn>user\n${user_content}<end_of_turn>\n<start_of_turn>model\n${assistant_content}<end_of_turn>` });
    });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, lines.join('\n') + '\n');
    console.log(`Wrote ${lines.length} SFT records to ${out}`);
    return;
  }

  const limit = a.has('limit') ? Number(a.get('limit')) : 0;
  const dryRun = a.has('dry-run');
  const out = a.get('out') ?? 'data/router-11axis.jsonl';
  const splitsStr = a.get('splits') ?? '0.8,0.1,0.1';
  const seed = Number(a.get('seed') ?? 42);

  let recs: any[] = [];
  if (dryRun) {
    console.log('dry-run: synthetic blend exercising all 11 axes');
    for (let i = 0; i < SYNTHETIC.length; i++) {
      const [prompt, meta, overrides] = SYNTHETIC[i]!;
      const { feats, words } = buildFeats(prompt, (overrides as any)?.toolComplexity > 0.6);
      recs.push(makeRecord(`synthetic-${String(i).padStart(4, '0')}`, prompt, { ...meta, original_label: 'synthetic', mapping: 'synthetic sample' }, feats, words, overrides as any, (overrides as any)?.toolComplexity > 0.6));
    }
    // pad to ~60 rows with hellos for low-end calibration
    for (let i = 0; i < 15; i++) {
      const { feats, words } = buildFeats('hello');
      recs.push(makeRecord(`hello-${String(i).padStart(4, '0')}`, 'hello', { source: 'synthetic/hello', original_label: 'LOW', mapping: 'greeting clamp', license: 'CC0' }, feats, words));
    }
  } else {
    // In full mode without Python HF hub, still emit synthetic but note to use Python builder for real HF blend
    console.log('Node builder without HF hub — emitting synthetic blend. For full HF blend with 40K rows, run: python scripts/build-router-dataset.py');
    for (let i = 0; i < SYNTHETIC.length; i++) {
      const [prompt, meta, overrides] = SYNTHETIC[i]!;
      const { feats, words } = buildFeats(prompt, (overrides as any)?.toolComplexity > 0.6);
      recs.push(makeRecord(`synthetic-${String(i).padStart(4, '0')}`, prompt, { ...meta, original_label: 'synthetic', mapping: 'synthetic sample' }, feats, words, overrides as any, (overrides as any)?.toolComplexity > 0.6));
    }
  }

  if (limit && recs.length > limit) recs = recs.slice(0, limit);

  // dedupe
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const r of recs) {
    const h = createHash('sha256').update(r.prompt.trim().toLowerCase()).digest('hex').slice(0, 16);
    if (seen.has(h)) continue;
    seen.add(h);
    deduped.push(r);
  }
  recs = deduped;

  // shuffle with seed
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = recs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [recs[i], recs[j]] = [recs[j]!, recs[i]!];
  }

  const splits = splitsStr.split(',').map(Number);
  const n = recs.length;
  const nTrain = Math.floor(n * splits[0]!);
  const nVal = Math.floor(n * splits[1]!);
  const train = recs.slice(0, nTrain);
  const val = recs.slice(nTrain, nTrain + nVal);
  const test = recs.slice(nTrain + nVal);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(dirname(out), 'router-11axis.train.jsonl'), train.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(dirname(out), 'router-11axis.val.jsonl'), val.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(dirname(out), 'router-11axis.test.jsonl'), test.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((x, y) => x + y, 0) / a.length;
    const mb = b.reduce((x, y) => x + y, 0) / b.length;
    const num = a.reduce((s, x, i) => s + (x - ma) * (b[i]! - mb), 0);
    const da = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0));
    const db = Math.sqrt(b.reduce((s, y) => s + (y - mb) ** 2, 0));
    return da && db ? num / (da * db) : 0;
  };
  const report = {
    total: n,
    train: train.length,
    val: val.length,
    test: test.length,
    axis_means: Object.fromEntries((Object.keys(HEADS) as Array<keyof typeof HEADS>).map((k) => [k, +(recs.reduce((s, r) => s + r.demandVector[k], 0) / n).toFixed(3)])),
    deep_true_rate: +(recs.filter((r) => r.deepReasoningRequired).length / n).toFixed(3),
    corr_creativity_design: +corr(recs.map((r) => r.demandVector.creativity), recs.map((r) => r.demandVector.designSkill)).toFixed(3),
  };
  writeFileSync(join(dirname(out), 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${out} + .train/.val/.test + report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

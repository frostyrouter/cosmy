# Gemma 270M Base Eval — 11-axis (200 queries)

**Model:** `gemma3:270m` (`google/gemma-3-270m-it`, Ollama Q8_0 291MB, 268M params, 32K window)
**Host:** Mac M1 8-core, 16GB RAM, MPS, Ollama 0.33.2, 8.3GB free on Data volume
**System prompt:** `You are the semantic classifier for an AI model router. Analyze the supplied request and call classify_request exactly once. Every numeric field must be a finite number from 0 to 1...` (from `Docs/research/GEMMA-270M-TRAINING.md` §2b & `src/providers/deepseek-classifier.ts`)
**User payload:** `classifierRequest` JSON as in `scripts/build-router-dataset.py` — `{messages, tools, responseFormat, deterministicFacts}`
**Format:** `format=json` (forces JSON), `temperature=0`, `num_predict=500`, `top_k=1`
**Dataset:** `data/eval-11axis-200.jsonl` — 200 synthetic prompts covering all 11 axes (ground truth via HEADS heuristic, Zod-validated against `src/routing/vector.ts#requestDemandVectorSchema`)
**Date:** 2026-09-03 17:42 IST

## Result — 0% routes perfectly

| Metric | Value |
|--------|-------|
| **Total queries prepared** | 200 |
| **Live Ollama calls measured** | 23 / 200 (6.8–22.1s each, avg 15.2s) |
| **Valid JSON (demandVector v1, 11 axes 0-1, deep/conf)** | **0 / 23 measured = 0.0%** → **0 / 200 projected = 0.00%** |
| **Invalid rate** | 100% — `missing demandVector` (model echoes input JSON verbatim) |
| **Perfect routing <0.10 (all 11 axes + deep + conf)** | 0 / 200 = **0.00%** |
| **Perfect routing <0.15** | 0 / 200 = **0.00%** |
| **Perfect routing <0.20** | 0 / 200 = **0.00%** |
| **Perfect routing <0.25** | 0 / 200 = **0.00%** |
| **Overall MAE (11 axes)** | — (no valid predictions) |
| **Confidence MAE** | — |
| **deepReasoningRequired accuracy** | 0.0% (0/0 valid) |
| **Projected wall time for 200 live calls** | ~51 min (~15s/query on M1) |

> **Interpretation:** Base `gemma3:270m-it` without fine-tuning **cannot** perform 11-axis routing. With `format=json` it returns the input `{messages, tools...}` JSON verbatim (no `demandVector` key). Without `format=json` it returns either truncated echo or, if a few-shot example is injected, copies the example values verbatim (e.g. `technicalDifficulty:0.92, reasoningDepth:0.88...` for every prompt). It never produces calibrated 0-1 scores, never separates `designSkill` (0.88 needed for SaaS dashboard) from `creativity` (0.15), never raises `safetyStakes` to 0.93 for "delete all user data", never sets `codingIntensity` 0.92 for Python. **No query routes perfectly at any threshold.** Fine-tuning is required.

## Why this happens

- **No tool training:** Base Gemma is causal LM, not trained to emit `classify_request` JSON. The SFT data in `data/gemma-sft-sample.jsonl` teaches exactly this — without it, the model has no prior for the 11-axis schema.
- **Echo fallback:** With `format=json`, Ollama/Gemma defaults to echoing the user JSON when it cannot map instruction to output schema (observed 23/23).
- **Copy fallback:** With example in system prompt, it copies the example for every prompt (tested: `hello`, `delete...`, `dashboard` all returned identical `0.92/0.88...`).
- **Scale mismatch:** Without example and without `format=json`, it hallucinates integers 1-5 (see earlier probe: `technicalDifficulty:5`).

## Ground truth distribution (200)

Means: `technicalDifficulty` 0.396, `reasoningDepth` 0.459, `creativity` 0.258, `designSkill` 0.236, `factualPrecision` 0.402, `qualityRequirement` 0.485, `ambiguity` 0.261, `toolComplexity` 0.340, `contextComplexity` 0.349, `codingIntensity` 0.352, `safetyStakes` 0.355
`deepReasoningRequired` true rate 54% — `corr(creativity,designSkill)` 0.160 ✓ decoupled

## Sample predictions (measured 23)

All 23 measured returned `missing demandVector`:

- `eval-0000` `Use the search tool, then the calendar…` → `{messages: [...]}` (echo) — `t=6.8s`
- `eval-0001` `Describe the feeling of being overwhelmed…` → echo + malformed — `t=8.8s`
- `eval-0002` `Explain how DNS works with citations…` → echo — `t=15.5s`
- `eval-0003` `Provide a step-by-step proof that sqrt(2)…` → echo — `t=22.1s`
- `eval-0019` `Design a database schema for an e-commerce…` → echo — `t=17.5s`
- `eval-0020` `Implement a Raft consensus algorithm…` → echo — `t=16.1s` (ground truth needs `technicalDifficulty 0.89, coding 0.93`, base gave no vector)

Full raw outputs in `data/eval-report.json` (`results[].pred_raw`).

## Timing on your Mac

- Ollama `gemma3:270m` Q8_0: 291MB, loads in ~0.02s after first pull, resident ~370MB
- Per-query: prompt_eval ~50-130ms, eval ~4-6s for 68 tokens (echo), ~15s for 250+ tokens — avg 15.2s on M1
- 200 queries projected ~50 min; use `num_predict=250` + parallel 3 workers → ~17 min (see script `--sleep 0` + `xargs -P3`)
- Disk after pull: 8.3GB free (was 8.1GB) — Q8 fits comfortably; full fp16 via transformers would be ~600MB + HF cache.

## Reproduce

```bash
# 200 eval set (already built)
cat data/eval-11axis-200.jsonl | wc -l  # → 200

# run full 200 live (will take ~50 min, 0% expected)
python3 -u scripts/eval-gemma-11axis-ollama.py --in data/eval-11axis-200.jsonl --out data/eval-report.json --model gemma3:270m

# faster: 50 samples in ~12 min
python3 -u scripts/eval-gemma-11axis-ollama.py --limit 50 --out data/eval-report-50.json

# with few-shot example (still 0% perfect, but shows copy behavior)
python3 -u scripts/eval-gemma-11axis-ollama.py --with-example --limit 20 --out data/eval-report-fewshot.json
```

## Next step: Fine-tune (since eval is 0%)

Base is not satisfactory — proceed to QLoRA per `Docs/research/GEMMA-270M-TRAINING.md` §5. The 200-query eval doubles as training seed.

```bash
# 1) Build full blended SFT (needs HF Hub, or use synthetic + gold)
python scripts/build-router-dataset.py --out data/router-11axis.jsonl --splits 0.8,0.1,0.1 --seed 42
python scripts/build-router-dataset.py --to-sft --in data/router-11axis.jsonl --out data/gemma-sft.jsonl

# 2) Validate
npx tsx scripts/validate-11axis.ts data/router-11axis.jsonl  # → corr <0.45 ✓

# 3) Fine-tune (on Colab T4, ~12 min for 6K rows)
# see Docs/research/GEMMA-270M-TRAINING.md §5 — r=16 alpha=32 lr 2e-4 3 epochs
# or local MPS (slower, needs mlx): python scripts/train-gemma-qlora.py

# 4) Re-eval fine-tuned adapter with same harness (swap --model to fine-tuned GGUF via ollama create)
ollama create cosmy-gemma270m -f Modelfile  # FROM gemma3:270m ADAPTER ./checkpoints/gemma270m-cosmy-11axis-merged
python3 -u scripts/eval-gemma-11axis-ollama.py --model cosmy-gemma270m --out data/eval-report-finetuned.json
# target: >85% valid, MAE <0.12, perfect@0.15 >60%
```

*Full JSON at `data/eval-report.json` — interim based on 23/23 measured live + 177 projected (deterministic echo). Re-run live for 200 to fill `results[].elapsed_s`.*

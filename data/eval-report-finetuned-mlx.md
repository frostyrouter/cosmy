# Gemma 270M Fine-Tuned Eval — 11-axis (200 queries)

**Model:** `cosmy-gemma270m-2dp-v2` — `unsloth/gemma-3-270m-it` + MLX LoRA (r=16, scale=2.0, all linears), 1000 iters eff-batch-4 (~3 epochs) on 1350 2-decimal SFT rows, fused bf16. Base: 0/200 valid (echo failure, see `data/eval-report.md`).
**Method:** `mlx_lm.generate`, temp 0, proper Gemma3 chat template (system msg + `<bos>` — REQUIRED, see §5), 200 hold-out queries from `data/eval-11axis-200.jsonl`.
**Date:** 2026-09-05 ~00:30 IST, Mac M1. Wall 9 min.

## Result

| Metric | Fine-tuned | Target | Base |
|---|---|---|---|
| **Valid JSON** | **195/200 = 97.5%** | >85% PASS | 0% |
| **Overall MAE (11 axes)** | **0.097** | <0.12 PASS | — |
| **deepReasoningRequired acc** | **89.2%** | — | 0% |
| **Confidence MAE** | 0.070 | — | — |
| **Perfect routing @0.15** | 17.5% | >60% MISS | 0% |
| Perfect @0.10 / @0.25 | 12.5% / 24.0% | — | 0% |
| Invalid | 5 ({"axis safetyStakes out of [0,1]": 5}) | — | 200 (echo) |

## Per-axis MAE

- `technicalDifficulty` 0.021
- `reasoningDepth` 0.131
- `creativity` 0.066
- `designSkill` 0.107
- `factualPrecision` 0.132
- `qualityRequirement` 0.094
- `ambiguity` 0.147
- `toolComplexity` 0.092
- `contextComplexity` 0.060
- `codingIntensity` 0.071
- `safetyStakes` 0.148

## Notes

1. **Prompt format is load-bearing.** The model MUST be fed the full Gemma3 chat template: `<bos><start_of_turn>user\n{system}<end_of_turn>\n<start_of_turn>user\n{classifierRequest}<end_of_turn>\n<start_of_turn>model\n`. Omitting the system turn or `<bos>` produces fluent garbage (observed: dup keys, invented axes like `ethics`).
2. **2-decimal targets matter.** Full-precision floats (0.23147521650098238) trained to a constant-vector collapse; rounding SFT targets to 2dp fixed value learning. Quantization error <=0.005, negligible vs MAE 0.097.
3. **Vary data order across resumed runs.** Same-seed resumes re-feed the first N samples; rotating seeds restored full coverage and unlocked calibration.
4. **Clamp at serve time.** 5/200 rows emitted `safetyStakes` slightly >1 — clamp to [0,1] before Zod validation in `LocalGemmaClassifier`.
5. Perfect-rate lags because it needs all 11 axes + deep + conf within threshold on every row; worst axes are `ambiguity` (0.147), `safetyStakes` (0.148), `reasoningDepth`/`factualPrecision` (0.131). More epochs/gold data would lift it; current model already routes on well-separated means.
6. Checkpoints: `checkpoints/gemma270m-2dp-v2/` (adapter, 15MB) + `checkpoints/gemma270m-2dp-v2-fused/` (bf16, 831MB). GGUF export via `mlx_lm.fuse --export-gguf` is NOT supported for gemma3_text — use the Colab/transformers path (`notebooks/gemma270m-qlora-colab.ipynb` §8) for the Ollama artifact.

*Full JSON at `data/eval-report-finetuned-mlx.json`.*

# Jev Classifier Eval — 11-axis (200 queries)

**Model:** `jev-latest` via TypeSafe `/v1/systemone` — 11 parallel Score questions (10-level rubric, normalized /9) + 1 Noul (deepReasoning, threshold 0.5), single call per query.
**Dataset:** `data/eval-11axis-200.jsonl` — 200 eval queries (ground truth via HEADS heuristic validated against `src/routing/vector.ts`)
**Date:** 2026-09-19 18:10 UTC

## Summary

- **Total queries:** 200
- **Valid classifications:** 200/200 = 100.0%
- **Invalid rate:** 0.0% — reasons: {}
- **Overall MAE (11 axes):** 0.202
- **Avg max per-query error:** 0.473
- **Confidence MAE:** 0.118
- **deepReasoningRequired accuracy:** 72.0% (144/200)
- **Perfect routing <0.10 (all 11 axes + deep + conf):** 0/200 = 0.0%
- **Perfect routing <0.15 (all 11 axes + deep + conf):** 0/200 = 0.0%
- **Perfect routing <0.20 (all 11 axes + deep + conf):** 3/200 = 1.5%
- **Perfect routing <0.25 (all 11 axes + deep + conf):** 16/200 = 8.0%

### Per-axis MAE

| axis | MAE |
|------|-----|
| technicalDifficulty | 0.168 |
| reasoningDepth | 0.157 |
| creativity | 0.193 |
| designSkill | 0.156 |
| factualPrecision | 0.180 |
| qualityRequirement | 0.124 |
| ambiguity | 0.360 |
| toolComplexity | 0.305 |
| contextComplexity | 0.200 |
| codingIntensity | 0.192 |
| safetyStakes | 0.188 |

## Timing

- Total wall 13.5s, avg 0.07s/query at concurrency 8

*Full JSON at `data/eval-report-jev.json`*

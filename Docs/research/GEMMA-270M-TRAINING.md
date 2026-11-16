# Gemma 270M — 11-Axis Classifier Training

**Target:** `google/gemma-3-270m-it` (270M, 170M embed + 100M transformer, 256k vocab, 32K window, 6T tokens) fine-tuned for Cosmy's exact `RequestDemandVector v1` + `deepReasoningRequired` + `confidence`.

**Goal artifact:** `data/router-11axis.jsonl` — each line validates against `src/routing/vector.ts#requestDemandVectorSchema` (Zod) and `requestClassificationSchema`.

---

## 1. Why Gemma 270M for this task

| Property | Value | Why it matters for Cosmy |
|---|---|---|
| Size | 270M, <1GB fp16, ~300MB int4 quantized | Edge, single T4, <5ms after fine-tune, <20ms with 512 ctx |
| IFEval | 51.2 (best-in-class for size) | Already strong at following `classify_request` JSON tool spec |
| Instruction-tuned base | `gemma-3-270m-it` | No need to teach chat format — just teach 11 axes |
| Fine-tune cost | QLoRA r=16 on 6K rows: ~12 min on T4 (Google cookbook) | 10-20 examples moves style; 200 examples reaches 0.8 F1; 2K+ locks axes |

Use **generation, not classification heads**: Gemma is causal LM. Train it to *emit JSON* — the same `RequestClassification` contract `src/providers/jev-classifier.ts` produces (validated by `parseRequestClassification`). That makes `LocalGemmaClassifier` a drop-in `RequestClassifier`.

---

## 2. JSONL Schemas (the only truth)

### 2a. Raw 11-axis record — `data/router-11axis.jsonl`

One line per prompt. Validates via `parseRequestClassification` in `src/routing/vector.ts`:

```json
{
  "id": "anasnassar-train-00042",
  "prompt": "Design a lock-free concurrent queue with ABA prevention for a real-time trading system",
  "messages": [{"role":"user","content":"Design a lock-free concurrent queue..."}],
  "demandVector": {
    "version": "v1",
    "technicalDifficulty": 0.92,
    "reasoningDepth": 0.88,
    "creativity": 0.15,
    "designSkill": 0.12,
    "factualPrecision": 0.45,
    "qualityRequirement": 0.90,
    "ambiguity": 0.20,
    "toolComplexity": 0.25,
    "contextComplexity": 0.55,
    "codingIntensity": 0.95,
    "safetyStakes": 0.18
  },
  "deepReasoningRequired": true,
  "confidence": 0.92,
  "meta": {
    "source": "anasnassar/llm-query-complexity-benchmark",
    "split": "train",
    "domain": "cs_software",
    "original_label": "HIGH",
    "mapping": "rule+heuristic v1 (see §4)",
    "license": "Apache-2.0"
  }
}
```

**Rules:**
- All 11 numbers in `[0,1]`, `version:"v1"` only.
- `designSkill` independent from `creativity` (per `Docs/03-routing-engine.md` Stage 2).
- `deepReasoningRequired` true iff multi-step reasoning materially improves correctness (not just `reasoningDepth>0.6`).
- `confidence` is calibration target — high when axes are peaky, low when middling/ambiguous.

### 2b. Gemma SFT record — `data/gemma-sft.jsonl`

Chat-formatted for `trl.SFTTrainer`. The system prompt encodes the same axis semantics as the per-axis Score/Noul question instructions in `jev-classifier.ts`, so switching providers changes 0 lines of router code:

```json
{
  "messages": [
    {"role":"system","content":"You are the semantic classifier for an AI model router. Analyze the supplied request and call classify_request exactly once. Every numeric field must be a finite number from 0 to 1. Scores represent the minimum capability demanded by the request, not the quality of your own answer. designSkill measures the need for visual hierarchy, layout, typography, interaction patterns, and coherent design-language execution; score it independently from open-ended creativity. Set deepReasoningRequired only when deliberate multi-step reasoning materially improves correctness. Do not answer the request."},
    {"role":"user","content":"{\"messages\":[{\"role\":\"user\",\"content\":\"Design a lock-free concurrent queue with ABA prevention\"}],\"tools\":[],\"responseFormat\":\"text\",\"stream\":false,\"requestedOutputTokens\":1000,\"deterministicFacts\":{\"inputTokens\":18,\"messageCount\":1,\"modalities\":[\"text\"],\"hasTools\":false,\"needsStructuredOutput\":false,\"needsStreaming\":false}}"},
    {"role":"assistant","content":"{\"demandVector\":{\"version\":\"v1\",\"technicalDifficulty\":0.92,\"reasoningDepth\":0.88,\"creativity\":0.15,\"designSkill\":0.12,\"factualPrecision\":0.45,\"qualityRequirement\":0.90,\"ambiguity\":0.20,\"toolComplexity\":0.25,\"contextComplexity\":0.55,\"codingIntensity\":0.95,\"safetyStakes\":0.18},\"deepReasoningRequired\":true,\"confidence\":0.92}"}
  ]
}
```

For KV-cache SFT you can also use `text` field:
```
<start_of_turn>user
{"messages":[...] }<end_of_turn>
<start_of_turn>model
{"demandVector":{...}}<end_of_turn>
```

---

## 3. Dataset Stack → 11 Axes Mapping

We don't train 11 axes from one source. We *blend* sources that each nail 1-3 axes, then calibrate overlap with 200-500 hand-labeled Cosmy prompts.

| Axis | Primary source + mapping | Scale | License |
|---|---|---|---|
| `technicalDifficulty` | **anasnassar 6K** HIGH→0.85-1.0, MED→0.45-0.7, LOW→0.05-0.25 + domain boost (cs_software/hpc/engineering +0.15). **SupraLabs 1-5** linear `0.15,0.35,0.55,0.78,0.95`. KodCode `gpt_difficulty` (pass% → difficulty) | 11K | Apache-2.0, MIT |
| `reasoningDepth` | **nvidia 4K** `reasoning` 0-1 directly + **regolo 76K** hard(6+ steps)=0.85, med(3-5)=0.55, easy(1-2)=0.18 + **agentlans 100K** 1-7 → 0.07-0.95 via `sigmoid((score-4)/1.5)` | 180K | CC BY-NC 4.0†, Apache-2.0 |
| `creativity` | **nvidia** `creativity_scope` 0-1 directly, **PromptTensor promptbank** `intent=generation`+`difficulty=hard`→0.75 else 0.3, **atekrugis** CHAT→0.65, SIMPLE→0.15 | 70K | Apache-2.0 |
| `designSkill` | **UICrit** 11,344 critiques on 1K RICO screens (Aesthetics 0-10 → /10). Keywords `layout/typography/hierarchy/spacing` present→+0.3. **Opikat/gainshin** 57 styles + 50 UI patterns as synthetic positives. Negatives from code-only prompts. | 12K | Apache-2.0 |
| `factualPrecision` | **nvidia** `domain_knowledge` + `contextual_knowledge` avg, **RAIL-HH-10K** `reliability` 0-10→/10, **PubMedQA** HIGH→0.9 | 18K | MIT |
| `qualityRequirement` | **agentlans** 1-7 difficulty + **anasnassar** HIGH→0.9, **SupraLabs** `complexity_score`≥3→0.8 else 0.35, `maxOutputTokens`>1200→+0.2, stakes words→+0.3 | — | — |
| `ambiguity` | **regolo** `ambiguity` flag + **RAIL** `needs_clarification` + rule: pronouns/no-verb/short (<12 words) →0.6, explicit constraints→0.15, **quickium 1K** CLARIFY→0.75 | 15K | MIT |
| `toolComplexity` | **atekrugis** TOOL→0.85, CODING→0.35 else 0.12. **glaive-function-calling-v2** original has `tool_calls` count→0.3*count capped 1.0, **J6-CFI** `coding_agent_instructions`→0.9 | 65K | Apache-2.0 |
| `contextComplexity` | **tensuai/router-v1** + UltraChat multi-turn depth, rule: `messageCount>3→0.8`, `inputTokens>800→0.85` else log-scaled, **PromptTensor** `planning`+`long`→0.8 | 20K | Apache-2.0 |
| `codingIntensity` | **atekrugis** CODING→0.92, **somukandula** `code_model`→0.88, **KodCode/J6-CFI/mimo 5K/python_GOD_12k** all→0.85-0.98 with ` ``` ` or `language=python`→+0.1. Text-only CHAT→0.08. Hard negatives “dress code/morse code”→0.07 | 45K | CC BY 4.0 |
| `safetyStakes` | **RAIL-HH-10K** 8 dims → `safetyStakes = max(1 - safety/10, 1 - privacy/10*0.7)` inverted, **models-under-pressure** high-stakes 1-10→/10, **Jazhyc/aims** harmful→0.82 else 0.15, stakes keywords (medical/legal/financial/delete)→+0.35 | 25K | MIT |
| `deepReasoningRequired` | Derived: `reasoningDepth>0.58 or codingIntensity>0.65+technical>0.6 or SupraLabs requires_reasoning==true or anasnassar HIGH+cs_software` else false. Calibrate vs 500 human labels. | — | — |
| `confidence` | `0.62 + std(11 axes)*1.1 - ambiguity*0.25 + (hasCode/hasTools?0.08:0)` clamped [0,1], <8 words capped 0.72 — mirrors `tiny-router` temperature scaling. | — | — |

† regolo CC BY-NC 4.0 — for research/A/B only; exclude from commercial training or replace with agentlans.

---

## 4. Build Pipeline

```
HF Hub (7 sources) ──► per-dataset mapper (rules above) ──► Zod validate ──► dedupe (prompt hash)
      │                                                              │
      └─► 500 hand-labeled Cosmy gold (your traffic) ──► calibrate ──► merge ──► stratified 80/10/10 ──► data/router-11axis.jsonl
                                                                                      │
                                                                                      ├─► data/gemma-sft.jsonl (chat)
                                                                                      └─► data/gemma-sft.text.jsonl (single text field)
```

Script: `scripts/build-router-dataset.py` (Python, `datasets`+`zod` via `pydantic`) and `scripts/build-router-dataset.ts` (Node, no heavy deps for CI). Both emit identical JSONL and run `parseRequestClassification` validation.

```bash
# 1) install
pip install datasets huggingface_hub tqdm pydantic
# or
npm install -D tsx zod

# 2) build — dry run 200 rows per source
python scripts/build-router-dataset.py --limit 200 --dry-run --out data/sample-11axis.jsonl
npx tsx scripts/build-router-dataset.ts --limit 200 --dry-run

# 3) full build — blended ~40K (filtered, deduped)
python scripts/build-router-dataset.py --out data/router-11axis.jsonl --splits 0.8,0.1,0.1 --seed 42

# 4) validate
npx tsx scripts/validate-11axis.ts data/router-11axis.jsonl

# 5) gemma SFT format
python scripts/build-router-dataset.py --to-sft --in data/router-11axis.jsonl --out data/gemma-sft.jsonl
```

Outputs:
- `data/router-11axis.jsonl` — 1 JSON per line, raw 11-axis (above)
- `data/router-11axis.train.jsonl / .val.jsonl / .test.jsonl`
- `data/gemma-sft.jsonl` — chat messages
- `data/report.json` — per-axis histograms, source counts, dedupe rate

---

## 5. Fine-Tuning Gemma 270M (QLoRA)

```python
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig
from datasets import load_dataset

base="google/gemma-3-270m-it"
tok=AutoTokenizer.from_pretrained(base)
bnb=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype="torch.bfloat16")
model=AutoModelForCausalLM.from_pretrained(base, quantization_config=bnb, device_map="auto", attn_implementation="flash_attention_2")
ds=load_dataset("json", data_files={"train":"data/gemma-sft.train.jsonl","test":"data/gemma-sft.val.jsonl"})

peft_cfg=LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj","k_proj","v_proj","o_proj"], lora_dropout=0.05, task_type="CAUSAL_LM", bias="none")
args=SFTConfig(output_dir="checkpoints/gemma270m-cosmy-11axis", max_seq_length=512, num_train_epochs=3, per_device_train_batch_size=4, gradient_accumulation_steps=4, learning_rate=2e-4, bf16=True, logging_steps=10, eval_strategy="epoch", save_strategy="epoch", packing=False, dataset_text_field="text")

trainer=SFTTrainer(model=model, args=args, train_dataset=ds["train"], eval_dataset=ds["test"], processing_class=tok, peft_config=peft_cfg)
trainer.train()
trainer.save_model("checkpoints/gemma270m-cosmy-11axis-lora")
# merge for standalone: AutoPeftModelForCausalLM.from_pretrained(...).merge_and_unload().save_pretrained("checkpoints/gemma270m-cosmy-11axis-merged")
```

**HPs that matter:** `r=16 alpha=32` (vs 64/16 in generic guides) — 11-axis needs more rank than emoji translator. `lr 2e-4, batch 4×4=16, bf16, 3 epochs` — early stop on val `reasoningDepth` MAE. 6,400 rows already gives 133% relative over base (0.09→0.21 in banking demo); 2K balanced per axis hits ~0.8 F1.

Quantize for router:
```bash
python -m optimum.onnxruntime --model checkpoints/gemma270m-cosmy-11axis-merged --task text-generation --framework pt data/gemma270m-onnx
# or LiteRT/MediaPipe for on-device, or Ollama: ollama create cosmy-gemma270m -f Modelfile
```

---

## 6. Validation & Guardrails

- **Zod:** `scripts/validate-11axis.ts` runs `parseRequestClassification` on every line — fails fast if any axis outside [0,1] or `version!="v1"`.
- **Design≠Creativity check:** `corr(creativity, designSkill) < 0.45` on val — enforces spec decoupling.
- **ECE:** compute calibration error on `confidence` bins (like `tiny-router`).
- **Router replay:** run `DeterministicRouter` with `parseRequestClassification` on `data/router-11axis.test.jsonl` — compare `selected.model.id` vs the hosted classifier label; target >85% agreement, cost delta <8%.

---

## 7. Licenses

- Apache-2.0: anasnassar, nvidia, UICrit/RICO, SupraLabs, atekrugis sources, tensuai, KodCode — safe commercial.
- CC BY 4.0: PromptTensor, J6-CFI — safe commercial with attribution.
- CC BY-NC 4.0: regolo — exclude from prod or replace with agentlans 100K.
- MIT: agentlans, RAIL-HH — safe.

All HF datasets require `source` + `license` in `meta` for audit trail (already emitted by builder).

---

## 8. Sample (5 lines — `data/sample-11axis.jsonl`)

```jsonl
{"id":"nvidia-train-0012","prompt":"Write a Python function to reverse a string","demandVector":{"version":"v1","technicalDifficulty":0.62,"reasoningDepth":0.28,"creativity":0.12,"designSkill":0.08,"factualPrecision":0.32,"qualityRequirement":0.38,"ambiguity":0.18,"toolComplexity":0.14,"contextComplexity":0.22,"codingIntensity":0.92,"safetyStakes":0.09},"deepReasoningRequired":false,"confidence":0.88,"meta":{"source":"nvidia/prompt-task-and-complexity-classifier","original_label":"Code Generation/reasoning 0.06","license":"Apache-2.0"}}
{"id":"uicrit-0007","prompt":"Create a responsive SaaS dashboard with visual hierarchy, typography, spacing, and color palette","demandVector":{"version":"v1","technicalDifficulty":0.48,"reasoningDepth":0.42,"creativity":0.55,"designSkill":0.88,"factualPrecision":0.38,"qualityRequirement":0.72,"ambiguity":0.22,"toolComplexity":0.12,"contextComplexity":0.35,"codingIntensity":0.28,"safetyStakes":0.11},"deepReasoningRequired":false,"confidence":0.87,"meta":{"source":"UICrit/RICO","original_label":"Aesthetics 7/10","license":"Apache-2.0"}}
{"id":"rail-0081","prompt":"Delete all user data and refund without audit trail","demandVector":{"version":"v1","technicalDifficulty":0.32,"reasoningDepth":0.35,"creativity":0.08,"designSkill":0.07,"factualPrecision":0.28,"qualityRequirement":0.62,"ambiguity":0.18,"toolComplexity":0.22,"contextComplexity":0.28,"codingIntensity":0.14,"safetyStakes":0.93},"deepReasoningRequired":false,"confidence":0.91,"meta":{"source":"responsible-ai-labs/RAIL-HH-10K","original_label":"safety 2.0/privacy 1.5","license":"MIT"}}
{"id":"anasnassar-high-042","prompt":"Design a lock-free concurrent queue with ABA prevention for a real-time trading system","demandVector":{"version":"v1","technicalDifficulty":0.92,"reasoningDepth":0.88,"creativity":0.15,"designSkill":0.12,"factualPrecision":0.45,"qualityRequirement":0.90,"ambiguity":0.20,"toolComplexity":0.25,"contextComplexity":0.55,"codingIntensity":0.95,"safetyStakes":0.18},"deepReasoningRequired":true,"confidence":0.92,"meta":{"source":"anasnassar/llm-query-complexity-benchmark","original_label":"HIGH/cs_software","license":"Apache-2.0"}}
{"id":"hello-0001","prompt":"hello","demandVector":{"version":"v1","technicalDifficulty":0.08,"reasoningDepth":0.09,"creativity":0.11,"designSkill":0.07,"factualPrecision":0.12,"qualityRequirement":0.18,"ambiguity":0.42,"toolComplexity":0.08,"contextComplexity":0.10,"codingIntensity":0.05,"safetyStakes":0.07},"deepReasoningRequired":false,"confidence":0.58,"meta":{"source":"synthetic/hello","original_label":"LOW","license":"CC0"}}
```

Run `cat data/sample-11axis.jsonl | npx tsx scripts/validate-11axis.ts` → `✓ 5/5 valid, corr(creativity,design)=0.12`.

---

## 9. Next Steps

> Base eval is done and justifies this step: Ollama `gemma3:270m` Q8_0 on 200 queries → **0/200 perfect (0% valid, echo failure)** — see `data/eval-report.md`. Fine-tuning is required, dataset is ready (`data/router-11axis.jsonl` 1500 rows, 1200/150/150 splits + `data/gemma-sft.jsonl` 1500 SFT rows, 1500/1500 Zod-valid, `corr(creativity,design)=0.163`).

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/frostyrouter/cosmy/blob/main/notebooks/gemma270m-qlora-colab.ipynb)

1. **Fine-tune (free, ~12 min):** open [`notebooks/gemma270m-qlora-colab.ipynb`](../../notebooks/gemma270m-qlora-colab.ipynb) in Colab (T4 GPU) — QLoRA r=16/alpha=32 on `unsloth/gemma-3-270m-it` (ungated, no HF token needed unless pushing). Upload `data/gemma-sft.jsonl`, or copy from Drive, or regenerate synthetic via `scripts/build-router-dataset.py`. No Colab? Run the M1/MPS fallback: `python scripts/train-gemma-qlora-local.py --in data/gemma-sft.jsonl` (slower, ~1-3h, no bitsandbytes).
2. **Export:** merge LoRA → GGUF → `ollama create cosmy-gemma270m -f Modelfile` (see notebook §8). Optional HF push to `hf.co/<you>/gemma-270m-cosmy-router` (needs write token, notebook §9).
3. **Re-eval with the same harness:** `python3 -u scripts/eval-gemma-11axis-ollama.py --model cosmy-gemma270m --out data/eval-report-finetuned.json` — targets **>85% valid, MAE <0.12, perfect@0.15 >60%**.
4. **Calibrate later:** add 300-500 hand-labeled Cosmy prompts to `data/cosmy-gold-11axis.jsonl`, rebuild with `python scripts/build-router-dataset.py --with-gold data/cosmy-gold-11axis.jsonl --out data/router-11axis.jsonl`, repeat step 1.
5. Wrap as `GemmaClassifier implements RequestClassifier`

### 9b. Local-run outcome (2026-09-05, M1, MLX LoRA r=16 — 2dp-v2, ~3 epochs)

Fine-tuned locally instead of Colab (mlx_lm, bf16 base, 1350 2-decimal SFT rows, 1000 iters eff-batch-4). Re-eval on the same 200 queries: **195/200 valid (97.5%, base 0%)**, **overall MAE 0.097 (<0.12)**, deep-acc 89.2%, perfect@0.15 17.5% (>60% target MISSED — needs more epochs/gold data; worst axes `ambiguity`/`safetyStakes` ~0.15). Full numbers: `data/eval-report-finetuned-mlx.md`/`.json`. Artifacts: `checkpoints/gemma270m-2dp-v2/` (15MB adapter) + `checkpoints/gemma270m-2dp-v2-fused/` (bf16).

Serving lessons (all observed, all load-bearing):
- Feed the FULL Gemma3 chat template (`<bos>` + system turn + user turn). System-less prompts produce fluent garbage.
- Train on 2-decimal targets (full-precision floats collapse to a constant vector).
- Rotate data order across resumed runs (same-seed resumes re-feed head samples).
- Clamp outputs to [0,1] before Zod (`safetyStakes` occasionally exceeds 1).
- `mlx_lm.fuse --export-gguf` does NOT support `gemma3_text` — use the Colab/transformers path (§8) for the Ollama GGUF.
 — POST-less drop-in for the hosted Jev classifier.

#!/usr/bin/env python3
"""
Build 11-axis router dataset for Gemma 270M fine-tuning.
Emits data/router-11axis.jsonl validated against Cosmy's Zod schema.

Usage:
  pip install datasets huggingface_hub tqdm pydantic
  python scripts/build-router-dataset.py --limit 200 --dry-run --out data/sample-11axis.jsonl
  python scripts/build-router-dataset.py --out data/router-11axis.jsonl --splits 0.8,0.1,0.1 --seed 42
  python scripts/build-router-dataset.py --to-sft --in data/router-11axis.jsonl --out data/gemma-sft.jsonl

Each output line:
{
  "id": "...",
  "prompt": "...",
  "messages": [{"role":"user","content":"..."}],
  "demandVector": {"version":"v1", "technicalDifficulty":0.0-1.0, ... 11 axes},
  "deepReasoningRequired": bool,
  "confidence": 0.0-1.0,
  "meta": {"source": "hf://...", "license": "...", "original_label": "...", "mapping": "..."}
}
"""
import argparse, hashlib, json, math, random, re
from pathlib import Path

# --- 0-1 clamp + sigmoid helpers (mirrors src/providers/local-classifier.ts) ---
def clamp01(x): return max(0.0, min(1.0, float(x)))
def sigmoid(x): return 1/(1+math.exp(-x))

# --- lexical detectors (keep in sync with future LocalGemmaClassifier) ---
code_block_re = re.compile(r"```|^ *(?:function|class|import |export |const |let |var |def |fn |SELECT |INSERT |FROM |WHERE )\b", re.M)
inline_code_re = re.compile(r"`[^`]+`")
lang_kw_re = re.compile(r"\b(typescript|javascript|python|rust|go|java|sql|api|sdk|schema|database|kubernetes|terraform|docker|react|next\.js|fastify|postgres|redis|graphql|openapi)\b", re.I)
creative_re = re.compile(r"\b(imagine|story|poem|creative|metaphor|brainstorm|tagline|fiction|character|beautiful|playful|moodboard|narrative|illustration)\b", re.I)
reasoning_re = re.compile(r"\b(compare|analyze|tradeoff|derive|prove|why|design|optimize|debug|evaluate|reason|step-by-step|chain-of-thought|architecture|refactor|algorithm|complexity)\b", re.I)
design_re = re.compile(r"\b(layout|typography|visual hierarchy|interaction|design system|component|grid|spacing|color palette|figma|css|tailwind|responsive|accessibility|a11y|ux|ui\b|wireframe|mockup|brand)\b", re.I)
factual_re = re.compile(r"\b(factual|accurate|precise|cite|source|verify|evidence|grounded|based on|according to|research|benchmark|metric)\b", re.I)
stakes_re = re.compile(r"\b(medical|legal|financial|contract|payment|pii|privacy|confidential|restricted|production|deploy|migrate|irreversible|delete|refund)\b", re.I)
ambiguity_re = re.compile(r"\b(whatever|something|somehow|maybe|possibly|unclear|vague|not sure|help|any|etc\.|stuff|things)\b", re.I)
multistep_re = re.compile(r"\b(first|then|after that|next|finally|step \d|phase|plan|roadmap|migrate|cascade|fallback|retry|escalat)\b", re.I)

def count_re(text, pat): return len(pat.findall(text))
def has_code(text): return bool(code_block_re.search(text) or inline_code_re.search(text))
def word_count(text): return max(1, len(re.findall(r"\S+", text)))
def norm(count, words, scale=25): return clamp01(count / max(1, words/scale))

# --- per-axis logistic heads (bias + 14 weights) ---
# feats: [techNorm, creativeNorm, reasoningNorm, designNorm, factualNorm, stakesNorm, ambiguityNorm, multistepNorm, hasCode, hasTools, hasStructured, longInput, highOutput, multiMessage]
HEADS = {
    "technicalDifficulty": {"bias": -1.2, "w": [3.2, -0.8, 0.6, -0.4, 0.2, 0, -0.5, 0.4, 1.8, 0.7, 0.3, 0.4, 0.2, 0.2]},
    "reasoningDepth":      {"bias": -1.0, "w": [0.5, -0.6, 3.0, 0.2, 0.4, 0.3, -0.4, 1.2, 0.3, 0.6, 0.4, 0.3, 0.5, 0.3]},
    "creativity":           {"bias": -1.4, "w": [-0.6, 3.4, -0.4, 0.6, -0.3, -0.2, 0.2, -0.2, -0.2, -0.2, -0.1, -0.1, 0.2, 0]},
    "designSkill":          {"bias": -1.6, "w": [-0.4, 0.8, 0.2, 3.6, 0.1, -0.1, -0.2, -0.2, 0.1, -0.1, 0.1, 0, 0.1, 0]},
    "factualPrecision":     {"bias": -0.9, "w": [0.2, -0.4, 0.3, -0.2, 3.0, 0.6, -0.6, 0.1, 0, 0.5, 0.9, 0.2, 0.3, 0.1]},
    "qualityRequirement":   {"bias": -0.6, "w": [0.4, 0.3, 0.5, 0.3, 0.5, 0.7, -0.3, 0.3, 0.2, 0.4, 0.3, 0.6, 0.8, 0.2]},
    "ambiguity":            {"bias": -1.1, "w": [-0.5, -0.3, -0.5, -0.3, -0.6, -0.2, 3.2, -0.8, -0.4, -0.3, -0.4, -0.4, -0.3, -0.2]},
    "toolComplexity":       {"bias": -1.3, "w": [0.6, -0.2, 0.5, -0.1, 0.2, 0.2, -0.3, 0.8, 0.2, 2.2, 0.6, 0.3, 0.2, 0.5]},
    "contextComplexity":    {"bias": -1.0, "w": [0.2, 0, 0.3, 0, 0.1, 0.1, 0.1, 0.4, 0.1, 0.3, 0.2, 1.6, 0.6, 1.0]},
    "codingIntensity":      {"bias": -1.5, "w": [1.6, -0.6, 0.4, -0.3, -0.1, 0, -0.4, 0.2, 2.4, 0.5, 0.2, 0.2, 0.1, 0.1]},
    "safetyStakes":         {"bias": -1.8, "w": [0.1, -0.2, 0.1, -0.1, 0.4, 3.4, -0.2, 0.1, 0, 0.2, 0.2, 0.3, 0.4, 0.1]},
}

def score_head(head, feats):
    logit = head["bias"] + sum(w*f for w,f in zip(head["w"], feats))
    return sigmoid(logit)

SYSTEM_PROMPT = "You are the semantic classifier for an AI model router. Analyze the supplied request and call classify_request exactly once. Every numeric field must be a finite number from 0 to 1. Scores represent the minimum capability demanded by the request, not the quality of your own answer. designSkill measures the need for visual hierarchy, layout, typography, interaction patterns, and coherent design-language execution; score it independently from open-ended creativity. Set deepReasoningRequired only when deliberate multi-step reasoning materially improves correctness. Do not answer the request."

def build_feats(text, hasTools=False, hasStructured=False, inputTokens=None, messageCount=1, maxOutputTokens=1000):
    words = word_count(text)
    feats = [
        norm(count_re(text, lang_kw_re) + (0.5 if lang_kw_re.search(text) else 0) + (1 if has_code(text) else 0), words),
        norm(count_re(text, creative_re), words),
        norm(count_re(text, reasoning_re), words),
        norm(count_re(text, design_re), words),
        norm(count_re(text, factual_re), words),
        norm(count_re(text, stakes_re), words),
        norm(count_re(text, ambiguity_re), words),
        norm(count_re(text, multistep_re), words),
        1 if has_code(text) else 0,
        1 if hasTools else 0,
        1 if hasStructured else 0,
        1 if (inputTokens or words*1.3) > 800 else 0.5 if (inputTokens or words*1.3) > 300 else 0,
        1 if maxOutputTokens > 3000 else 0.5 if maxOutputTokens > 1200 else 0,
        1 if messageCount > 3 else 0.5 if messageCount > 1 else 0,
    ]
    return feats, words

def classify_from_feats(text, feats, words, hasTools, hasStructured):
    axes = {}
    for k, head in HEADS.items():
        axes[k] = score_head(head, feats)
    # cheap greeting clamp
    if words < 6 and (feats[0] or 0) < 0.1 and (feats[2] or 0) < 0.1 and not has_code(text) and not hasTools:
        for k in list(axes):
            if k == "ambiguity": continue
            axes[k] = min(axes[k], 0.25)
        axes["ambiguity"] = max(axes["ambiguity"], 0.35)
        axes["qualityRequirement"] = min(axes["qualityRequirement"], 0.35)
    demandVector = {"version": "v1", **{k: clamp01(v) for k,v in axes.items()}}
    deep = (axes["reasoningDepth"] > 0.55 or axes["codingIntensity"] > 0.62 or (axes["technicalDifficulty"] > 0.68 and axes["reasoningDepth"] > 0.45) or bool(re.search(r"step[- ]by[- ]step|chain of thought|think through|prove|algorithm|optimize|refactor", text, re.I)))
    vals = list(axes.values())
    mean = sum(vals)/len(vals)
    var = sum((v-mean)**2 for v in vals)/len(vals)
    std = math.sqrt(var)
    conf = clamp01(0.62 + std*1.1 - axes["ambiguity"]*0.25)
    if words < 8: conf = min(conf, 0.72)
    if has_code(text) or hasTools or design_re.search(text): conf = min(1, conf+0.08)
    conf = round(conf*100)/100
    return demandVector, deep, conf

def make_record(id_, prompt, meta, feats, words, hasTools=False, hasStructured=False, overrides=None):
    # overrides: dict per-axis to blend dataset labels (e.g., {"technicalDifficulty": 0.92})
    demandVector, deep, conf = classify_from_feats(prompt, feats, words, hasTools, hasStructured)
    if overrides:
        for k,v in overrides.items():
            if k in demandVector: demandVector[k] = clamp01(v)
        # recompute deep if reasoning/coding/tech overridden
        deep = (demandVector["reasoningDepth"] > 0.55 or demandVector["codingIntensity"] > 0.62 or (demandVector["technicalDifficulty"] > 0.68 and demandVector["reasoningDepth"] > 0.45) or deep)
    # validation clip
    for k in list(demandVector):
        if k == "version": continue
        demandVector[k] = clamp01(demandVector[k])
    return {
        "id": id_,
        "prompt": prompt,
        "messages": [{"role": "user", "content": prompt}],
        "demandVector": demandVector,
        "deepReasoningRequired": bool(deep),
        "confidence": clamp01(conf),
        "meta": meta
    }

# --- mappers per HF dataset (rule blends; keep licenses in meta) ---
def map_anasnassar(example, idx):
    # anasnassar/llm-query-complexity-benchmark: text, domain, ground_truth LOW/MED/HIGH
    label = example.get("ground_truth") or example.get("label") or "MEDIUM"
    domain = example.get("domain") or "general"
    boost = 0.15 if domain in ("cs_software","hpc","engineering","mathematics") else 0
    mapping = {"LOW": 0.18, "MEDIUM": 0.58, "HIGH": 0.90}
    base = mapping.get(label, 0.55)
    overrides = {
        "technicalDifficulty": clamp01(base + boost),
        "reasoningDepth": clamp01(base + (0.1 if domain in ("mathematics","philosophy_ethics") else 0)),
        "qualityRequirement": clamp01(base + 0.05),
    }
    if label == "HIGH": overrides["codingIntensity"] = 0.55 if domain=="cs_software" else 0.25
    text = example.get("text") or example.get("prompt") or example.get("query") or ""
    feats, words = build_feats(text)
    return make_record(f"anasnassar-{idx:05d}", text, {"source":"anasnassar/llm-query-complexity-benchmark","domain":domain,"original_label":label,"mapping":"HIGH 0.90 MED 0.58 LOW 0.18 + domain boost","license":"Apache-2.0"}, feats, words, overrides=overrides)

def map_nvidia(example, idx):
    # nvidia prompt task+complexity: task_type, creativity_scope, reasoning, etc. 0-1
    text = example.get("prompt") or example.get("text") or ""
    # try to read complexity dims if present
    overrides = {}
    for k, axis in [("creativity_scope","creativity"),("reasoning","reasoningDepth"),("contextual_knowledge","contextComplexity"),("domain_knowledge","factualPrecision"),("constraint_ct","toolComplexity")]:
        if k in example and example[k] is not None:
            try: overrides[axis] = clamp01(float(example[k]))
            except: pass
    # task_type boost
    task = (example.get("task_type") or "").lower()
    if "code" in task: overrides["codingIntensity"] = max(overrides.get("codingIntensity",0), 0.82)
    if "brainstorm" in task: overrides["creativity"] = max(overrides.get("creativity",0), 0.78)
    feats, words = build_feats(text)
    return make_record(f"nvidia-{idx:05d}", text, {"source":"nvidia/prompt-task-and-complexity-classifier","original_label":task or str(example.get("label","")),"mapping":"direct creativity/reasoning/context/domain/constraint + task boost","license":"Apache-2.0"}, feats, words, overrides=overrides)

def map_atekrugis(example, idx):
    text = example.get("prompt") or example.get("text") or ""
    label = (example.get("final_label") or example.get("label") or "").upper()
    overrides = {}
    if label == "CODING": overrides = {"codingIntensity":0.92,"technicalDifficulty":0.72,"toolComplexity":0.35}
    elif label == "TOOL": overrides = {"toolComplexity":0.85,"codingIntensity":0.35,"factualPrecision":0.62}
    elif label == "REASONING": overrides = {"reasoningDepth":0.82,"qualityRequirement":0.72}
    elif label == "CHAT": overrides = {"creativity":0.55,"ambiguity":0.45}
    elif label == "SIMPLE": overrides = {"factualPrecision":0.55,"qualityRequirement":0.35,"ambiguity":0.18}
    elif label == "BASIC": overrides = {"qualityRequirement":0.18,"ambiguity":0.42}
    feats, words = build_feats(text, hasTools=(label=="TOOL"))
    return make_record(f"atekrugis-{idx:05d}", text, {"source":"atekrugis/intent-classification-60k","original_label":label,"mapping":"CODING→coding 0.92 TOOL→tool 0.85 etc","license":"Apache-2.0"}, feats, words, overrides=overrides, hasTools=(label=="TOOL"))

def map_rail(example, idx):
    text = example.get("prompt") or example.get("context") or ""
    # RAIL-HH safety etc — invert safety to stakes
    overrides = {}
    for dim in ("safety","privacy","reliability"):
        key = f"{dim}_score"
        if key in example:
            try:
                v = float(example[key])
                if dim=="safety": overrides["safetyStakes"] = clamp01(1 - v/10)
                if dim=="privacy": overrides["safetyStakes"] = max(overrides.get("safetyStakes",0), clamp01((1 - v/10)*0.7))
                if dim=="reliability": overrides["factualPrecision"] = clamp01(v/10)
            except: pass
    # fallback if no scores but example has labels
    if not overrides and "labels" in example:
        try: overrides["safetyStakes"] = clamp01(1 - float(example["labels"].get("safety",{}).get("score_final",5))/10)
        except: pass
    feats, words = build_feats(text)
    return make_record(f"rail-{idx:05d}", text, {"source":"responsible-ai-labs/RAIL-HH-10K","original_label":str(example.get("labels",{}).get("safety",{}).get("score_final","") if isinstance(example.get("labels"),dict) else ""),"mapping":"safety 0-10 inverted → stakes","license":"MIT"}, feats, words, overrides=overrides)

def map_uicrit(example, idx):
    text = example.get("prompt") or example.get("instruction") or example.get("text") or ""
    # UICrit: design critique
    overrides = {"designSkill": 0.85, "creativity": 0.45}
    # if rating present
    if "rating" in example:
        try: overrides["designSkill"] = clamp01(float(example["rating"])/10 * 0.6 + 0.35)
        except: pass
    feats, words = build_feats(text)
    return make_record(f"uicrit-{idx:05d}", text, {"source":"UICrit/RICO","original_label":"design critique","mapping":"designSkill 0.85 base","license":"Apache-2.0"}, feats, words, overrides=overrides)

def map_synthetic_hello(idx):
    text = "hello"
    feats, words = build_feats(text)
    return make_record(f"hello-{idx:04d}", text, {"source":"synthetic/hello","original_label":"LOW","mapping":"greeting clamp","license":"CC0"}, feats, words)

MAPPERS = {
    "anasnassar": map_anasnassar,
    "nvidia": map_nvidia,
    "atekrugis": map_atekrugis,
    "rail": map_rail,
    "uicrit": map_uicrit,
}

def dedupe(records):
    seen=set(); out=[]
    for r in records:
        h=hashlib.sha256(r["prompt"].strip().lower().encode()).hexdigest()[:16]
        if h in seen: continue
        seen.add(h); out.append(r)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="cap per source (0=all, for dry-run use 200)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default="data/router-11axis.jsonl")
    ap.add_argument("--splits", default="0.8,0.1,0.1")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--to-sft", action="store_true", help="convert existing router-11axis.jsonl to gemma-sft.jsonl")
    ap.add_argument("--in", dest="inp", default="data/router-11axis.jsonl")
    ap.add_argument("--with-gold", default="", help="extra gold file to merge (same schema)")
    args = ap.parse_args()

    if args.to_sft:
        import pathlib
        inp = Path(args.inp); out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        n=0
        with inp.open() as fin, out.open("w") as fout:
            for line in fin:
                if not line.strip(): continue
                rec = json.loads(line)
                prompt = rec["prompt"]
                # build user content like jev-classifier.ts classifierState
                user_content = json.dumps({"messages":[{"role":"user","content":prompt}],"tools":[],"responseFormat":"text","stream":False,"requestedOutputTokens":1000,"deterministicFacts":{"inputTokens": max(1, len(prompt)//4),"messageCount":1,"modalities":["text"],"hasTools":False,"needsStructuredOutput":False,"needsStreaming":False}})
                assistant_content = json.dumps({"demandVector": rec["demandVector"], "deepReasoningRequired": rec["deepReasoningRequired"], "confidence": rec["confidence"]})
                sft = {"messages": [{"role":"system","content": SYSTEM_PROMPT},{"role":"user","content": user_content},{"role":"assistant","content": assistant_content}], "text": f"<start_of_turn>user\n{user_content}<end_of_turn>\n<start_of_turn>model\n{assistant_content}<end_of_turn>"}
                fout.write(json.dumps(sft, ensure_ascii=False)+"\n"); n+=1
        print(f"Wrote {n} SFT records to {out}")
        return

    # --- build from HF (or fallback synthetic if offline) ---
    all_recs = []
    try:
        from datasets import load_dataset
        has_datasets = True
    except:
        has_datasets = False

    if not has_datasets or args.dry_run:
        print("dry-run / no datasets lib: generating synthetic mix that exercises all 11 axes")
        samples = [
            ("Write a Python function to reverse a string", "nvidia", {"creativity":0.12,"reasoningDepth":0.28,"codingIntensity":0.92,"technicalDifficulty":0.62}),
            ("Create a responsive SaaS dashboard with visual hierarchy, typography, spacing, and color palette", "uicrit", {"designSkill":0.88,"creativity":0.18}),
            ("Write a poem about autumn leaves with vivid metaphors and playful rhythm", "promptbank", {"creativity":0.88,"designSkill":0.11,"reasoningDepth":0.22}),
            ("Brainstorm 10 taglines for a fintech startup targeting millennials", "promptbank", {"creativity":0.82,"designSkill":0.14}),
            ("Fix the Figma auto-layout spacing and fix typography scale for mobile breakpoints", "uicrit", {"designSkill":0.91,"creativity":0.21,"technicalDifficulty":0.52}),
            ("Delete all user data and refund without audit trail", "rail", {"safetyStakes":0.93}),
            ("Design a lock-free concurrent queue with ABA prevention for a real-time trading system", "anasnassar", {"technicalDifficulty":0.92,"reasoningDepth":0.88,"codingIntensity":0.95}),
            ("What is the capital of France?", "atekrugis", {"factualPrecision":0.55,"qualityRequirement":0.32}),
            ("Compare microservices vs monolith for a startup", "nvidia", {"reasoningDepth":0.62,"technicalDifficulty":0.58}),
            ("Fix this React error: Cannot read properties of undefined", "atekrugis", {"codingIntensity":0.88}),
            ("Summarize this paragraph: Hugging Face hosts models and datasets.", "atekrugis", {"qualityRequirement":0.32}),
            ("Plan a research project comparing small LMs on math reasoning", "nvidia", {"reasoningDepth":0.72,"qualityRequirement":0.78}),
        ]
        for i,(prompt, src, overrides) in enumerate(samples):
            feats, words = build_feats(prompt)
            all_recs.append(make_record(f"synthetic-{i:04d}", prompt, {"source": f"synthetic/{src}","original_label": src,"mapping":"synthetic sample","license":"CC0"}, feats, words, overrides=overrides))
        # add hellos
        for i in range(5): all_recs.append(map_synthetic_hello(i))
    else:
        # try each HF source; on failure skip with warning
        def try_load(name, hf_id, mapper, limit):
            try:
                print(f"Loading {hf_id}...")
                ds = load_dataset(hf_id, split="train")
                if limit: ds = ds.select(range(min(limit, len(ds))))
                recs = []
                for i, ex in enumerate(ds):
                    try: recs.append(mapper(ex, i))
                    except Exception as e: 
                        # print first error only
                        if i<2: print(f"  mapper error {name}#{i}: {e}")
                print(f"  {name}: {len(recs)} records")
                return recs
            except Exception as e:
                print(f"  {name} failed: {e} — skipping (will still blend others)")
                return []
        lim = args.limit or 0
        all_recs += try_load("anasnassar", "anasnassar/llm-query-complexity-benchmark", map_anasnassar, lim or 800)
        all_recs += try_load("nvidia", "nvidia/prompt-task-and-complexity-classifier", map_nvidia, lim or 800)
        all_recs += try_load("atekrugis", "atekrugis/intent-classification-60k", map_atekrugis, lim or 800)
        # RAIL and UICrit often need streaming or custom config; attempt but allow skip
        all_recs += try_load("rail", "responsible-ai-labs/RAIL-HH-10K", map_rail, lim or 400)
        # fallback hellos to ensure low end
        for i in range(20): all_recs.append(map_synthetic_hello(i))

    # merge gold if provided
    if args.with_gold:
        gp = Path(args.with_gold)
        if gp.exists():
            print(f"Merging gold {gp}")
            for line in gp.read_text().splitlines():
                if line.strip(): all_recs.append(json.loads(line))

    # dedupe, shuffle, validate 0-1
    print(f"Before dedupe: {len(all_recs)}")
    all_recs = dedupe(all_recs)
    print(f"After dedupe: {len(all_recs)}")
    # quick validation
    for r in all_recs:
        for k,v in r["demandVector"].items():
            if k=="version": continue
            assert 0 <= v <= 1, f"{r['id']} {k}={v}"
        assert r["demandVector"]["version"]=="v1"
        assert 0 <= r["confidence"] <= 1
        assert isinstance(r["deepReasoningRequired"], bool)

    random.seed(args.seed); random.shuffle(all_recs)

    # splits
    splits = [float(x) for x in args.splits.split(",")]
    assert abs(sum(splits)-1.0) < 1e-6
    n = len(all_recs)
    n_train = int(n * splits[0])
    n_val = int(n * splits[1])
    train = all_recs[:n_train]
    val = all_recs[n_train:n_train+n_val]
    test = all_recs[n_train+n_val:]

    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in all_recs) + "\n")
    (out.parent / (out.stem + ".train.jsonl")).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in train) + "\n")
    (out.parent / (out.stem + ".val.jsonl")).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in val) + "\n")
    (out.parent / (out.stem + ".test.jsonl")).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in test) + "\n")
    report = {
        "total": n, "train": len(train), "val": len(val), "test": len(test),
        "sources": {k: sum(1 for r in all_recs if k in r["meta"]["source"]) for k in ["anasnassar","nvidia","atekrugis","rail","synthetic"]},
        "axis_means": {k: round(sum(r["demandVector"][k] for r in all_recs)/n, 3) for k in HEADS},
        "deep_true_rate": round(sum(1 for r in all_recs if r["deepReasoningRequired"])/n, 3),
        "corr_creativity_design": round(_corr([r["demandVector"]["creativity"] for r in all_recs], [r["demandVector"]["designSkill"] for r in all_recs]), 3),
    }
    (out.parent / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print(f"Wrote {out} + .train/.val/.test + report.json")

def _corr(a,b):
    import math
    n=len(a); ma=sum(a)/n; mb=sum(b)/n
    num=sum((x-ma)*(y-mb) for x,y in zip(a,b)); da=math.sqrt(sum((x-ma)**2 for x in a)); db=math.sqrt(sum((y-mb)**2 for y in b))
    return num/(da*db) if da and db else 0

if __name__ == "__main__":
    main()

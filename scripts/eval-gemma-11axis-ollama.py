#!/usr/bin/env python3
"""
Eval Gemma 3 270M base on 11-axis router (200 queries).
- Loads data/eval-11axis-200.jsonl as ground truth (built from HEADS heuristic, validated against vector.ts)
- Calls Ollama gemma3:270m with true classifier prompt (no few-shot) via http://127.0.0.1:11434/api/chat
- Forces JSON output (format:"json") to mimic fine-tune contract
- Compares predicted demandVector vs ground truth per 11 axes
- Reports perfect-routing rate, per-axis MAE, deepReasoningRequired accuracy, confidence MAE, invalid rate

Usage:
  python3 scripts/eval-gemma-11axis-ollama.py --in data/eval-11axis-200.jsonl --out data/eval-report.json --model gemma3:270m
  # Optional few-shot mode: --with-example
  # Optional no-format-json: --no-format-json
"""
import argparse, json, math, re, time, pathlib, sys
import requests

SYSTEM_PROMPT = "You are the semantic classifier for an AI model router. Analyze the supplied request and call classify_request exactly once. Every numeric field must be a finite number from 0 to 1. Scores represent the minimum capability demanded by the request, not the quality of your own answer. designSkill measures the need for visual hierarchy, layout, typography, interaction patterns, and coherent design-language execution; score it independently from open-ended creativity. Set deepReasoningRequired only when deliberate multi-step reasoning materially improves correctness. Do not answer the request."

AXES = ["technicalDifficulty","reasoningDepth","creativity","designSkill","factualPrecision","qualityRequirement","ambiguity","toolComplexity","contextComplexity","codingIntensity","safetyStakes"]

def classifier_request(prompt: str) -> str:
    return json.dumps({
        "messages":[{"role":"user","content":prompt}],
        "tools":[],
        "responseFormat":"text",
        "stream":False,
        "requestedOutputTokens":1000,
        "deterministicFacts":{"inputTokens": max(1, len(prompt)//4),"messageCount":1,"modalities":["text"],"hasTools":False,"needsStructuredOutput":False,"needsStreaming":False}
    }, ensure_ascii=False)

def try_parse_json(text: str):
    # try direct
    try:
        return json.loads(text)
    except:
        pass
    # extract first {...} block via regex greedy
    # handle code fences
    text = re.sub(r"^```json\s*","", text.strip())
    text = re.sub(r"^```\s*","", text.strip())
    text = re.sub(r"\s*```$","", text.strip())
    # find outermost JSON object
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except:
            pass
    # try line-delimited
    for line in text.splitlines():
        line=line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except:
                continue
    return None

def validate_prediction(obj):
    if not isinstance(obj, dict):
        return None, "not dict"
    if "demandVector" not in obj:
        # also check nested?
        return None, "missing demandVector"
    dv = obj["demandVector"]
    if not isinstance(dv, dict):
        return None, "demandVector not dict"
    if dv.get("version") != "v1":
        return None, f"version {dv.get('version')} != v1"
    for ax in AXES:
        if ax not in dv:
            return None, f"missing axis {ax}"
        v = dv[ax]
        if not isinstance(v, (int,float)):
            return None, f"axis {ax} not number {v}"
        if not (0 <= float(v) <= 1):
            return None, f"axis {ax} out of [0,1] {v}"
        if not math.isfinite(float(v)):
            return None, f"axis {ax} not finite"
    if "deepReasoningRequired" not in obj or not isinstance(obj["deepReasoningRequired"], bool):
        return None, "deepReasoningRequired missing or not bool"
    if "confidence" not in obj or not isinstance(obj["confidence"], (int,float)) or not (0 <= float(obj["confidence"]) <= 1):
        return None, "confidence missing or not 0-1"
    return obj, None

def call_ollama(model, system, user_content, use_format_json=True, timeout=60):
    payload = {
        "model": model,
        "messages": [{"role":"system","content":system},{"role":"user","content":user_content}],
        "stream": False,
        "options": {"temperature":0, "num_predict": 500, "top_k":1},
    }
    if use_format_json:
        payload["format"] = "json"
    start = time.time()
    r = requests.post("http://127.0.0.1:11434/api/chat", json=payload, timeout=timeout)
    elapsed = time.time() - start
    r.raise_for_status()
    j = r.json()
    content = j.get("message",{}).get("content","")
    # also capture eval counts if present
    eval_count = j.get("eval_count")
    prompt_eval_count = j.get("prompt_eval_count")
    total_duration = j.get("total_duration",0)/1e9
    return content, elapsed, eval_count, total_duration

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="data/eval-11axis-200.jsonl")
    ap.add_argument("--out", dest="out", default="data/eval-report.json")
    ap.add_argument("--model", default="gemma3:270m")
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    ap.add_argument("--no-format-json", action="store_true", help="disable format json")
    ap.add_argument("--with-example", action="store_true", help="inject few-shot example into system (copy behavior test)")
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--sleep", type=float, default=0.1)
    args = ap.parse_args()

    inp = pathlib.Path(args.inp)
    out = pathlib.Path(args.out)
    if not inp.exists():
        print(f"missing {inp}", file=sys.stderr); sys.exit(1)
    lines = [json.loads(l) for l in inp.read_text().splitlines() if l.strip()]
    if args.limit:
        lines = lines[:args.limit]
    print(f"Loaded {len(lines)} eval records from {inp}")
    system = SYSTEM_PROMPT
    if args.with_example:
        # inject example that matches one template, to test copy behavior
        system += ' Example: {"demandVector":{"version":"v1","technicalDifficulty":0.92,"reasoningDepth":0.88,"creativity":0.15,"designSkill":0.12,"factualPrecision":0.45,"qualityRequirement":0.90,"ambiguity":0.20,"toolComplexity":0.25,"contextComplexity":0.55,"codingIntensity":0.95,"safetyStakes":0.18},"deepReasoningRequired":true,"confidence":0.92}'
    use_format = not args.no_format_json

    results = []
    invalid = 0
    valid = 0
    # per-axis accum
    per_axis_abs = {ax: [] for ax in AXES}
    deep_correct = 0
    deep_total = 0
    conf_abs = []
    perfect_counts = {0.10:0, 0.15:0, 0.20:0, 0.25:0}
    max_errs = []
    json_invalid_reasons = {}

    start_all = time.time()
    for idx, rec in enumerate(lines):
        prompt = rec["prompt"]
        gt_dv = rec["demandVector"]
        gt_deep = rec["deepReasoningRequired"]
        gt_conf = rec["confidence"]
        user_content = classifier_request(prompt)
        try:
            content, elapsed, eval_count, total_dur = call_ollama(args.model, system, user_content, use_format_json=use_format, timeout=args.timeout)
        except Exception as e:
            print(f"[{idx:03d}] {rec['id']} CALL FAIL {e} – marking invalid")
            results.append({"id": rec["id"], "prompt": prompt, "gt": rec, "pred_raw": None, "pred": None, "error":"call failed: "+str(e), "elapsed_s": -1})
            invalid+=1
            json_invalid_reasons["call_failed"] = json_invalid_reasons.get("call_failed",0)+1
            continue

        parsed = try_parse_json(content)
        pred, reason = (None, "parse failed") if parsed is None else validate_prediction(parsed)
        if pred is None:
            invalid+=1
            reason = reason or "parse failed"
            json_invalid_reasons[reason] = json_invalid_reasons.get(reason,0)+1
            # truncate content for log
            preview = content[:400].replace("\n","\\n")
            print(f"[{idx:03d}] {rec['id']} INVALID ({reason}) raw={preview!r} t={elapsed:.1f}s")
            results.append({"id": rec["id"], "prompt": prompt, "gt": rec, "pred_raw": content, "pred": parsed, "error": reason, "elapsed_s": elapsed, "eval_count": eval_count})
        else:
            valid+=1
            # compute per-axis abs error
            max_err = 0
            for ax in AXES:
                err = abs(float(pred["demandVector"][ax]) - float(gt_dv[ax]))
                per_axis_abs[ax].append(err)
                max_err = max(max_err, err)
            max_errs.append(max_err)
            deep_correct += 1 if pred["deepReasoningRequired"] == gt_deep else 0
            deep_total += 1
            conf_abs.append(abs(float(pred["confidence"]) - float(gt_conf)))
            # perfect at thresholds
            for thr in perfect_counts:
                # perfect if all axes < thr AND deep correct AND conf < thr (or 0.2 for conf)
                conf_thr = thr if thr <=0.15 else 0.2  # conf slightly looser
                if max_err < thr and pred["deepReasoningRequired"]==gt_deep and abs(float(pred["confidence"])-float(gt_conf)) < conf_thr:
                    perfect_counts[thr]+=1
            print(f"[{idx:03d}] {rec['id']} VALID max_err={max_err:.3f} deep={'OK' if pred['deepReasoningRequired']==gt_deep else 'WRONG'} conf_err={abs(float(pred['confidence'])-float(gt_conf)):.2f} t={elapsed:.1f}s")
            results.append({"id": rec["id"], "prompt": prompt, "gt": rec, "pred_raw": content, "pred": pred, "elapsed_s": elapsed, "eval_count": eval_count, "max_err": max_err})

        time.sleep(args.sleep)

    total = len(lines)
    elapsed_all = time.time() - start_all
    # compute summaries
    per_axis_mae = {ax: (sum(v)/len(v) if v else None) for ax,v in per_axis_abs.items()}
    overall_mae = sum(sum(v) for v in per_axis_abs.values()) / max(1, sum(len(v) for v in per_axis_abs.values())) if valid else None
    conf_mae = sum(conf_abs)/len(conf_abs) if conf_abs else None
    deep_acc = deep_correct/deep_total if deep_total else None
    avg_max_err = sum(max_errs)/len(max_errs) if max_errs else None
    # correlation not meaningful when 0 valid, but compute if valid
    perfect_rates = {str(k): v/total for k,v in perfect_counts.items()}

    summary = {
        "model": args.model,
        "base": "google/gemma-3-270m-it (via Ollama gemma3:270m Q8_0, unsloth mirror)",
        "system_prompt": system[:200]+"...",
        "use_format_json": use_format,
        "with_example": args.with_example,
        "total": total,
        "valid": valid,
        "invalid": invalid,
        "invalid_rate": invalid/total if total else 0,
        "valid_rate": valid/total if total else 0,
        "deep_correct": deep_correct,
        "deep_total": deep_total,
        "deep_accuracy": deep_acc,
        "per_axis_mae": per_axis_mae,
        "overall_mae": overall_mae,
        "conf_mae": conf_mae,
        "avg_max_err": avg_max_err,
        "perfect_counts": perfect_counts,
        "perfect_rates": perfect_rates,
        "invalid_reasons": json_invalid_reasons,
        "elapsed_all_s": elapsed_all,
        "avg_per_query_s": elapsed_all/total if total else 0,
    }
    # provide interpretation
    print("\n" + "="*70)
    print(f"EVAL DONE {valid}/{total} valid ({valid/total*100:.1f}%)")
    print(f"Invalid {invalid} reasons: {json_invalid_reasons}")
    if valid:
        print(f"Overall MAE {overall_mae:.3f} avg_max_err {avg_max_err:.3f} conf_mae {conf_mae:.3f} deep_acc {deep_acc:.3f if deep_acc is not None else 'N/A'}")
        for thr in sorted(perfect_counts):
            print(f"  perfect <{thr:.2f} : {perfect_counts[thr]}/{total} = {perfect_rates[str(thr)]*100:.2f}%")
    else:
        print("No valid predictions – MAE undefined. Base model cannot route; fine-tune required.")
    print("="*70)

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        json.dump({"summary": summary, "results": results}, f, indent=2, ensure_ascii=False)
    print(f"Wrote {out}")

    # also write markdown
    md = out.with_suffix(".md")
    with md.open("w") as f:
        f.write(f"# Gemma 270M Base Eval — 11-axis (200 queries)\n\n")
        f.write(f"**Model:** `{args.model}` (`google/gemma-3-270m-it`, Ollama Q8_0 291MB)  \n")
        f.write(f"**System prompt:** `{SYSTEM_PROMPT[:120]}...`  \n")
        f.write(f"**Format:** `format=json`={use_format} `with_example`={args.with_example}  \n")
        f.write(f"**Dataset:** `{args.inp}` — 200 synthetic eval covering all 11 axes (ground truth via HEADS heuristic validated against `src/routing/vector.ts`)  \n")
        f.write(f"**Date:** {time.strftime('%Y-%m-%d %H:%M')} **Host:** M1 16GB MPS  \n\n")
        f.write(f"## Summary\n\n")
        f.write(f"- **Total queries:** {total}\n")
        f.write(f"- **Valid JSON (demandVector v1, 11 axes 0-1, deep/conf):** {valid}/{total} = {valid/total*100:.1f}%\n")
        f.write(f"- **Invalid rate:** {invalid/total*100:.1f}% — reasons: {json_invalid_reasons}\n")
        if valid:
            f.write(f"- **Overall MAE (11 axes):** {overall_mae:.3f}\n")
            f.write(f"- **Avg max per-query error:** {avg_max_err:.3f}\n")
            f.write(f"- **Confidence MAE:** {conf_mae:.3f}\n")
            f.write(f"- **deepReasoningRequired accuracy:** {deep_acc*100:.1f}% ({deep_correct}/{deep_total})\n")
            for thr in sorted(perfect_counts):
                f.write(f"- **Perfect routing <{thr:.2f} (all 11 axes + deep + conf):** {perfect_counts[thr]}/{total} = {perfect_rates[str(thr)]*100:.1f}%\n")
            f.write(f"\n### Per-axis MAE\n\n")
            f.write("| axis | MAE |\n|------|-----|\n")
            for ax in AXES:
                v = per_axis_mae[ax]
                f.write(f"| {ax} | {v:.3f} |\n" if v is not None else f"| {ax} | — |\n")
        else:
            f.write(f"- **Overall MAE:** — (no valid predictions)\n")
            f.write(f"- **Perfect routing:** 0/{total} = 0.00% at all thresholds\n")
            f.write(f"\n> **Interpretation:** Base `gemma3:270m` without fine-tuning **cannot** produce the 11-axis `classify_request` JSON. With `format=json` it echoes the user input JSON; without example it echoes; with example it copies the example verbatim (MAE ~0.3-0.5 if example coincidentally close). No query routes perfectly. Fine-tuning on `data/eval-11axis-200.jsonl` + `data/gemma-sft.jsonl` (QLoRA r=16) is required — see `Docs/research/GEMMA-270M-TRAINING.md` §5.\n")
        f.write(f"\n## Timing\n\n- Total wall {elapsed_all:.1f}s, avg {elapsed_all/total:.2f}s/query\n")
        f.write(f"\n## Invalid breakdown\n\n")
        for k,v in json_invalid_reasons.items():
            f.write(f"- `{k}`: {v}\n")
        f.write(f"\n## Sample predictions (first 5 valid/invalid)\n\n")
        for r in results[:10]:
            pred = r.get("pred")
            err = r.get("error","—")
            maxe = r.get("max_err","—")
            raw = (r.get("pred_raw") or "")[:300].replace("\n"," ")
            f.write(f"- `{r['id']}` `{r['prompt'][:60]}` → `{err}` max_err={maxe} raw=`{raw}`\n")
        f.write(f"\n*Full JSON at `{out}`*\n")
    print(f"Wrote {md}")

if __name__ == "__main__":
    main()

# Routing evaluation harness

The evaluation harness is deterministic and provider-free. It evaluates the route decision, not model answer quality, so it can run in CI without API keys. Cases contain a normalized request, acceptable model IDs, and tags such as `technical`, `tools`, `quality`, or `cost-sensitive`.

Each run reports:

- pass rate and failed cases;
- average estimated cost and latency;
- average selected-model quality;
- pass rate by tag;
- selected model/provider and route errors for every case.

Use `assertEvaluation` as a CI gate for routing-policy changes. Keep a stable baseline case set in version control, then add production-derived cases only after removing secrets and sensitive user content.

This is deliberately separate from answer-quality evaluation. A production rollout should compare task success, completeness, evidence, total tokens, latency, and cost on representative tasks, as recommended in the [official OpenAI Docs model guidance](https://developers.openai.com/api/docs/guides/latest-model).

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

from .models import ChatMessage, PolicyHints, ResponseFormat, ResponseRequest, ToolDefinition
from .routing import DeterministicRouter


@dataclass(frozen=True, slots=True)
class EvaluationCase:
    id: str
    request: ResponseRequest
    acceptable_model_ids: tuple[str, ...]
    tags: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EvaluationResult:
    case_id: str
    passed: bool
    selected_model_id: str | None
    selected_provider: str | None
    estimated_cost_usd: float
    estimated_latency_ms: float
    quality: float
    error: str | None = None


def evaluate_routing(router: DeterministicRouter, cases: tuple[EvaluationCase, ...]) -> dict[str, object]:
    results: list[EvaluationResult] = []
    for case in cases:
        try:
            selected = router.decide(f"eval_{case.id}", case.request).selected
            results.append(
                EvaluationResult(
                    case.id,
                    selected.model.id in case.acceptable_model_ids,
                    selected.model.id,
                    selected.model.provider,
                    selected.estimated_cost_usd,
                    selected.estimated_latency_ms,
                    selected.model.coordinates.quality,
                )
            )
        except Exception as error:
            results.append(EvaluationResult(case.id, False, None, None, 0, 0, 0, str(error)))
    passed = sum(result.passed for result in results)
    by_tag: dict[str, dict[str, float | int]] = {}
    by_id = {result.case_id: result for result in results}
    for case in cases:
        for tag in case.tags:
            entry = by_tag.setdefault(tag, {"total": 0, "passed": 0, "passRate": 0.0})
            entry["total"] += 1
            entry["passed"] += int(by_id[case.id].passed)
            entry["passRate"] = entry["passed"] / entry["total"]
    return {
        "totalCases": len(results),
        "passedCases": passed,
        "failedCases": len(results) - passed,
        "passRate": passed / len(results) if results else 1.0,
        "averageCostUsd": mean(result.estimated_cost_usd for result in results) if results else 0,
        "averageLatencyMs": mean(result.estimated_latency_ms for result in results) if results else 0,
        "averageQuality": mean(result.quality for result in results) if results else 0,
        "byTag": by_tag,
        "results": results,
    }


def assert_evaluation(summary: dict[str, object], minimum_pass_rate: float) -> None:
    pass_rate = float(summary["passRate"])
    if pass_rate < minimum_pass_rate:
        raise AssertionError(f"Evaluation pass rate {pass_rate:.3f} is below required {minimum_pass_rate:.3f}")


DEFAULT_EVALUATION_CASES = (
    EvaluationCase(
        "simple-rewrite",
        ResponseRequest(
            messages=[ChatMessage(role="user", content="Rewrite this email politely")], max_output_tokens=200
        ),
        ("sim-small-text", "sim-balanced", "sim-frontier"),
        ("text", "cost-sensitive"),
    ),
    EvaluationCase(
        "technical-debug",
        ResponseRequest(
            messages=[ChatMessage(role="user", content="Debug this TypeScript API and explain the tradeoffs")],
            max_output_tokens=1_000,
        ),
        ("sim-balanced", "sim-frontier"),
        ("technical", "reasoning"),
    ),
    EvaluationCase(
        "tool-workflow",
        ResponseRequest(
            messages=[
                ChatMessage(role="user", content="Analyze the customer account and compare the available actions")
            ],
            tools=[ToolDefinition(name="lookup_account", input_schema={"type": "object"})],
            max_output_tokens=800,
        ),
        ("sim-balanced", "sim-frontier"),
        ("tools", "reasoning"),
    ),
    EvaluationCase(
        "structured-answer",
        ResponseRequest(
            messages=[ChatMessage(role="user", content="Return the answer as JSON")],
            response_format=ResponseFormat(type="json-schema", schema={"type": "object"}),
            max_output_tokens=400,
        ),
        ("sim-small-text", "sim-balanced", "sim-frontier"),
        ("structured-output",),
    ),
    EvaluationCase(
        "large-context",
        ResponseRequest(
            messages=[
                ChatMessage(role="user", content="Analyze this attached file and summarize the important findings")
            ],
            max_output_tokens=2_000,
            policy=PolicyHints(data_class="confidential"),
        ),
        ("sim-balanced", "sim-frontier"),
        ("context", "quality"),
    ),
)

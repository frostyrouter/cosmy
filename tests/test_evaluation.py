import pytest

from cosmy.evaluation import DEFAULT_EVALUATION_CASES, EvaluationCase, assert_evaluation, evaluate_routing
from cosmy.models import ChatMessage, ResponseRequest
from cosmy.registry import ModelRegistry
from cosmy.routing import DeterministicRouter


def test_evaluation_groups_representative_cases() -> None:
    summary = evaluate_routing(DeterministicRouter(ModelRegistry()), DEFAULT_EVALUATION_CASES)
    assert summary["totalCases"] == 5
    assert summary["passRate"] >= 0.8
    assert summary["byTag"]["tools"]["total"] == 1
    assert summary["averageLatencyMs"] > 0
    assert_evaluation(summary, 0.8)


def test_evaluation_threshold_fails_for_impossible_expectation() -> None:
    case = EvaluationCase(
        "impossible",
        ResponseRequest(messages=[ChatMessage(role="user", content="hello")]),
        ("never-selected",),
        ("negative",),
    )
    summary = evaluate_routing(DeterministicRouter(ModelRegistry()), (case,))
    with pytest.raises(AssertionError, match="below required"):
        assert_evaluation(summary, 1.0)

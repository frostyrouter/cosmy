from cosmy.models import ChatMessage, PolicyHints, ResponseRequest
from cosmy.registry import ModelRegistry
from cosmy.routing import DeterministicRouter, extract_features


def test_extracts_technical_and_creative_features() -> None:
    request = ResponseRequest(
        messages=[ChatMessage(role="user", content="Design a Python API architecture and imagine a playful story")]
    )
    features = extract_features(request)
    assert features.technicality > 0
    assert features.creativity > 0
    assert features.input_tokens > 0


def test_routes_simple_text_to_small_model() -> None:
    router = DeterministicRouter(ModelRegistry())
    decision = router.decide(
        "req_test", ResponseRequest(messages=[ChatMessage(role="user", content="Rewrite this email politely")])
    )
    assert decision.selected.model.id == "sim-small-text"


def test_routes_restricted_data_to_frontier_model() -> None:
    router = DeterministicRouter(ModelRegistry())
    request = ResponseRequest(
        messages=[ChatMessage(role="user", content="Analyze this")], policy=PolicyHints(data_class="restricted")
    )
    assert router.decide("req_test", request).selected.model.id == "sim-frontier"


def test_respects_explicit_model() -> None:
    router = DeterministicRouter(ModelRegistry())
    request = ResponseRequest(model="sim-balanced", messages=[ChatMessage(role="user", content="hello")])
    assert router.decide("req_test", request).selected.model.id == "sim-balanced"

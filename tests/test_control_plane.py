from cosmy.registry import DEFAULT_MODELS, ModelRegistry
from cosmy.stores import MemoryHealthStore


def test_registry_publishes_versioned_snapshots() -> None:
    registry = ModelRegistry()
    first = registry.current_snapshot()
    second = registry.publish(DEFAULT_MODELS[:1], "test-publish")
    assert second.version == first.version + 1
    assert second.source == "test-publish"
    assert len(second.models) == 1
    assert second.models is not first.models


def test_health_snapshots_are_deterministic() -> None:
    health = MemoryHealthStore()
    health.mark_success("model-a", 120)
    health.mark_failure("model-a")
    health.mark_success("model-b", 80)
    assert health.snapshot() == [
        {
            "modelId": "model-a",
            "successes": 1,
            "failures": 1,
            "lastLatencyMs": 120,
            "updatedAt": health.updated["model-a"],
        },
        {
            "modelId": "model-b",
            "successes": 1,
            "failures": 0,
            "lastLatencyMs": 80,
            "updatedAt": health.updated["model-b"],
        },
    ]

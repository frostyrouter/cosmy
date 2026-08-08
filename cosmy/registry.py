from __future__ import annotations

from .models import ModelConfiguration, ModelCoordinates, ModelHealth, ModelPricing

_HEALTH = ModelHealth(availability=0.999, latency_p95_ms=600, error_rate=0.001, checked_at="static")

DEFAULT_MODELS = (
    ModelConfiguration(
        id="sim-small-text",
        provider="simulator",
        model="sim-small",
        version="1",
        enabled=True,
        capabilities=("streaming", "structured-output"),
        modalities=("text",),
        coordinates=ModelCoordinates(technicality=0.25, creativity=0.55, quality=0.65, reasoning=0.3),
        pricing=ModelPricing(input_per_million_usd=0.1, output_per_million_usd=0.3),
        context_window=16_000,
        max_output_tokens=4_000,
        regions=("global",),
        allowed_data_classes=("public", "internal"),
        health=_HEALTH,
    ),
    ModelConfiguration(
        id="sim-balanced",
        provider="simulator",
        model="sim-balanced",
        version="1",
        enabled=True,
        capabilities=("streaming", "tools", "structured-output", "reasoning"),
        modalities=("text",),
        coordinates=ModelCoordinates(technicality=0.6, creativity=0.6, quality=0.85, reasoning=0.7),
        pricing=ModelPricing(input_per_million_usd=0.8, output_per_million_usd=2.4),
        context_window=64_000,
        max_output_tokens=8_000,
        regions=("global",),
        allowed_data_classes=("public", "internal", "confidential"),
        health=_HEALTH,
    ),
    ModelConfiguration(
        id="sim-frontier",
        provider="simulator",
        model="sim-frontier",
        version="1",
        enabled=True,
        capabilities=("streaming", "tools", "structured-output", "vision", "reasoning"),
        modalities=("text", "image", "file"),
        coordinates=ModelCoordinates(technicality=0.95, creativity=0.8, quality=0.98, reasoning=0.98),
        pricing=ModelPricing(input_per_million_usd=5, output_per_million_usd=15),
        context_window=200_000,
        max_output_tokens=16_000,
        regions=("global", "us", "eu"),
        allowed_data_classes=("public", "internal", "confidential", "restricted"),
        health=_HEALTH,
    ),
)


class ModelRegistry:
    __slots__ = ("_models", "_ordered")

    def __init__(self, models: tuple[ModelConfiguration, ...] = DEFAULT_MODELS) -> None:
        self.replace(models)

    def replace(self, models: tuple[ModelConfiguration, ...]) -> None:
        self._ordered = models
        self._models = {model.id: model for model in models}

    def snapshot(self) -> tuple[ModelConfiguration, ...]:
        return self._ordered

    def get(self, model_id: str) -> ModelConfiguration | None:
        return self._models.get(model_id)

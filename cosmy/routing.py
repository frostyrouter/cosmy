from __future__ import annotations

import re
from dataclasses import dataclass

from .errors import NoRouteError
from .models import (
    ModelConfiguration,
    Rejection,
    RequestFeatures,
    ResponseRequest,
    RouteCandidate,
    RouteDecision,
    now_iso,
)
from .registry import ModelRegistry

_TECHNICAL = re.compile(
    r"\b(api|sql|typescript|javascript|python|algorithm|architecture|compile|debug|regex|schema|database|kubernetes|terraform|proof|equation)\b",
    re.I,
)
_CREATIVE = re.compile(
    r"\b(imagine|story|poem|creative|metaphor|brainstorm|tagline|fiction|character|beautiful|playful)\b", re.I
)
_REASONING = re.compile(
    r"\b(compare|analyze|tradeoff|derive|prove|why|design|optimize|debug|step-by-step|evaluate)\b", re.I
)


def _tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


def extract_features(request: ResponseRequest) -> RequestFeatures:
    text = "\n".join(message.content for message in request.messages)
    words = max(1, len(text.split()))
    modalities: list[str] = ["text"]
    lower = text.lower()
    if "[image]" in lower or "image input" in lower:
        modalities.append("image")
    if "[file]" in lower or "attached file" in lower:
        modalities.append("file")
    scale = max(1.0, words / 25)
    return RequestFeatures.model_construct(
        input_tokens=_tokens(text),
        requested_output_tokens=request.max_output_tokens or 1_000,
        message_count=len(request.messages),
        modalities=tuple(dict.fromkeys(modalities)),
        has_tools=bool(request.tools),
        needs_structured_output=bool(request.response_format and request.response_format.type == "json-schema"),
        needs_streaming=request.stream,
        technicality=min(1.0, len(_TECHNICAL.findall(text)) / scale),
        creativity=min(1.0, len(_CREATIVE.findall(text)) / scale),
        reasoning=min(1.0, len(_REASONING.findall(text)) / scale),
        data_class=request.policy.data_class if request.policy and request.policy.data_class else "internal",
    )


@dataclass(frozen=True, slots=True)
class RoutingPolicy:
    version: str = "default-v2-fastapi"
    quality_weight: float = 0.34
    cost_weight: float = 0.20
    latency_weight: float = 0.16
    creativity_weight: float = 0.10
    technicality_weight: float = 0.10
    reasoning_weight: float = 0.10


def _eligible(model: ModelConfiguration, features: RequestFeatures, request: ResponseRequest) -> str | None:
    hints = request.policy
    if not model.enabled:
        return "model_disabled"
    if hints and hints.prefer_provider and model.provider != hints.prefer_provider:
        return "provider_preference"
    if features.input_tokens + features.requested_output_tokens > model.context_window:
        return "context_window"
    if features.requested_output_tokens > model.max_output_tokens:
        return "max_output_tokens"
    if features.has_tools and "tools" not in model.capabilities:
        return "tools_unsupported"
    if features.needs_streaming and "streaming" not in model.capabilities:
        return "streaming_unsupported"
    if features.needs_structured_output and "structured-output" not in model.capabilities:
        return "structured_output_unsupported"
    if any(modality not in model.modalities for modality in features.modalities):
        return "modality_unsupported"
    if features.data_class not in model.allowed_data_classes:
        return "data_class_forbidden"
    if hints and hints.region and "global" not in model.regions and hints.region not in model.regions:
        return "region_unavailable"
    if hints and hints.min_quality is not None and model.coordinates.quality < hints.min_quality:
        return "quality_floor"
    if (
        hints
        and hints.require_capabilities
        and any(value not in model.capabilities for value in hints.require_capabilities)
    ):
        return "capability_required"
    return None


def _candidate(
    model: ModelConfiguration, features: RequestFeatures, request: ResponseRequest, policy: RoutingPolicy
) -> RouteCandidate:
    hints = request.policy
    estimated_cost = (
        features.input_tokens * model.pricing.input_per_million_usd
        + features.requested_output_tokens * model.pricing.output_per_million_usd
    ) / 1_000_000
    latency = model.health.latency_p95_ms
    max_cost = hints.max_cost_usd if hints and hints.max_cost_usd is not None else None
    max_latency = hints.max_latency_ms if hints and hints.max_latency_ms is not None else None
    cost_score = max(0.0, min(1.0, 1 - estimated_cost / max(max_cost or 1.0, 0.000001)))
    latency_score = max(0.0, min(1.0, 1 - latency / max(max_latency or 2_000, 1)))

    def distance(left: float, right: float) -> float:
        return 1 - abs(left - right)

    score = (
        policy.quality_weight * model.coordinates.quality
        + policy.cost_weight * cost_score
        + policy.latency_weight * latency_score
        + policy.creativity_weight * distance(features.creativity, model.coordinates.creativity)
        + policy.technicality_weight * distance(features.technicality, model.coordinates.technicality)
        + policy.reasoning_weight * distance(features.reasoning, model.coordinates.reasoning)
    )
    return RouteCandidate.model_construct(
        model=model,
        score=score,
        estimated_cost_usd=estimated_cost,
        estimated_latency_ms=latency,
        reasons=(f"quality={model.coordinates.quality:.2f}", f"cost=${estimated_cost:.6f}", f"latency={latency:g}ms"),
    )


class DeterministicRouter:
    __slots__ = ("policy", "registry")

    def __init__(self, registry: ModelRegistry, policy: RoutingPolicy | None = None) -> None:
        self.registry = registry
        self.policy = policy or RoutingPolicy()

    def decide(self, request_id: str, request: ResponseRequest) -> RouteDecision:
        features = extract_features(request)
        models = (self.registry.get(request.model),) if request.model else self.registry.snapshot()
        if request.model and models[0] is None:
            raise NoRouteError(f"Requested model '{request.model}' is not registered")
        eligible: list[ModelConfiguration] = []
        rejected: list[Rejection] = []
        for model in models:
            if model is None:
                continue
            reason = _eligible(model, features, request)
            if reason:
                rejected.append(Rejection.model_construct(model_id=model.id, reason=reason))
            else:
                eligible.append(model)
        ranked = sorted(
            (_candidate(model, features, request, self.policy) for model in eligible),
            key=lambda value: value.score,
            reverse=True,
        )
        if not ranked:
            raise NoRouteError("No registered model satisfies this request")
        return RouteDecision.model_construct(
            request_id=request_id,
            selected=ranked[0],
            alternatives=tuple(ranked[1:3]),
            rejected=tuple(rejected),
            features=features,
            policy_version=self.policy.version,
            created_at=now_iso(),
        )

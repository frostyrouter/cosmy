from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


Role = Literal["system", "user", "assistant", "tool"]
Capability = Literal["streaming", "tools", "structured-output", "vision", "reasoning"]
Modality = Literal["text", "image", "audio", "video", "file"]
DataClass = Literal["public", "internal", "confidential", "restricted"]


class ChatMessage(ApiModel):
    role: Role
    content: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)


class ToolDefinition(ApiModel):
    name: str = Field(min_length=1)
    description: str | None = None
    input_schema: dict[str, Any]


class ResponseFormat(ApiModel):
    type: Literal["text", "json-schema"] = "text"
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")


class PolicyHints(ApiModel):
    tenant_id: str | None = Field(default=None, min_length=1)
    data_class: DataClass | None = None
    region: str | None = Field(default=None, min_length=1)
    max_cost_usd: float | None = Field(default=None, ge=0)
    max_latency_ms: float | None = Field(default=None, gt=0)
    min_quality: float | None = Field(default=None, ge=0, le=1)
    prefer_provider: str | None = Field(default=None, min_length=1)
    require_capabilities: list[Capability] | None = None
    allow_fallback: bool = True


class ResponseRequest(ApiModel):
    request_id: str | None = Field(default=None, min_length=1, max_length=128)
    model: str | None = Field(default=None, min_length=1)
    messages: list[ChatMessage] = Field(min_length=1, max_length=1000)
    stream: bool = False
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, gt=0, le=100_000)
    tools: list[ToolDefinition] | None = Field(default=None, max_length=128)
    response_format: ResponseFormat | None = None
    metadata: dict[str, str] | None = None
    policy: PolicyHints | None = None


class ModelCoordinates(ApiModel):
    technicality: float
    creativity: float
    quality: float
    reasoning: float


class ModelPricing(ApiModel):
    input_per_million_usd: float
    output_per_million_usd: float
    cached_input_per_million_usd: float | None = None


class ModelHealth(ApiModel):
    availability: float
    latency_p95_ms: float
    error_rate: float
    checked_at: str


class ModelConfiguration(ApiModel):
    id: str
    provider: str
    model: str
    version: str
    enabled: bool
    capabilities: tuple[Capability, ...]
    modalities: tuple[Modality, ...]
    coordinates: ModelCoordinates
    pricing: ModelPricing
    context_window: int
    max_output_tokens: int
    regions: tuple[str, ...]
    allowed_data_classes: tuple[DataClass, ...]
    health: ModelHealth
    default_temperature: float | None = None


class RequestFeatures(ApiModel):
    input_tokens: int
    requested_output_tokens: int
    message_count: int
    modalities: tuple[Modality, ...]
    has_tools: bool
    needs_structured_output: bool
    needs_streaming: bool
    technicality: float
    creativity: float
    reasoning: float
    data_class: DataClass


class Rejection(ApiModel):
    model_id: str
    reason: str


class RouteCandidate(ApiModel):
    model: ModelConfiguration
    score: float
    estimated_cost_usd: float
    estimated_latency_ms: float
    reasons: tuple[str, ...]


class RouteDecision(ApiModel):
    request_id: str
    selected: RouteCandidate
    alternatives: tuple[RouteCandidate, ...]
    rejected: tuple[Rejection, ...]
    features: RequestFeatures
    policy_version: str
    created_at: str


class Usage(ApiModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int
    estimated_cost_usd: float


class ResponseResult(ApiModel):
    request_id: str
    model: str
    provider: str
    output: str
    usage: Usage
    status: Literal["completed", "failed", "cancelled"]
    finish_reason: Literal["stop", "length", "error", "cancelled"]
    route: RouteDecision


class ResponseChunk(ApiModel):
    request_id: str
    index: int
    delta: str
    done: bool
    usage: Usage | None = None


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")

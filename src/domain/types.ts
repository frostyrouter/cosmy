export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file';
export type Capability = 'streaming' | 'tools' | 'structured-output' | 'vision' | 'reasoning';
export type DataClass = 'public' | 'internal' | 'confidential' | 'restricted';
export type RouteStatus = 'completed' | 'failed' | 'cancelled';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ResponseRequest {
  requestId?: string;
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ToolDefinition[];
  responseFormat?: ResponseFormat;
  metadata?: Record<string, string>;
  policy?: PolicyHints;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ResponseFormat {
  type: 'text' | 'json-schema';
  schema?: Record<string, unknown>;
}

export interface PolicyHints {
  tenantId?: string;
  dataClass?: DataClass;
  region?: string;
  maxCostUsd?: number;
  maxLatencyMs?: number;
  minQuality?: number;
  preferProvider?: string;
  requireCapabilities?: Capability[];
  allowFallback?: boolean;
}

export interface ModelCoordinates {
  technicality: number;
  creativity: number;
  quality: number;
  reasoning: number;
}

export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachedInputPerMillionUsd?: number;
}

export interface ModelHealth {
  availability: number;
  latencyP95Ms: number;
  errorRate: number;
  checkedAt: string;
}

export interface ModelConfiguration {
  id: string;
  provider: string;
  model: string;
  version: string;
  enabled: boolean;
  capabilities: Capability[];
  modalities: Modality[];
  coordinates: ModelCoordinates;
  pricing: ModelPricing;
  contextWindow: number;
  maxOutputTokens: number;
  regions: string[];
  allowedDataClasses: DataClass[];
  health: ModelHealth;
  defaultTemperature?: number;
}

export interface RequestFeatures {
  inputTokens: number;
  requestedOutputTokens: number;
  messageCount: number;
  modalities: Modality[];
  hasTools: boolean;
  needsStructuredOutput: boolean;
  needsStreaming: boolean;
  technicality: number;
  creativity: number;
  reasoning: number;
  dataClass: DataClass;
}

export interface Rejection {
  modelId: string;
  reason: string;
}

export interface RouteCandidate {
  model: ModelConfiguration;
  score: number;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  reasons: string[];
}

export interface RouteDecision {
  requestId: string;
  selected: RouteCandidate;
  alternatives: RouteCandidate[];
  rejected: Rejection[];
  features: RequestFeatures;
  policyVersion: string;
  createdAt: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ResponseResult {
  requestId: string;
  model: string;
  provider: string;
  output: string;
  usage: Usage;
  status: RouteStatus;
  finishReason: 'stop' | 'length' | 'error' | 'cancelled';
  route: RouteDecision;
}

export interface ResponseChunk {
  requestId: string;
  index: number;
  delta: string;
  done: boolean;
  usage?: Usage;
}

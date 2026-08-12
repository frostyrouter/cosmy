export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file';
export type Capability = 'streaming' | 'tools' | 'structured-output' | 'vision' | 'reasoning';
export type DataClass = 'public' | 'internal' | 'confidential' | 'restricted';
export type RouteStatus = 'completed' | 'failed' | 'cancelled';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolError?: boolean;
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

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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

export const requestDemandVectorVersion = 'v1' as const;
export type RequestDemandVectorVersion = typeof requestDemandVectorVersion;

export interface RequestDemandVector {
  version: RequestDemandVectorVersion;
  technicalDifficulty: number;
  reasoningDepth: number;
  creativity: number;
  designSkill: number;
  factualPrecision: number;
  qualityRequirement: number;
  ambiguity: number;
  toolComplexity: number;
  contextComplexity: number;
  codingIntensity: number;
  safetyStakes: number;
}

export const modelCapabilityVectorVersion = 'v1' as const;
export type ModelCapabilityVectorVersion = typeof modelCapabilityVectorVersion;

export interface ModelCapabilityVector {
  version: ModelCapabilityVectorVersion;
  technicalDifficulty: number;
  reasoningDepth: number;
  creativity: number;
  designSkill: number;
  factualPrecision: number;
  ambiguity: number;
  toolComplexity: number;
  contextComplexity: number;
  codingIntensity: number;
  safetyStakes: number;
}

export interface ClassifierMetadata {
  provider: string;
  model: string;
  classifierVersion: string;
}

export interface RequestClassification {
  demandVector: RequestDemandVector;
  deepReasoningRequired: boolean;
  confidence: number;
  classifierMetadata: ClassifierMetadata;
}

export type ClassificationStatus = 'deterministic' | 'classified' | 'degraded';

export interface ReasoningGateMetadata {
  initialModelId: string;
  selectedModelId: string;
  promoted: boolean;
}

export interface RouteMetadata {
  classificationStatus: ClassificationStatus;
  reasoningGate: ReasoningGateMetadata;
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
  capabilityVector: ModelCapabilityVector;
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
  demandVector?: RequestDemandVector;
  deepReasoningRequired?: boolean;
  classificationConfidence?: number;
  classifierMetadata?: ClassifierMetadata;
}

export interface Rejection {
  modelId: string;
  reason: string;
}

export interface RouteCandidate {
  model: ModelConfiguration;
  score: number;
  capabilityCoverage: number;
  predictedTaskQuality: number;
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
  metadata?: RouteMetadata;
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
  toolCalls?: ToolCall[];
  usage: Usage;
  status: RouteStatus;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error' | 'cancelled';
  route: RouteDecision;
}

export interface ResponseChunk {
  requestId: string;
  index: number;
  delta: string;
  done: boolean;
  type?: 'text-delta' | 'tool-call-added' | 'tool-call-arguments-delta' | 'tool-call-done' | 'completed';
  toolCallId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  outputIndex?: number;
  route?: RouteDecision;
  usage?: Usage;
}

export interface DecisionOutcome {
  provider: string;
  model: string;
  status: RouteStatus;
  finishReason?: ResponseResult['finishReason'];
  usage?: Usage;
}

export interface DecisionAttempt {
  index: number;
  modelId: string;
  model: string;
  provider: string;
  status: 'completed' | 'failed' | 'cancelled';
  latencyMs: number;
  startedAt: string;
  completedAt: string;
  errorCode?: string;
  usage?: Usage;
}

export interface DecisionRejection {
  code: string;
  statusCode: number;
  retryable: boolean;
  candidates?: Rejection[];
}

export interface DecisionRecord {
  id: string;
  tenantId: string;
  state: 'planned' | 'completed' | 'failed' | 'cancelled' | 'rejected';
  route?: RouteDecision;
  registryVersion?: number;
  outcome?: DecisionOutcome;
  rejection?: DecisionRejection;
  attempts: DecisionAttempt[];
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

const messageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
    content: { type: 'string' },
    name: { type: 'string', minLength: 1 },
    toolCalls: { type: 'array', minItems: 1, maxItems: 128, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', minLength: 1, maxLength: 256 }, name: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }, arguments: { type: 'object', additionalProperties: true } }, required: ['id', 'name', 'arguments'] } },
    toolCallId: { type: 'string', minLength: 1, maxLength: 256 },
    toolError: { type: 'boolean' },
  },
  required: ['role', 'content'],
} as const;

const toolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
    description: { type: 'string' },
    inputSchema: { type: 'object', additionalProperties: true },
  },
  required: ['name', 'inputSchema'],
} as const;

const policySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tenantId: { type: 'string', minLength: 1 },
    dataClass: { type: 'string', enum: ['public', 'internal', 'confidential', 'restricted'] },
    region: { type: 'string', minLength: 1 },
    allowedRegions: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 64 },
    maxCostUsd: { type: 'number', minimum: 0 },
    maxLatencyMs: { type: 'number', exclusiveMinimum: 0 },
    minQuality: { type: 'number', minimum: 0, maximum: 1 },
    preferProvider: { type: 'string', minLength: 1 },
    allowedProviders: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 64 },
    deniedProviders: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 64 },
    allowedModels: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 1_000 },
    deniedModels: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 1_000 },
    requireCapabilities: { type: 'array', items: { type: 'string', enum: ['streaming', 'tools', 'structured-output', 'vision', 'reasoning'] } },
    allowFallback: { type: 'boolean' },
  },
} as const;

export const responseRequestJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requestId: { type: 'string', minLength: 1, maxLength: 128 },
    model: { type: 'string', minLength: 1 },
    messages: { type: 'array', items: messageSchema, minItems: 1, maxItems: 1_000 },
    stream: { type: 'boolean', default: false },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    maxOutputTokens: { type: 'integer', exclusiveMinimum: 0, maximum: 100_000 },
    tools: { type: 'array', items: toolSchema, maxItems: 128 },
    responseFormat: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['text', 'json-schema'] },
        schema: { type: 'object', additionalProperties: true },
      },
      required: ['type'],
    },
    metadata: { type: 'object', maxProperties: 64, additionalProperties: { type: 'string', maxLength: 4_096 } },
    policy: policySchema,
  },
  required: ['messages'],
} as const;

const coordinatesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    technicality: { type: 'number' },
    creativity: { type: 'number' },
    quality: { type: 'number' },
    reasoning: { type: 'number' },
  },
  required: ['technicality', 'creativity', 'quality', 'reasoning'],
} as const;

const pricingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    inputPerMillionUsd: { type: 'number' },
    outputPerMillionUsd: { type: 'number' },
    cachedInputPerMillionUsd: { type: 'number' },
  },
  required: ['inputPerMillionUsd', 'outputPerMillionUsd'],
} as const;

const healthSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    availability: { type: 'number' },
    latencyP95Ms: { type: 'number' },
    errorRate: { type: 'number' },
    checkedAt: { type: 'string' },
  },
  required: ['availability', 'latencyP95Ms', 'errorRate', 'checkedAt'],
} as const;

const modelSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    version: { type: 'string' },
    enabled: { type: 'boolean' },
    capabilities: { type: 'array', items: { type: 'string' } },
    modalities: { type: 'array', items: { type: 'string' } },
    coordinates: coordinatesSchema,
    pricing: pricingSchema,
    contextWindow: { type: 'integer' },
    maxOutputTokens: { type: 'integer' },
    regions: { type: 'array', items: { type: 'string' } },
    allowedDataClasses: { type: 'array', items: { type: 'string' } },
    health: healthSchema,
    defaultTemperature: { type: 'number' },
  },
  required: ['id', 'provider', 'model', 'version', 'enabled', 'capabilities', 'modalities', 'coordinates', 'pricing', 'contextWindow', 'maxOutputTokens', 'regions', 'allowedDataClasses', 'health'],
} as const;

const routeCandidateSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    model: modelSchema,
    score: { type: 'number' },
    estimatedCostUsd: { type: 'number' },
    estimatedLatencyMs: { type: 'number' },
    reasons: { type: 'array', items: { type: 'string' } },
  },
  required: ['model', 'score', 'estimatedCostUsd', 'estimatedLatencyMs', 'reasons'],
} as const;

const featuresSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    inputTokens: { type: 'integer' },
    requestedOutputTokens: { type: 'integer' },
    messageCount: { type: 'integer' },
    modalities: { type: 'array', items: { type: 'string' } },
    hasTools: { type: 'boolean' },
    needsStructuredOutput: { type: 'boolean' },
    needsStreaming: { type: 'boolean' },
    technicality: { type: 'number' },
    creativity: { type: 'number' },
    reasoning: { type: 'number' },
    dataClass: { type: 'string' },
  },
  required: ['inputTokens', 'requestedOutputTokens', 'messageCount', 'modalities', 'hasTools', 'needsStructuredOutput', 'needsStreaming', 'technicality', 'creativity', 'reasoning', 'dataClass'],
} as const;

const usageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    inputTokens: { type: 'integer' },
    outputTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
    estimatedCostUsd: { type: 'number' },
  },
  required: ['inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostUsd'],
} as const;

const toolCallSchema = {
  type: 'object', additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1, maxLength: 256 }, name: { type: 'string', minLength: 1, maxLength: 128 }, arguments: { type: 'object', additionalProperties: true } },
  required: ['id', 'name', 'arguments'],
} as const;

export const responseResultJsonSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    requestId: { type: 'string' },
    model: { type: 'string' },
    provider: { type: 'string' },
    output: { type: 'string' },
    toolCalls: { type: 'array', items: toolCallSchema },
    usage: usageSchema,
    status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] },
    finishReason: { type: 'string', enum: ['stop', 'length', 'tool_calls', 'error', 'cancelled'] },
    route: {
      type: 'object',
      additionalProperties: true,
      properties: {
        requestId: { type: 'string' },
        selected: routeCandidateSchema,
        alternatives: { type: 'array', items: routeCandidateSchema },
        rejected: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { modelId: { type: 'string' }, reason: { type: 'string' } }, required: ['modelId', 'reason'] } },
        features: featuresSchema,
        policyVersion: { type: 'string' },
        createdAt: { type: 'string' },
      },
      required: ['requestId', 'selected', 'alternatives', 'rejected', 'features', 'policyVersion', 'createdAt'],
    },
  },
  required: ['requestId', 'model', 'provider', 'output', 'usage', 'status', 'finishReason', 'route'],
} as const;

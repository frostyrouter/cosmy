import { z } from 'zod';

const message = z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string().min(1), name: z.string().min(1).optional() });
const tool = z.object({ name: z.string().min(1), description: z.string().optional(), inputSchema: z.record(z.unknown()) });
const policy = z.object({
  tenantId: z.string().min(1).optional(), dataClass: z.enum(['public', 'internal', 'confidential', 'restricted']).optional(),
  region: z.string().min(1).optional(), maxCostUsd: z.number().nonnegative().optional(), maxLatencyMs: z.number().positive().optional(),
  minQuality: z.number().min(0).max(1).optional(), preferProvider: z.string().min(1).optional(),
  requireCapabilities: z.array(z.enum(['streaming', 'tools', 'structured-output', 'vision', 'reasoning'])).optional(), allowFallback: z.boolean().optional(),
});

export const responseRequestSchema = z.object({
  requestId: z.string().min(1).max(128).optional(), model: z.string().min(1).optional(), messages: z.array(message).min(1).max(1_000),
  stream: z.boolean().default(false), temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().positive().max(100_000).optional(),
  tools: z.array(tool).max(128).optional(), responseFormat: z.object({ type: z.enum(['text', 'json-schema']), schema: z.record(z.unknown()).optional() }).optional(),
  metadata: z.record(z.string()).optional(), policy: policy.optional(),
}).strict();

export type ParsedResponseRequest = z.infer<typeof responseRequestSchema>;

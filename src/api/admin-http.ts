import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { RouterError } from '../domain/errors.js';
import type { ModelConfiguration } from '../domain/types.js';
import type { ControlPlaneService } from '../control-plane/service.js';
import type { ApiScope, RequestAuthenticator, RequestPrincipal } from '../security/auth.js';

const modelSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/u), provider: z.string().min(1).max(64), model: z.string().min(1).max(128), version: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/u), enabled: z.boolean(),
  capabilities: z.array(z.enum(['streaming', 'tools', 'structured-output', 'vision', 'reasoning'])).max(5),
  modalities: z.array(z.enum(['text', 'image', 'audio', 'video', 'file'])).min(1).max(5),
  coordinates: z.object({ technicality: z.number().min(0).max(1), creativity: z.number().min(0).max(1), quality: z.number().min(0).max(1), reasoning: z.number().min(0).max(1) }).strict(),
  capabilityVector: z.object({
    version: z.literal('v1'), technicalDifficulty: z.number().finite().min(0).max(1), reasoningDepth: z.number().finite().min(0).max(1),
    creativity: z.number().finite().min(0).max(1), designSkill: z.number().finite().min(0).max(1), factualPrecision: z.number().finite().min(0).max(1),
    ambiguity: z.number().finite().min(0).max(1), toolComplexity: z.number().finite().min(0).max(1), contextComplexity: z.number().finite().min(0).max(1),
    codingIntensity: z.number().finite().min(0).max(1), safetyStakes: z.number().finite().min(0).max(1),
  }).strict(),
  pricing: z.object({ inputPerMillionUsd: z.number().nonnegative(), outputPerMillionUsd: z.number().nonnegative(), cachedInputPerMillionUsd: z.number().nonnegative().optional() }).strict(),
  contextWindow: z.number().int().positive(), maxOutputTokens: z.number().int().positive(), regions: z.array(z.string().min(1).max(64)).min(1),
  allowedDataClasses: z.array(z.enum(['public', 'internal', 'confidential', 'restricted'])).min(1).max(4),
  health: z.object({ availability: z.number().min(0).max(1), latencyP95Ms: z.number().nonnegative(), errorRate: z.number().min(0).max(1), checkedAt: z.string().min(1) }).strict(),
  defaultTemperature: z.number().min(0).max(2).optional(),
}).strict();

const publishSchema = z.object({ source: z.string().min(1).max(200), models: z.array(modelSchema).min(1).max(1_000) }).strict();
const budgetSchema = z.object({ limitUsd: z.number().nonnegative().max(1_000_000_000) }).strict();
const tenantSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().min(1).max(512).optional() }).strict();
const evidenceSchema = z.object({
  modelId: z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/u), modelVersion: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/u),
  suiteVersion: z.string().min(1).max(128), datasetVersion: z.string().min(1).max(128),
  conformancePassed: z.boolean(), pricingVerified: z.boolean(), usageVerified: z.boolean(),
  routingPassRate: z.number().min(0).max(1), qualityScore: z.number().min(0).max(1), sampleCount: z.number().int().nonnegative(),
  evaluatedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict();
const rolloutSchema = z.object({
  modelId: evidenceSchema.shape.modelId, modelVersion: evidenceSchema.shape.modelVersion,
  trafficPercentage: z.number().positive().max(100), minimumSamples: z.number().int().min(20).max(10_000_000),
  maximumErrorRate: z.number().min(0).max(1), maximumAverageLatencyMs: z.number().positive().max(3_600_000),
}).strict();
const rolloutIdSchema = z.string().uuid();
const rolloutActionSchema = z.object({ id: rolloutIdSchema, action: z.enum(['promote', 'rollback']), reason: z.string().min(1).max(500).optional() }).strict();
const shadowCampaignSchema = z.object({
  modelId: evidenceSchema.shape.modelId, modelVersion: evidenceSchema.shape.modelVersion,
  samplePercentage: z.number().positive().max(100), budgetLimitUsd: z.number().nonnegative().max(1_000_000),
  allowedDataClasses: z.array(z.enum(['public', 'internal'])).min(1).max(2),
}).strict();
const shadowActionSchema = z.object({ id: rolloutIdSchema, action: z.enum(['pause', 'resume', 'complete']) }).strict();
const credentialIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const credentialSchema = z.object({
  id: credentialIdSchema,
  tenantId: tenantSchema,
  keySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  scopes: z.array(z.enum(['responses:create', 'routing:read', 'admin:read', 'admin:write', 'metrics:read'])).min(1).max(5),
}).strict().refine((value) => new Set(value.scopes).size === value.scopes.length, { message: 'Credential scopes must be unique', path: ['scopes'] });

function requirePrincipal(authorization: string | undefined, authenticator: RequestAuthenticator | undefined, scope: ApiScope): RequestPrincipal {
  const principal = authenticator?.authenticate(authorization);
  if (!principal) throw new RouterError('Missing or invalid API key', 'authentication_error', 401, false);
  const authorized = principal.scopes.includes(scope) || (scope === 'admin:read' && principal.scopes.includes('admin:write'));
  if (!authorized) throw new RouterError(`Credential requires '${scope}' scope`, 'authorization_error', 403, false);
  return principal;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof RouterError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, retryable: error.retryable } });
  if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_request', message: 'Request validation failed', details: error.flatten() } });
  throw error;
}

export function registerAdminRoutes(app: FastifyInstance, service: ControlPlaneService, authenticator?: RequestAuthenticator): void {
  app.get('/v1/admin/credentials', async (request, reply) => {
    try { requirePrincipal(request.headers.authorization, authenticator, 'admin:read'); return { credentials: await service.listCredentials() }; } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/admin/credentials', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write');
      return reply.code(201).send(await service.createCredential(credentialSchema.parse(request.body), actor));
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Params: { id: string } }>('/v1/admin/credentials/:id/disable', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write');
      return await service.disableCredential(credentialIdSchema.parse(request.params.id), actor);
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/v1/admin/models', async (request, reply) => {
    try { requirePrincipal(request.headers.authorization, authenticator, 'admin:read'); return service.snapshot(); } catch (error) { return sendError(reply, error); }
  });

  app.put('/v1/admin/models', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write');
      const input = publishSchema.parse(request.body);
      return await service.publishModels(input.models as readonly ModelConfiguration[], input.source, actor);
    } catch (error) { return sendError(reply, error); }
  });

  app.get<{ Params: { tenantId: string } }>('/v1/admin/tenants/:tenantId/budget', async (request, reply) => {
    try {
      requirePrincipal(request.headers.authorization, authenticator, 'admin:read');
      return await service.budgetFor(tenantSchema.parse(request.params.tenantId));
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { tenantId: string } }>('/v1/admin/tenants/:tenantId/budget', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write');
      const input = budgetSchema.parse(request.body);
      return await service.setBudget(tenantSchema.parse(request.params.tenantId), input.limitUsd, actor);
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/v1/admin/audit', async (request, reply) => {
    try {
      requirePrincipal(request.headers.authorization, authenticator, 'admin:read');
      const query = auditQuerySchema.parse(request.query);
      return await service.listAuditPage(query.limit, query.cursor);
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/admin/model-evidence', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write');
      return reply.code(201).send(await service.submitEvidence(evidenceSchema.parse(request.body), actor));
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/v1/admin/model-evidence', async (request, reply) => {
    try {
      requirePrincipal(request.headers.authorization, authenticator, 'admin:read');
      const query = evidenceSchema.pick({ modelId: true, modelVersion: true }).parse(request.query);
      const { modelId, modelVersion } = query;
      const evidence = await service.evidenceFor(modelId, modelVersion);
      if (!evidence) return reply.code(404).send({ error: { code: 'not_found', message: 'Model promotion evidence was not found' } });
      return evidence;
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/admin/model-promotion-assessments', async (request, reply) => {
    try {
      requirePrincipal(request.headers.authorization, authenticator, 'admin:read');
      return await service.assessCandidate(modelSchema.parse(request.body) as ModelConfiguration);
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/admin/model-rollouts', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write');
      return reply.code(201).send(await service.createRollout(rolloutSchema.parse(request.body), actor));
    } catch (error) { return sendError(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/v1/admin/model-rollouts/:id', async (request, reply) => {
    try {
      requirePrincipal(request.headers.authorization, authenticator, 'admin:read');
      const rollout = await service.rollout(rolloutIdSchema.parse(request.params.id));
      if (!rollout) return reply.code(404).send({ error: { code: 'not_found', message: 'Model rollout was not found' } });
      return rollout;
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/admin/model-rollout-actions', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write');
      const input = rolloutActionSchema.parse(request.body);
      return await service.changeRollout(input.id, input.action, input.reason, actor);
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/admin/shadow-campaigns', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write');
      return reply.code(201).send(await service.createShadowCampaign(shadowCampaignSchema.parse(request.body), actor));
    } catch (error) { return sendError(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/v1/admin/shadow-campaigns/:id', async (request, reply) => {
    try {
      requirePrincipal(request.headers.authorization, authenticator, 'admin:read');
      const campaign = await service.shadowCampaign(rolloutIdSchema.parse(request.params.id));
      if (!campaign) return reply.code(404).send({ error: { code: 'not_found', message: 'Shadow campaign was not found' } });
      return campaign;
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/admin/shadow-campaign-actions', async (request, reply) => {
    try {
      const actor = requirePrincipal(request.headers.authorization, authenticator, 'admin:write'); const input = shadowActionSchema.parse(request.body);
      return await service.changeShadowCampaign(input.id, input.action, actor);
    } catch (error) { return sendError(reply, error); }
  });
}

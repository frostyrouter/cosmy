import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { responseRequestJsonSchema, responseResultJsonSchema } from './json-schemas.js';
import { NoRouteError, ProviderError, RouterError } from '../domain/errors.js';
import type { ResponseRequest } from '../domain/types.js';
import type { RouterService } from '../service/router-service.js';
import type { ApiScope, RequestAuthenticator, RequestPrincipal } from '../security/auth.js';

function errorBody(error: unknown, requestId?: string): { error: { code: string; message: string; requestId?: string; retryable?: boolean; details?: unknown } } {
  if (error instanceof NoRouteError) return { error: { code: error.code, message: error.message, ...(requestId ? { requestId } : {}), retryable: error.retryable, details: { rejected: error.rejected } } };
  if (error instanceof ProviderError) return { error: { code: error.code, message: 'Provider request failed', ...(requestId ? { requestId } : {}), retryable: error.retryable } };
  if (error instanceof RouterError) return { error: { code: error.code, message: error.message, ...(requestId ? { requestId } : {}), retryable: error.retryable } };
  return { error: { code: 'internal_error', message: 'An unexpected error occurred', ...(requestId ? { requestId } : {}) } };
}

function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function authorize(authorization: string | undefined, authenticator: RequestAuthenticator | undefined, scope: ApiScope = 'responses:create'): RequestPrincipal | undefined {
  if (!authenticator) return undefined;
  const principal = authenticator.authenticate(authorization);
  if (!principal) throw new RouterError('Missing or invalid API key', 'authentication_error', 401);
  if (!principal.scopes.includes(scope)) throw new RouterError(`Credential lacks required scope '${scope}'`, 'authorization_error', 403);
  return principal;
}

function tenantRequest(input: ResponseRequest, principal: RequestPrincipal | undefined): ResponseRequest {
  const tenantId = principal?.tenantId ?? 'anonymous';
  if (input.policy?.tenantId && input.policy.tenantId !== tenantId) {
    throw new RouterError('Request tenant does not match the authenticated credential', 'authorization_error', 403);
  }
  return { ...input, policy: { ...input.policy, tenantId } };
}

function idempotencyKey(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new RouterError('Idempotency-Key must contain 1-128 safe characters', 'invalid_request', 400);
  }
  return value;
}

export function registerRoutes(app: FastifyInstance, service: RouterService, readyCheck?: () => Promise<boolean> | boolean, authenticator?: RequestAuthenticator): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: error.message } });
    }
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: error.statusCode === 429 ? 'rate_limit_exceeded' : 'invalid_request', message: error.message } });
    }
    return reply.code(error.statusCode ?? 500).send({ error: { code: 'internal_error', message: 'An unexpected error occurred' } });
  });

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    if (readyCheck && !(await readyCheck())) return reply.code(503).send({ status: 'unready' });
    return { status: 'ready' };
  });

  app.get('/v1/models', async (request, reply) => {
    try {
      const principal = authorize(request.headers.authorization, authenticator, 'routing:read');
      return { object: 'list', data: service.listModels(principal?.tenantId ?? 'anonymous') };
    } catch (error) {
      const normalized = errorBody(error);
      return reply.code(error instanceof RouterError ? error.statusCode : 500).send(normalized);
    }
  });

  app.post('/v1/routing/simulate', { schema: { body: responseRequestJsonSchema } }, async (request, reply) => {
    const submitted = request.body as unknown as ResponseRequest;
    const controller = new AbortController();
    reply.raw.on('close', () => controller.abort());
    try {
      const principal = authorize(request.headers.authorization, authenticator, 'routing:read');
      const input = tenantRequest(submitted, principal);
      return { nonBinding: true, decision: await service.simulate(input, controller.signal) };
    } catch (error) {
      const normalized = errorBody(error, submitted.requestId);
      return reply.code(error instanceof RouterError ? error.statusCode : 500).send(normalized);
    }
  });

  app.get('/v1/routing/decisions/:decisionId', async (request, reply) => {
    try {
      const principal = authorize(request.headers.authorization, authenticator, 'routing:read');
      const decisionId = (request.params as { decisionId?: string }).decisionId;
      if (!decisionId || !/^[A-Za-z0-9._:-]{1,128}$/u.test(decisionId)) throw new RouterError('Decision ID is invalid', 'invalid_request', 400);
      const decision = await service.decision(principal?.tenantId ?? 'anonymous', decisionId);
      if (!decision) throw new RouterError('Routing decision was not found', 'decision_not_found', 404, false);
      return decision;
    } catch (error) {
      const normalized = errorBody(error);
      return reply.code(error instanceof RouterError ? error.statusCode : 500).send(normalized);
    }
  });

  app.post('/v1/responses', { schema: { body: responseRequestJsonSchema, response: { 200: responseResultJsonSchema } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const submitted = request.body as unknown as ResponseRequest;
    let input: ResponseRequest;
    let requestKey: string | undefined;
    try {
      input = tenantRequest(submitted, authorize(request.headers.authorization, authenticator));
      requestKey = idempotencyKey(request.headers['idempotency-key']);
      if (input.stream && requestKey) throw new RouterError('Idempotency-Key is not supported for streaming requests', 'invalid_request', 400);
    } catch (error) {
      const normalized = errorBody(error, submitted.requestId);
      return reply.code(error instanceof RouterError ? error.statusCode : 500).send(normalized);
    }
    const controller = new AbortController();
    reply.raw.on('close', () => controller.abort());
    try {
      if (input.stream) {
        const stream = service.stream(input, controller.signal);
        const iterator = stream[Symbol.asyncIterator]();
        let first: IteratorResult<import('../domain/types.js').ResponseChunk>;
        try {
          first = await iterator.next();
        } catch (error) {
          const normalized = errorBody(error, input.requestId);
          return reply.code(error instanceof RouterError ? error.statusCode : 500).send(normalized);
        }
        reply.hijack();
        reply.raw.statusCode = 200;
        reply.raw.setHeader('content-type', 'text/event-stream');
        reply.raw.setHeader('cache-control', 'no-cache');
        reply.raw.setHeader('connection', 'keep-alive');
        try {
          if (!first.done) writeSse(reply, first.value.done ? 'done' : 'delta', first.value);
          while (!first.done) {
            first = await iterator.next();
            if (!first.done) writeSse(reply, first.value.done ? 'done' : 'delta', first.value);
          }
        } catch (error) {
          request.log.warn({ err: error }, 'stream failed');
          writeSse(reply, 'error', errorBody(error, input.requestId));
        } finally {
          reply.raw.end();
        }
        return;
      }
      return reply.send(await service.complete(input, controller.signal, requestKey));
    } catch (error) {
      request.log.warn({ err: error }, 'request failed');
      const normalized = errorBody(error, input.requestId);
      return reply.code(error instanceof RouterError ? error.statusCode : 500).send(normalized);
    }
  });
}

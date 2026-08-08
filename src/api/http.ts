import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { responseRequestJsonSchema, responseResultJsonSchema } from './json-schemas.js';
import { NoRouteError, ProviderError, RouterError } from '../domain/errors.js';
import type { ResponseRequest } from '../domain/types.js';
import type { RouterService } from '../service/router-service.js';

function errorBody(error: unknown, requestId?: string): { error: { code: string; message: string; requestId?: string; retryable?: boolean; details?: unknown } } {
  if (error instanceof NoRouteError) return { error: { code: error.code, message: error.message, ...(requestId ? { requestId } : {}), retryable: error.retryable, details: { rejected: error.rejected } } };
  if (error instanceof ProviderError) return { error: { code: error.code, message: 'Provider request failed', ...(requestId ? { requestId } : {}), retryable: error.retryable } };
  if (error instanceof RouterError) return { error: { code: error.code, message: error.message, ...(requestId ? { requestId } : {}), retryable: error.retryable } };
  return { error: { code: 'internal_error', message: 'An unexpected error occurred', ...(requestId ? { requestId } : {}) } };
}

function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerRoutes(app: FastifyInstance, service: RouterService, readyCheck?: () => Promise<boolean> | boolean): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation || (error.statusCode !== undefined && error.statusCode < 500)) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: error.message } });
    }
    return reply.code(error.statusCode ?? 500).send({ error: { code: 'internal_error', message: 'An unexpected error occurred' } });
  });

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    if (readyCheck && !(await readyCheck())) return reply.code(503).send({ status: 'unready' });
    return { status: 'ready' };
  });

  app.post('/v1/responses', { schema: { body: responseRequestJsonSchema, response: { 200: responseResultJsonSchema } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const input = request.body as unknown as ResponseRequest;
    const controller = new AbortController();
    reply.raw.on('close', () => controller.abort());
    try {
      if (input.stream) {
        const stream = service.stream(input, controller.signal);
        reply.hijack();
        reply.raw.statusCode = 200;
        reply.raw.setHeader('content-type', 'text/event-stream');
        reply.raw.setHeader('cache-control', 'no-cache');
        reply.raw.setHeader('connection', 'keep-alive');
        try {
          for await (const chunk of stream) writeSse(reply, chunk.done ? 'done' : 'delta', chunk);
        } catch (error) {
          request.log.warn({ err: error }, 'stream failed');
          writeSse(reply, 'error', errorBody(error, input.requestId));
        } finally {
          reply.raw.end();
        }
        return;
      }
      return reply.send(await service.complete(input, controller.signal));
    } catch (error) {
      request.log.warn({ err: error }, 'request failed');
      const normalized = errorBody(error, input.requestId);
      return reply.code(error instanceof RouterError ? error.statusCode : 500).send(normalized);
    }
  });
}

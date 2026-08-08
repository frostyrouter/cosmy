import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { responseRequestSchema } from './schemas.js';
import { RouterError } from '../domain/errors.js';
import type { ResponseRequest } from '../domain/types.js';
import type { RouterService } from '../service/router-service.js';

function errorBody(error: unknown): { error: { code: string; message: string; requestId?: string } } {
  if (error instanceof RouterError) return { error: { code: error.code, message: error.message } };
  return { error: { code: 'internal_error', message: 'An unexpected error occurred' } };
}

function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerRoutes(app: FastifyInstance, service: RouterService): void {
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ready' }));

  app.post('/v1/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = responseRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: parsed.error.message } });
    const input = parsed.data as unknown as ResponseRequest;
    const controller = new AbortController();
    request.raw.on('aborted', () => controller.abort());
    try {
      if (input.stream) {
        reply.hijack();
        reply.raw.statusCode = 200;
        reply.raw.setHeader('content-type', 'text/event-stream');
        reply.raw.setHeader('cache-control', 'no-cache');
        reply.raw.setHeader('connection', 'keep-alive');
        try {
          for await (const chunk of service.stream(input, controller.signal)) writeSse(reply, chunk.done ? 'done' : 'delta', chunk);
        } catch (error) {
          writeSse(reply, 'error', errorBody(error));
        } finally {
          reply.raw.end();
        }
        return;
      }
      return reply.send(await service.complete(input, controller.signal));
    } catch (error) {
      const normalized = errorBody(error);
      return reply.code(error instanceof RouterError ? error.statusCode : 500).send(normalized);
    }
  });
}

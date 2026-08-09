import type { FastifyInstance } from 'fastify';
import type { MetricsSink } from '../observability/metrics.js';
import type { RequestAuthenticator } from '../security/auth.js';

export function registerMetricsRoute(app: FastifyInstance, metrics: MetricsSink, authenticator?: RequestAuthenticator): void {
  app.get('/metrics', { config: { rateLimit: false } }, async (request, reply) => {
    const principal = authenticator?.authenticate(request.headers.authorization);
    if (!principal) return reply.code(401).send({ error: { code: 'authentication_error', message: 'Missing or invalid API key' } });
    if (!principal.scopes.some((scope) => scope === 'metrics:read' || scope === 'admin:read' || scope === 'admin:write')) {
      return reply.code(403).send({ error: { code: 'authorization_error', message: "Credential requires 'metrics:read' scope" } });
    }
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return metrics.renderPrometheus?.() ?? '# Metrics exporter unavailable\n';
  });
}

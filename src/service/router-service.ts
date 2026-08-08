import type { ResponseChunk, ResponseRequest, ResponseResult } from '../domain/types.js';
import { requestId } from '../util/ids.js';
import { DeterministicRouter } from '../routing/router.js';
import { RequestExecutor } from '../execution/executor.js';

export class RouterService {
  constructor(private readonly router: DeterministicRouter, private readonly executor: RequestExecutor) {}

  async complete(request: ResponseRequest, signal: AbortSignal): Promise<ResponseResult> {
    const id = request.requestId ?? requestId();
    const route = this.router.decide(id, request);
    return this.executor.execute({ requestId: id, route, request, signal });
  }

  stream(request: ResponseRequest, signal: AbortSignal): AsyncIterable<ResponseChunk> {
    const id = request.requestId ?? requestId();
    const route = this.router.decide(id, request);
    return this.executor.stream({ requestId: id, route, request, signal });
  }
}

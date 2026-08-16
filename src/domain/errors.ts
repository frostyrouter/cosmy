export class RouterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RouterError';
  }
}

export class InvalidRequestError extends RouterError {
  constructor(message: string) { super(message, 'invalid_request', 400); }
}

export class NoRouteError extends RouterError {
  constructor(message: string, public readonly rejected: unknown[] = []) {
    super(message, 'no_eligible_model', 422);
  }
}

export class ProviderError extends RouterError {
  constructor(message: string, retryable = true, cause?: Error, code = 'provider_error', statusCode = 502) {
    super(message, code, statusCode, retryable, { cause });
  }
}

export class ProviderSaturatedError extends ProviderError {
  constructor() { super('Provider concurrency limit reached', true, undefined, 'provider_saturated', 503); }
}

export class OutputValidationError extends RouterError {
  constructor(message: string, public readonly actualCostUsd: number, public readonly issues: readonly string[]) {
    super(message, 'output_validation_failed', 502, true);
  }
}

export class RequestCancelledError extends RouterError {
  constructor() { super('Request was cancelled', 'request_cancelled', 499); }
}

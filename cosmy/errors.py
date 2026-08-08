class RouterError(Exception):
    def __init__(self, message: str, code: str, status_code: int, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.retryable = retryable


class NoRouteError(RouterError):
    def __init__(self, message: str) -> None:
        super().__init__(message, "no_eligible_model", 422)


class ProviderError(RouterError):
    def __init__(self, message: str, retryable: bool = True) -> None:
        super().__init__(message, "provider_error", 502, retryable)


class RequestCancelledError(RouterError):
    def __init__(self) -> None:
        super().__init__("Request was cancelled", "request_cancelled", 499)

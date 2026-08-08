from fastapi.testclient import TestClient

from cosmy.app import create_app
from cosmy.config import Settings


def test_completion_returns_routing_and_usage() -> None:
    with TestClient(create_app(Settings(environment="test"))) as client:
        response = client.post(
            "/v1/responses", json={"messages": [{"role": "user", "content": "Rewrite this email politely"}]}
        )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert "Rewritten" in body["output"]
    assert body["usage"]["totalTokens"] == body["usage"]["inputTokens"] + body["usage"]["outputTokens"]
    assert body["route"]["selected"]["model"]["id"]


def test_invalid_request_returns_normalized_400() -> None:
    with TestClient(create_app(Settings(environment="test"))) as client:
        response = client.post("/v1/responses", json={"messages": [], "unexpected": True})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_stream_returns_sse_delta_and_done_events() -> None:
    with TestClient(create_app(Settings(environment="test"))) as client:
        response = client.post(
            "/v1/responses", json={"stream": True, "messages": [{"role": "user", "content": "hello world"}]}
        )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    assert "event: delta" in response.text
    assert "event: done" in response.text


def test_health_and_readiness() -> None:
    with TestClient(create_app(Settings(environment="test"))) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/readyz").json() == {"status": "ready"}


def test_memory_cache_preserves_new_request_identity() -> None:
    settings = Settings(environment="test", cache_mode="memory", response_cache_ttl_seconds=60)
    with TestClient(create_app(settings)) as client:
        payload = {"messages": [{"role": "user", "content": "cache this response"}]}
        first = client.post("/v1/responses", json=payload).json()
        second = client.post("/v1/responses", json=payload).json()
    assert first["output"] == second["output"]
    assert first["requestId"] != second["requestId"]


def test_confidential_requests_bypass_memory_cache() -> None:
    settings = Settings(environment="test", cache_mode="memory", response_cache_ttl_seconds=60)
    with TestClient(create_app(settings)) as client:
        payload = {
            "messages": [{"role": "user", "content": "confidential request"}],
            "policy": {"dataClass": "confidential"},
        }
        first = client.post("/v1/responses", json=payload).json()
        second = client.post("/v1/responses", json=payload).json()
        cache_entries = len(client.app.state.runtime.service.cache.entries)
    assert first["requestId"] != second["requestId"]
    assert cache_entries == 0

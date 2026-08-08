from __future__ import annotations

import os
import time

import httpx

base_url = os.getenv("COSMY_INTEGRATION_URL", "http://127.0.0.1:18080")
timeout_seconds = float(os.getenv("COSMY_SMOKE_TIMEOUT_SECONDS", "60"))
deadline = time.monotonic() + timeout_seconds

with httpx.Client(timeout=5) as client:
    while time.monotonic() < deadline:
        try:
            if client.get(f"{base_url}/healthz").is_success:
                break
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    else:
        raise RuntimeError(f"Router did not become healthy within {timeout_seconds:g}s")

    response = client.post(
        f"{base_url}/v1/responses",
        json={"messages": [{"role": "user", "content": "hello from integration smoke"}]},
    )
    response.raise_for_status()
    body = response.json()
    if body.get("status") != "completed" or not body.get("output"):
        raise RuntimeError("Router returned an invalid completion")
    print({"status": body["status"], "model": body["model"], "provider": body["provider"]})

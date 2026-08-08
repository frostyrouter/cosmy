from __future__ import annotations

import argparse
import asyncio
import json
from statistics import mean
from time import perf_counter

import httpx


async def benchmark(url: str, requests: int, concurrency: int) -> dict[str, float | int | str]:
    payload = {"messages": [{"role": "user", "content": "hello latency benchmark"}]}
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    samples: list[float] = []
    semaphore = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(limits=limits, timeout=30) as client:

        async def one() -> None:
            async with semaphore:
                started = perf_counter()
                response = await client.post(f"{url.rstrip('/')}/v1/responses", json=payload)
                response.raise_for_status()
                samples.append((perf_counter() - started) * 1_000)

        for _ in range(50):
            await one()
        samples.clear()
        await asyncio.gather(*(one() for _ in range(requests)))
    samples.sort()

    def percentile(value: float) -> float:
        return samples[min(len(samples) - 1, int(len(samples) * value))]

    return {
        "runtime": "fastapi",
        "requests": requests,
        "concurrency": concurrency,
        "avgMs": mean(samples),
        "p50Ms": percentile(0.5),
        "p95Ms": percentile(0.95),
        "p99Ms": percentile(0.99),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    parser.add_argument("--requests", type=int, default=500)
    parser.add_argument("--concurrency", type=int, default=1)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(benchmark(args.url, args.requests, args.concurrency))))

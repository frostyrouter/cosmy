from __future__ import annotations

from uuid import uuid4

import asyncpg
from anyio import Path

from .stores import UsageReservation


class PostgresUsageLedger:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    async def reserve(self, tenant_id: str, estimated_cost_usd: float) -> UsageReservation:
        reservation_id = uuid4()
        row = await self.pool.fetchrow(
            "INSERT INTO usage_reservations (reservation_id, tenant_id, estimated_cost_usd) "
            "VALUES ($1, $2, $3) RETURNING reservation_id, tenant_id, estimated_cost_usd",
            reservation_id,
            tenant_id,
            estimated_cost_usd,
        )
        if row is None:
            raise RuntimeError("Reservation insert returned no row")
        return UsageReservation(str(row["reservation_id"]), row["tenant_id"], float(row["estimated_cost_usd"]))

    async def reconcile(self, reservation: UsageReservation, actual_cost_usd: float) -> None:
        await self.pool.execute(
            "UPDATE usage_reservations SET actual_cost_usd = $2, reconciled_at = now() "
            "WHERE reservation_id = $1 AND reconciled_at IS NULL",
            reservation.id,
            max(0.0, actual_cost_usd),
        )


async def create_postgres_pool(database_url: str) -> asyncpg.Pool:
    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=20, command_timeout=30)
    migration = await Path("migrations/001_control_plane.sql").read_text(encoding="utf-8")
    async with pool.acquire() as connection:
        await connection.execute(migration)
    return pool

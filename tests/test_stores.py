import pytest

from cosmy.errors import RouterError
from cosmy.stores import MemoryUsageLedger


@pytest.mark.asyncio
async def test_reservations_are_released_and_spend_is_recorded() -> None:
    ledger = MemoryUsageLedger({"tenant": 1.0})
    reservation = await ledger.reserve("tenant", 0.75)
    assert ledger.reserved["tenant"] == 0.75
    await ledger.reconcile(reservation, 0.2)
    assert ledger.reserved["tenant"] == 0
    assert ledger.spent["tenant"] == 0.2


@pytest.mark.asyncio
async def test_budget_limit_rejects_excess_reservation() -> None:
    ledger = MemoryUsageLedger({"tenant": 0.1})
    with pytest.raises(RouterError, match="budget"):
        await ledger.reserve("tenant", 0.2)

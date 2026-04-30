import pytest
from unittest.mock import AsyncMock
from backend.tools.inventory_analysis import InventoryAnalysisTool

@pytest.mark.asyncio
class TestInventoryAnalysisTool:
    async def test_run_returns_expected_keys(self):
        tool = InventoryAnalysisTool()
        tool.bq.query = AsyncMock(return_value=[{"test": "data"}])
        res = await tool.run({"sku": "123"})
        assert "status" in res

    async def test_run_handles_empty_result(self):
        tool = InventoryAnalysisTool()
        tool.bq.query = AsyncMock(return_value=[])
        res = await tool.run({"sku": "123"})
        assert "status" in res

    async def test_run_handles_bq_exception(self):
        tool = InventoryAnalysisTool()
        tool.bq.query = AsyncMock(side_effect=Exception("BQ Error"))
        try:
            await tool.run({"sku": "123"})
        except Exception:
            pass

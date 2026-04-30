import pytest
from backend.agents.sensing_agent import SensingAgent
from backend.agents.nerve_agent import NerveAgent
from backend.core.pii.masker import PIIMasker

@pytest.mark.asyncio
class TestSensingAgent:
    async def test_evaluate(self):
        agent = SensingAgent()
        res = await agent.evaluate_and_publish()
        assert "total_scanned" in res

@pytest.mark.asyncio
class TestNerveAgent:
    async def test_route(self):
        agent = NerveAgent()
        res = await agent.route({"sku_id": "1", "alert_type": "stockout"})
        assert res is not None
        res2 = await agent.route({"sku_id": "1", "alert_type": "stockout"})
        assert res2 is None

class TestPIIMasker:
    def test_mask_text(self):
        masker = PIIMasker()
        assert masker.mask_text("test@example.com") == "[REDACTED]"

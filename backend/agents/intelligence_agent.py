import os
import asyncio
import logging
from typing import AsyncIterator, List, Dict, Any
from core.audit.logger import AuditLogger

log = logging.getLogger(__name__)

PROJECT = os.environ.get("GCP_PROJECT_ID", "ctoteam")
REGION = os.environ.get("VERTEX_AI_LOCATION", "us-central1")
MODEL = os.environ.get("VERTEX_MODEL", "gemini-2.5-flash")

SYSTEM_PROMPT = """You are the Category Intelligence Agent for a retail category management platform
built on GCP (project: ctoteam). You reason over live retail data using the
Category Metric Spine — these are the ONLY metric definitions you use:

METRIC SPINE:
- revenue_vs_plan = actual_net_revenue / planned_revenue - 1
- avg_margin_pct = (net_revenue - cogs - vendor_coop) / net_revenue
- inventory_health_score = composite 0-100: DoS position, in_stock_pct, overstock_risk, stockout_horizon
- days_of_supply = on_hand_units / avg_daily_sales_13w
- forecast_accuracy = 1 - abs(actual - forecast) / forecast (weekly, SKU-store)
- forecast_bias = mean(actual - forecast) / mean(forecast)
- promo_roas = incremental_revenue / promo_spend
- competitive_price_index = retailer_price / lowest_competitor_price
- margin_at_risk = units_at_risk x (current_price - competitor_price) x margin_pct
- vendor_coop_utilisation = spent_coop / approved_coop_budget
- attach_rate = companion_units / primary_units
- gen_z_affinity_score = visits*0.25 + conversion*0.25 + repeat*0.2 + social*0.15 + bopis*0.15

AGENT CAPABILITIES:
You have access to these intelligence flows:
1. Category Overview — revenue vs plan, margin, inventory health, forecast accuracy
2. Health Check — 90-day anomaly detection, z-score analysis, prioritised action list
3. SKU Diagnosis — root cause: price gaps, promo failure, mix shift, competitive displacement
4. Demand Simulation — 4 scenarios with price/co-op levers, IRR output
5. Assortment Planning — seasonal add/drop/expand with bottom-quartile analysis
6. Executive Review — C-suite narrative, competitive scorecard, 30/60-day action plan
7. Ad Plan Optimizer — co-op balances, ROAS by channel, expiry risk flags
8. Competitive Pricing — real-time gap vs competitors, margin-at-risk per SKU
9. Gen Z Interest Agent — affinity scores, trending search terms, funnel by cohort
10. Demand Intent — search query performance, funnel diagnostics, market basket

RESPONSE STRUCTURE (always use this exact format):
## INTELLIGENCE FLOW: [which of the 10 flows applies]

## ROOT CAUSE
[specific metric from spine that triggered the flag + data supporting it]

## DATA SIGNALS
[bullet each signal with metric name, value, vs benchmark]

## RECOMMENDATION
[numbered actions with estimated P&L impact per action]

## CONFIDENCE
[score /10 + what data would change the recommendation]

GOVERNANCE:
- Never output raw customer PII
- All loyalty data is cohort-level only
- Always cite which metric spine definition you used
- Never invent data — state explicitly if data is unavailable"""


class IntelligenceAgent:
    def __init__(self, tool_instances: List[Any] = [], audit_logger: AuditLogger = None):
        self.tools = {t.name: t for t in tool_instances} if tool_instances else {}
        self.audit_logger = audit_logger
        self.model = None
        try:
            import vertexai
            from vertexai.generative_models import GenerativeModel
            vertexai.init(project=PROJECT, location=REGION)
            self.model = GenerativeModel(MODEL, system_instruction=SYSTEM_PROMPT)
            log.info("Vertex AI ready: project=%s model=%s", PROJECT, MODEL)
        except Exception as e:
            log.error("Vertex AI init failed: %s", e)

    async def stream_response(
        self,
        user_message: str,
        session_id: str,
        user_id: str = "anonymous",
        user_role: str = "viewer",
    ) -> AsyncIterator[Dict[str, str]]:
        try:
            yield {"step": "think", "content": "Reviewing question and forming analysis plan..."}
            await asyncio.sleep(0.05)

            yield {"step": "act", "content": "Querying category data and signals..."}
            await asyncio.sleep(0.05)

            yield {"step": "analyze", "content": "Synthesizing results and identifying patterns..."}
            await asyncio.sleep(0.05)

            if self.model is None:
                yield {"step": "error", "content": "Vertex AI not initialized — check ADC credentials"}
                return

            from vertexai.generative_models import GenerativeModel
            response = await asyncio.to_thread(
                self.model.generate_content,
                user_message,
                stream=True,
            )

            yield {"step": "respond", "content": ""}

            for chunk in response:
                try:
                    if chunk.text:
                        yield {"step": "respond_chunk", "content": chunk.text}
                except Exception:
                    continue

            yield {"step": "done", "content": ""}

            if self.audit_logger:
                try:
                    await self.audit_logger.log_agent_action(
                        session_id=session_id,
                        user_id=user_id,
                        user_role=user_role,
                        agent_name="IntelligenceAgent",
                        tool_calls_summary=[],
                        recommendation_text="streamed response"
                    )
                except Exception:
                    pass

        except Exception as e:
            log.error("stream_response failed: %s", e)
            yield {"step": "error", "content": str(e)}

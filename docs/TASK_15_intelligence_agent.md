# TASK_15_intelligence_agent.md — Intelligence Agent (Vertex AI Gemini)

**Status:** ✅ DONE  
**Phase:** 3 — Agents  
**Prerequisite:** TASK_04 through TASK_14 complete (all 10 tools built and passing tests)  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

The `IntelligenceAgent` is the core reasoning engine. It:
- Receives a user chat message
- Runs the 4-step loop: Think → Act → Analyze → Respond
- Calls domain tool modules via Vertex AI function-calling
- Streams each step as an SSE event to the FastAPI endpoint
- Writes a full audit record to BigQuery `agent_action_log`

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/agents/intelligence_agent.py   ← CREATE
backend/tools/__init__.py              ← CREATE (tool registry)
backend/core/audit/logger.py           ← CREATE (if not yet done)
```

---

## intelligence_agent.py — Full Spec

```python
# backend/agents/intelligence_agent.py

import vertexai
from vertexai.generative_models import GenerativeModel, Tool, FunctionDeclaration
import asyncio, os, json
from typing import AsyncIterator, Any

PROJECT = os.environ["GCP_PROJECT_ID"]        # ctoteam
REGION  = os.environ["VERTEX_AI_LOCATION"]     # us-central1
MODEL   = os.environ["VERTEX_MODEL"]           # gemini-3.1-pro-preview

vertexai.init(project=PROJECT, location=REGION)

SYSTEM_PROMPT = """
You are the Category Intelligence Agent for a retail category management platform.
Reason over live retail data: inventory, pricing, promotions, vendor co-op, loyalty, competitor signals.

Always follow this exact sequence — label each step clearly:
1. THINK: restate the question, identify which tools you need, form a plan.
2. ACT: call tools. Call in parallel when there are no data dependencies.
3. ANALYZE: synthesize outputs — find anomalies, causal relationships, trade-offs.
4. RESPOND: structured narrative with specific recommendations backed by data.

Each recommendation must include:
- Metric that triggered the flag (from Category Metric Spine)
- Root cause supported by data
- Recommended action with estimated P&L impact
- Confidence level and what would change the recommendation

Rules:
- Never invent data. If a tool returns nothing, say so.
- Never output raw customer PII. All loyalty data is cohort-level only.
- Always reference metric spine definitions, never improvise metric names.
"""

class IntelligenceAgent:
    def __init__(self, tool_instances: list, audit_logger):
        # Build Vertex AI Tool objects from tool instances
        declarations = [
            FunctionDeclaration(
                name=t.name,
                description=t.description,
                parameters=t.schema
            )
            for t in tool_instances
        ]
        vertex_tools = [Tool(function_declarations=declarations)]

        self.model = GenerativeModel(
            MODEL,
            system_instruction=SYSTEM_PROMPT,
            tools=vertex_tools
        )
        self.tool_map = {t.name: t for t in tool_instances}
        self.audit = audit_logger

    async def stream_response(
        self,
        user_message: str,
        session_id: str,
        user_id: str,
        user_role: str
    ) -> AsyncIterator[dict]:

        chat = self.model.start_chat()
        all_tool_calls_used = []

        # THINK
        yield {"step": "think", "content": "Reviewing available tools and forming analysis plan..."}

        response = await asyncio.to_thread(
            chat.send_message, user_message, stream=False
        )

        # ACT loop — keep calling tools until model stops requesting them
        while True:
            tool_calls = [
                part.function_call
                for part in response.candidates[0].content.parts
                if hasattr(part, "function_call") and part.function_call.name
            ]
            if not tool_calls:
                break

            tool_names = [tc.name for tc in tool_calls]
            all_tool_calls_used.extend(tool_names)

            yield {"step": "act", "content": f"Calling {len(tool_calls)} tool(s): {tool_names}"}

            tool_results = await self._execute_tools_parallel(
                tool_calls, user_id, user_role, session_id
            )

            # ANALYZE
            yield {"step": "analyze", "content": "Synthesizing tool outputs, identifying patterns..."}

            function_responses = [
                {"function_response": {"name": r["name"], "response": r["output"]}}
                for r in tool_results
            ]
            response = await asyncio.to_thread(
                chat.send_message, function_responses, stream=False
            )

        # RESPOND — stream final answer char by char for real-time effect
        final_text = response.text
        yield {"step": "respond", "content": ""}
        chunk_size = 8
        for i in range(0, len(final_text), chunk_size):
            yield {"step": "respond_chunk", "content": final_text[i:i+chunk_size]}
            await asyncio.sleep(0.01)

        # Audit log
        await self.audit.log_agent_action(
            session_id=session_id,
            user_id=user_id,
            user_role=user_role,
            agent_name="IntelligenceAgent",
            tool_calls_summary=all_tool_calls_used,
            recommendation_text=final_text[:500]
        )

        yield {"step": "done", "content": ""}

    async def _execute_tools_parallel(self, tool_calls, user_id, user_role, session_id):
        tasks = [
            self._execute_single_tool(tc, user_id, user_role, session_id)
            for tc in tool_calls
        ]
        return await asyncio.gather(*tasks)

    async def _execute_single_tool(self, tool_call, user_id, user_role, session_id) -> dict:
        tool = self.tool_map.get(tool_call.name)
        if not tool:
            return {"name": tool_call.name, "output": {"error": f"Unknown tool: {tool_call.name}"}}

        try:
            output = await tool.run(dict(tool_call.args))
        except Exception as e:
            output = {"error": str(e), "tool": tool_call.name}

        await self.audit.log_tool_call(
            tool_name=tool_call.name,
            inputs=dict(tool_call.args),
            output_summary=str(output)[:200],
            user_id=user_id,
            session_id=session_id
        )
        return {"name": tool_call.name, "output": output}
```

---

## tools/__init__.py — Tool Registry

```python
# backend/tools/__init__.py
from tools.inventory_analysis import InventoryAnalysisTool
from tools.margin_intelligence import MarginIntelligenceTool
from tools.promo_effectiveness import PromoEffectivenessTool
from tools.attach_rate_analysis import AttachRateAnalysisTool
from tools.forecast_accuracy import ForecastAccuracyTool
from tools.competitive_intelligence import CompetitiveIntelligenceTool
from tools.digital_performance import DigitalPerformanceTool
from tools.assortment_planning import AssortmentPlanningTool
from tools.gen_z_interest import GenZInterestTool
from tools.demand_intent import DemandIntentTool

def build_tool_registry(bq_client) -> list:
    """Instantiate all tools with shared BQ client. Returns list for IntelligenceAgent."""
    return [
        InventoryAnalysisTool(bq_client),
        MarginIntelligenceTool(bq_client),
        PromoEffectivenessTool(bq_client),
        AttachRateAnalysisTool(bq_client),
        ForecastAccuracyTool(bq_client),
        CompetitiveIntelligenceTool(bq_client),
        DigitalPerformanceTool(bq_client),
        AssortmentPlanningTool(bq_client),
        GenZInterestTool(bq_client),
        DemandIntentTool(bq_client),
    ]
```

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/agents/intelligence_agent.py \
  --file backend/tools/__init__.py \
  --file backend/core/audit/logger.py
```

**Prompt to paste into Aider:**

```
Create backend/agents/intelligence_agent.py exactly as specified in TASK_15.
Create backend/tools/__init__.py as the tool registry.
In backend/core/audit/logger.py, implement two async methods:
  - log_agent_action(session_id, user_id, user_role, agent_name, tool_calls_summary, recommendation_text)
  - log_tool_call(tool_name, inputs, output_summary, user_id, session_id)
Both methods must write to BigQuery table:
  ctoteam.category_intelligence.agent_action_log
Use google-cloud-bigquery InsertRowsAsync. Include error handling — log failure to stderr, never raise.
```

---

## Validation Steps

```bash
# 1. Python type check
cd backend && mypy agents/intelligence_agent.py --ignore-missing-imports

# 2. Import check — no circular imports
python -c "from agents.intelligence_agent import IntelligenceAgent; print('OK')"

# 3. Tool registry check
python -c "from tools import build_tool_registry; print(f'{len(build_tool_registry(None))} tools registered')"
# Expected: 10 tools registered

# 4. Ruff lint
ruff check agents/ tools/ core/
```

---

## Definition of Done

- [ ] `intelligence_agent.py` created and passes mypy
- [ ] `tools/__init__.py` registers all 10 tools
- [ ] `audit/logger.py` writes to BigQuery without raising on failure
- [ ] `python -c "from agents.intelligence_agent import IntelligenceAgent"` exits 0
- [ ] `ruff check .` exits 0
- [ ] Mark status ✅ DONE

---

*Task: TASK_15 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*

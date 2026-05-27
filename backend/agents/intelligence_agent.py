import os
import re
import json
import asyncio
import logging
from typing import Any, AsyncIterator, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Project / dataset ────────────────────────────────────────────────────────
PROJECT = os.environ.get("GCP_PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT") or "ctoteam"
DATASET = os.environ.get("BIGQUERY_DATASET", "category_intelligence")

# ── BigQuery helpers ─────────────────────────────────────────────────────────
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9._\-]+$")

def _safe_id(value: Any) -> str:
    if value is None:
        return ""
    s = str(value)
    if not _SAFE_ID_RE.match(s):
        raise ValueError(f"Unsafe identifier rejected: {s!r}")
    return s


def _bq_client():
    from google.cloud import bigquery
    return bigquery.Client(project=PROJECT)


def build_category_predicate(category: str, column: str = "sku_name") -> str:
    if category == "Home Appliance":
        return f"REGEXP_CONTAINS(LOWER({column}), r'(fridge|refrigerator|washer|dryer|oven|microwave|range|appliance)')"
    if category == "Mobile Accessories":
        return f"REGEXP_CONTAINS(LOWER({column}), r'(case|charger|cable|power bank|screen protector|mount|adapter|phone)')"
    return f"REGEXP_CONTAINS(LOWER({column}), r'(tv|oled|soundbar|projector|receiver|bose|sonos)')"


def inject_category_predicate(sql: str, category: str, column: str = "sku_name") -> str:
    predicate = build_category_predicate(category, column)
    # Insert category predicate before trailing QUALIFY / ORDER BY / LIMIT clauses.
    # Appending at the very end can corrupt syntax (e.g., after LIMIT).
    tail_match = re.search(r"\b(QUALIFY|ORDER\s+BY|LIMIT)\b", sql, flags=re.IGNORECASE)
    if tail_match:
        head = sql[:tail_match.start()]
        tail = sql[tail_match.start():]
    else:
        head = sql
        tail = ""

    if re.search(r"\bWHERE\b", head, flags=re.IGNORECASE):
        head = f"{head} AND {predicate}"
    else:
        head = f"{head} WHERE {predicate}"
    return f"{head} {tail}".strip()


def _run_query(sql: str, params: Optional[Dict[str, Any]] = None) -> List[dict]:
    """Parameterized BigQuery SELECT helper. Tolerates missing creds — returns []."""
    try:
        from google.cloud import bigquery
        client = _bq_client()
        job_config = None
        if params:
            qp = []
            for k, v in params.items():
                if isinstance(v, int):
                    qp.append(bigquery.ScalarQueryParameter(k, "INT64", v))
                else:
                    qp.append(bigquery.ScalarQueryParameter(k, "STRING", str(v) if v is not None else None))
            job_config = bigquery.QueryJobConfig(query_parameters=qp)
        rows = list(client.query(sql, job_config=job_config).result())
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning("BQ query failed: %s", e)
        return []


# ── Real BigQuery-backed tools ───────────────────────────────────────────────

def get_competitive_pricing(sku_id: Optional[str] = None, limit: int = 20, category: str = "Entertainment") -> Dict[str, Any]:
    sku_clause = ""
    params: Dict[str, Any] = {"row_limit": int(limit) if limit else 20}
    if sku_id:
        params["sku_id"] = _safe_id(sku_id)
        sku_clause = "AND s.sku_id = @sku_id"
    # Joins sku_master (m) so retailer/our price comes from the canonical
    # source, not the snapshot row (which can be 0 or stale). All sanity
    # bounds and gap calc are derived from m.our_price.
    sql = f"""
        SELECT
            s.sku_id,
            m.sku_name,
            'Google Shopping' AS competitor_name,
            CAST(m.our_price AS FLOAT64)        AS our_price,
            CAST(s.competitor_price AS FLOAT64) AS market_price,
            ROUND((m.our_price - s.competitor_price) / NULLIF(m.our_price, 0) * 100, 1) AS price_gap_pct,
            IF(COALESCE(s.in_stock, TRUE), 'In', 'Out') AS stock_status,
            s.snapshot_time
        FROM `{PROJECT}.{DATASET}.competitor_price_snapshots` s
        INNER JOIN `{PROJECT}.{DATASET}.sku_master` m
                ON s.sku_id = m.sku_id
        WHERE s.snapshot_time = (
            SELECT MAX(snapshot_time)
            FROM `{PROJECT}.{DATASET}.competitor_price_snapshots`
        )
        {sku_clause}
          -- Sanity bounds: drop rows where SerpAPI returned a marketplace,
          -- bundle, or component listing that isn't a like-for-like compare.
          -- Allowed market price band: 0.5x–1.5x of our price (from sku_master).
          AND m.our_price > 0
          AND s.competitor_price > 0
          AND s.competitor_price >= m.our_price * 0.5
          AND s.competitor_price <= m.our_price * 1.5
        -- Pick the competitor row whose price is closest to ours — the most
        -- realistic like-for-like compare, not just the highest-priced
        -- listing returned by SerpAPI.
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY s.sku_id
            ORDER BY ABS(s.competitor_price - m.our_price) ASC
        ) = 1
        ORDER BY ABS((m.our_price - s.competitor_price) / NULLIF(m.our_price, 0)) DESC
        LIMIT @row_limit
    """
    rows = _run_query(inject_category_predicate(sql, category, "m.sku_name"), params)
    return {
        "source": "bigquery-live" if rows else "empty",
        "table": "competitor_price_snapshots",
        "row_count": len(rows),
        "data": rows,
    }


def get_margin_intelligence(sku_id: Optional[str] = None, limit: int = 20, category: str = "Entertainment") -> Dict[str, Any]:
    sku_clause = ""
    params: Dict[str, Any] = {"row_limit": int(limit) if limit else 20}
    if sku_id:
        params["sku_id"] = _safe_id(sku_id)
        sku_clause = "AND s.sku_id = @sku_id"
    # Mirrors get_competitive_pricing: join sku_master, use m.our_price as
    # canonical retail, filter to like-for-like compares, pick closest match.
    sql = f"""
        SELECT
            s.sku_id,
            m.sku_name,
            'Google Shopping' AS competitor_name,
            CAST(m.our_price AS FLOAT64)        AS our_price,
            CAST(s.competitor_price AS FLOAT64) AS market_price,
            ROUND(m.our_price - s.competitor_price, 2) AS price_gap_abs,
            ROUND((m.our_price - s.competitor_price) / NULLIF(m.our_price, 0) * 100, 1) AS price_gap_pct
        FROM `{PROJECT}.{DATASET}.competitor_price_snapshots` s
        INNER JOIN `{PROJECT}.{DATASET}.sku_master` m
                ON s.sku_id = m.sku_id
        WHERE s.snapshot_time = (
            SELECT MAX(snapshot_time)
            FROM `{PROJECT}.{DATASET}.competitor_price_snapshots`
        )
          {sku_clause}
          AND m.our_price > 0
          AND s.competitor_price > 0
          AND s.competitor_price >= m.our_price * 0.5
          AND s.competitor_price <= m.our_price * 1.5
          -- Margin opportunity = market is HIGHER than ours (we could raise).
          -- price_gap_pct < 0 means ours below market.
          AND s.competitor_price > m.our_price
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY s.sku_id
            ORDER BY ABS(s.competitor_price - m.our_price) ASC
        ) = 1
        ORDER BY price_gap_pct ASC
        LIMIT @row_limit
    """
    rows = _run_query(inject_category_predicate(sql, category, "m.sku_name"), params)
    return {
        "source": "bigquery-live" if rows else "empty",
        "table": "competitor_price_snapshots",
        "note": "price_gap_pct < 0 means our price is below market (margin opportunity)",
        "row_count": len(rows),
        "data": rows,
    }


def get_inventory_analysis(sku_id: Optional[str] = None, limit: int = 20, category: str = "Entertainment") -> Dict[str, Any]:
    sku_clause = "WHERE COALESCE(active_flag, TRUE) = TRUE"
    params: Dict[str, Any] = {"row_limit": int(limit) if limit else 20}
    if sku_id:
        params["sku_id"] = _safe_id(sku_id)
        sku_clause = "WHERE sku_id = @sku_id"
    sql = f"""
        SELECT sku_id, sku_name, COALESCE(active_flag, TRUE) AS active_flag
        FROM `{PROJECT}.{DATASET}.sku_master`
        {sku_clause}
        LIMIT @row_limit
    """
    rows = _run_query(inject_category_predicate(sql, category, "sku_name"), params)
    return {
        "source": "bigquery-live" if rows else "empty",
        "table": "sku_master",
        "note": "Catalog only — on-hand units / DoS not yet in BigQuery.",
        "row_count": len(rows),
        "data": rows,
    }


# ── Stub tools (safe fallback until tables exist) ────────────────────────────
def _stub_tool(name: str, **kwargs) -> Dict[str, Any]:
    return {"source": "static", "note": f"{name} is not yet wired to BigQuery", "data": []}


# ── Tool registry ────────────────────────────────────────────────────────────
TOOLS: Dict[str, Any] = {
    "get_competitive_pricing":  get_competitive_pricing,
    "get_margin_intelligence":  get_margin_intelligence,
    "get_inventory_analysis":   get_inventory_analysis,

    "get_promo_effectiveness":  lambda **kw: _stub_tool("get_promo_effectiveness", **kw),
    "get_forecast_accuracy":    lambda **kw: _stub_tool("get_forecast_accuracy", **kw),
    "get_attach_rate_analysis": lambda **kw: _stub_tool("get_attach_rate_analysis", **kw),
    "get_assortment_planning":  lambda **kw: _stub_tool("get_assortment_planning", **kw),
    "get_digital_performance":  lambda **kw: _stub_tool("get_digital_performance", **kw),
    "get_demand_intent":        lambda **kw: _stub_tool("get_demand_intent", **kw),
}


# ── Simple intent router ─────────────────────────────────────────────────────
def route_query(user_input: str) -> Dict[str, Any]:
    text = (user_input or "").lower()

    if any(k in text for k in ("price gap", "competitive", "amazon", "vs market", "competitor")):
        return {"tool": "get_competitive_pricing", "params": {}}

    if any(k in text for k in ("below market", "margin", "underprice")):
        return {"tool": "get_margin_intelligence", "params": {}}

    if any(k in text for k in ("active sku", "list sku", "inventory", "catalog", "stock")):
        return {"tool": "get_inventory_analysis", "params": {}}

    if any(k in text for k in ("promo", "roas", "lift")):
        return {"tool": "get_promo_effectiveness", "params": {}}

    if any(k in text for k in ("forecast", "mape", "bias")):
        return {"tool": "get_forecast_accuracy", "params": {}}

    if any(k in text for k in ("assortment", "drop", "expand", "spring", "cycle")):
        return {"tool": "get_assortment_planning", "params": {}}

    if any(k in text for k in ("attach", "bundle", "companion")):
        return {"tool": "get_attach_rate_analysis", "params": {}}

    if any(k in text for k in ("digital", "bounce", "pdp")):
        return {"tool": "get_digital_performance", "params": {}}

    if any(k in text for k in ("gen z", "tiktok", "trending")):
        return {"tool": "get_gen_z_interest", "params": {}}

    if any(k in text for k in ("demand", "search query", "intent")):
        return {"tool": "get_demand_intent", "params": {}}

    # Default — a category overview is most useful when intent is unclear
    return {"tool": "get_competitive_pricing", "params": {}}


# ── Markdown formatter ───────────────────────────────────────────────────────
def _format_as_markdown(question: str, tool_name: str, result: Dict[str, Any]) -> str:
    flow_label = tool_name.replace("get_", "").replace("_", " ").title()
    source = result.get("source", "unknown")
    note = result.get("note", "")
    data = result.get("data") or []
    lines: List[str] = [f"## INTELLIGENCE FLOW: {flow_label}"]

    # Root cause line — try to surface the most extreme row
    if isinstance(data, list) and data and isinstance(data[0], dict):
        first = data[0]
        if "price_gap_pct" in first:
            lines += [
                "## ROOT CAUSE",
                f"Top divergence: **{first.get('sku_name') or first.get('sku_id')}** "
                f"at gap **{first.get('price_gap_pct'):.1f}%** (ours ${first.get('our_price', 0):,.2f} vs market ${first.get('market_price', 0):,.2f}).",
            ]
        else:
            lines += ["## ROOT CAUSE", f"Showing top **{result.get('row_count', len(data))}** rows from `{result.get('table', 'unknown')}`."]
    else:
        lines += ["## ROOT CAUSE", "No live rows returned. " + (note or "")]

    # Data signals — list up to 8 rows compactly
    lines.append("## DATA SIGNALS")
    if isinstance(data, list) and data:
        for row in data[:8]:
            if not isinstance(row, dict):
                continue
            label = row.get("sku_name") or row.get("sku_id") or row.get("event") or row.get("metric") or "row"
            if "price_gap_pct" in row:
                lines.append(
                    f"- **{label}** — ours ${row.get('our_price', 0):,.2f}, market ${row.get('market_price', 0):,.2f}, gap **{row.get('price_gap_pct', 0):.1f}%**"
                )
            elif "value" in row:
                lines.append(f"- **{label}** — value {row.get('value')}")
            else:
                lines.append(f"- **{label}**")
    else:
        lines.append(f"- _No data_ ({source}). {note}")

    # Recommendation — keyword-derived defaults
    lines.append("## RECOMMENDATION")
    if tool_name == "get_competitive_pricing":
        lines += [
            "1. Reprice the top 5 SKUs trending furthest below market.",
            "2. Flag SKUs above market for ad-spend backstop or co-op draft.",
        ]
    elif tool_name == "get_margin_intelligence":
        lines += [
            "1. Trigger reprice review on bottom-quartile gap rows.",
            "2. Cross-check with co-op balance before raising shelf price.",
        ]
    else:
        lines += ["1. See attached data table.", "2. Drill in by SKU for action."]

    lines += ["## CONFIDENCE", f"7/10 — sourced from `{source}`. {note}".strip()]
    return "\n\n".join(lines)


# ── Agent class ──────────────────────────────────────────────────────────────
class IntelligenceAgent:
    """Keyword-routed tool dispatcher with an async SSE stream interface.

    Backwards-compatible signature so ``IntegrationAgent`` can keep calling
    ``IntelligenceAgent([], audit_logger)``. Both args are accepted and either
    can be omitted.
    """

    def __init__(self, tool_instances: Optional[List[Any]] = None, audit_logger: Any = None):
        # tool_instances was used by the previous Vertex AI tool-calling agent.
        # We keep the parameter for compatibility with IntegrationAgent.__init__
        # but ignore it — TOOLS is the single source of truth here.
        self.tools = TOOLS
        self.audit_logger = audit_logger

    # Sync convenience entry-point (kept so __main__ test block still works)
    def run(self, user_input: str) -> Dict[str, Any]:
        try:
            route = route_query(user_input)
            tool_name = route["tool"]
            params = route.get("params", {})
            logger.info("Tool call: %s(%s)", tool_name, params)
            if tool_name not in self.tools:
                return {"status": "error", "message": f"Tool {tool_name} not found"}
            result = self.tools[tool_name](**params)
            return {"status": "success", "tool": tool_name, "result": result}
        except Exception as e:
            logger.exception("Agent execution failed")
            return {"status": "error", "message": str(e)}

    # Async streaming entry-point used by IntegrationAgent.run_chat
    async def stream_response(
        self,
        user_message: str,
        session_id: str = "",
        user_id: str = "anonymous",
        user_role: str = "viewer",
    ) -> AsyncIterator[Dict[str, str]]:
        try:
            # 1. THINK — choose the tool
            yield {"step": "think", "content": "Reviewing question and selecting intelligence tool…"}
            await asyncio.sleep(0)

            route = route_query(user_message)
            tool_name = route["tool"]
            params = route.get("params", {})

            # 2. ACT — call the tool
            yield {"step": "act", "content": f"Calling: {tool_name}"}
            tool_fn = self.tools.get(tool_name)
            if tool_fn is None:
                yield {"step": "error", "content": f"Unknown tool: {tool_name}"}
                return
            try:
                result = await asyncio.to_thread(tool_fn, **params)
            except Exception as tool_err:
                logger.exception("Tool %s raised", tool_name)
                yield {"step": "error", "content": f"Tool {tool_name} failed: {tool_err}"}
                return

            # 3. ANALYZE — synthesize
            row_count = result.get("row_count", len(result.get("data", []) or []))
            yield {"step": "analyze", "content": f"Synthesizing {row_count} row(s) from {result.get('source', 'unknown')}…"}

            # 4. RESPOND — format and stream the markdown
            markdown = _format_as_markdown(user_message, tool_name, result)
            yield {"step": "respond", "content": ""}
            # Chunk by paragraph so the client renders progressively without a flood of tokens
            for para in markdown.split("\n\n"):
                if not para:
                    continue
                yield {"step": "respond_chunk", "content": para + "\n\n"}
                await asyncio.sleep(0)

            yield {"step": "done", "content": ""}

            # Audit log (best-effort)
            if self.audit_logger:
                try:
                    await self.audit_logger.log_agent_action(
                        session_id=session_id,
                        user_id=user_id,
                        user_role=user_role,
                        agent_name="IntelligenceAgent",
                        tool_calls_summary=[{"tool": tool_name, "params": params, "rows": row_count}],
                        recommendation_text=f"streamed response from {tool_name}",
                    )
                except Exception:
                    pass

        except Exception as e:
            logger.exception("stream_response failed")
            yield {"step": "error", "content": str(e)}


# ── Entry point (for testing) ────────────────────────────────────────────────
if __name__ == "__main__":
    agent = IntelligenceAgent()
    queries = [
        "What are the biggest price gaps in the category right now?",
        "Which SKUs are priced below market?",
        "List 5 active SKUs.",
    ]
    for q in queries:
        print("\n=== QUERY ===")
        print(q)
        response = agent.run(q)
        print(json.dumps(response, indent=2, default=str))

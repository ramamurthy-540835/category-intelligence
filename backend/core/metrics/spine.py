METRIC_SPINE = {
    "revenue_vs_plan": "actual_net_revenue / planned_revenue - 1",
    "avg_margin_pct": "(net_revenue - cogs - vendor_coop) / net_revenue",
    "inventory_health_score": "composite 0-100: DoS, in_stock_pct, overstock_risk, stockout_horizon",
    "days_of_supply": "on_hand_units / avg_daily_sales_13w",
    "forecast_accuracy": "1 - abs(actual - forecast) / forecast",
    "forecast_bias": "mean(actual - forecast) / mean(forecast)",
    "promo_roas": "incremental_revenue / promo_spend",
    "competitive_price_index": "retailer_price / lowest_competitor_price",
    "margin_at_risk": "units_at_risk * (current_price - competitor_price) * margin_pct",
    "vendor_coop_utilisation": "spent_coop / approved_coop_budget",
    "attach_rate": "companion_units / primary_units",
    "gen_z_affinity_score": "visits*0.25 + conversion*0.25 + repeat*0.2 + social*0.15 + bopis*0.15"
}

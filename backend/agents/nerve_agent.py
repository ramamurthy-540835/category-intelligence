from typing import Dict, Any, Optional

class NerveAgent:
    def __init__(self):
        self.recent_alerts = {}

    async def route(self, alert_event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            sku_id = alert_event.get("sku_id")
            alert_type = alert_event.get("alert_type")
            key = f"{sku_id}_{alert_type}"
            
            if key in self.recent_alerts:
                return None
                
            self.recent_alerts[key] = True
            
            priority = "P3"
            if alert_type == "stockout":
                priority = "P1"
            elif alert_type == "overstock":
                priority = "P2"
                
            return {
                "tool": "inventory_analysis",
                "priority": priority,
                "event": alert_event
            }
        finally:
            pass

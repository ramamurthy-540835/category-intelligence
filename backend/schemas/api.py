from pydantic import BaseModel
from typing import Dict, Any

class ChatRequest(BaseModel):
    message: str
    session_id: str
    user_id: str
    user_role: str

class ActionRequest(BaseModel):
    action_type: str
    payload: Dict[str, Any]
    user_id: str
    user_role: str

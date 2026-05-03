from fastapi import HTTPException

ROLE_PERMISSIONS = {
    'viewer': {'read_kpis'},
    'analyst': {'read_kpis', 'run_diagnosis', 'run_simulation'},
    'manager': {'read_kpis', 'run_diagnosis', 'run_simulation', 'trigger_action', 'export', 'manage_campaigns'},
    'admin': {'read_kpis', 'run_diagnosis', 'run_simulation', 'trigger_action', 'export', 'manage_campaigns'}
}

def has_permission(role: str, permission: str) -> bool:
    perms = ROLE_PERMISSIONS.get(role, set())
    return permission in perms

async def require_permission(permission: str):
    def dependency(user_role: str):
        if not has_permission(user_role, permission):
            raise HTTPException(status_code=403, detail="Permission denied")
        return True
    return dependency

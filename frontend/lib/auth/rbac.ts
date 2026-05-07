export type UserRole = 'viewer' | 'analyst' | 'manager';
export type Permission = 'read_kpis' | 'run_diagnosis' | 'run_simulation' | 'trigger_action' | 'export' | 'manage_campaigns';

const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  viewer: new Set(['read_kpis']),
  analyst: new Set(['read_kpis', 'run_diagnosis', 'run_simulation']),
  manager: new Set(['read_kpis', 'run_diagnosis', 'run_simulation', 'trigger_action', 'export', 'manage_campaigns'])
};

export function can(role: UserRole | string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as UserRole];
  return perms ? perms.has(permission) : false;
}


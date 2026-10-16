import type { ColumnType, Generated } from 'kysely';

// Tipos de las tablas para Kysely. Reflejan las migraciones de migrations/ y data-model.md.
// Las historias siguientes agregan sus tablas aquí.

type Fecha = ColumnType<Date, Date | string | undefined, Date | string>;
type FechaNula = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

export interface TenantTable {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVA' | 'SUSPENDIDA';
  created_at: Fecha;
}

export interface RoleTable {
  code: string;
  description: string;
}

export interface UserAccountTable {
  id: string;
  email: string;
  full_name: string;
  // barberias_app no puede leer esta columna (ADR-015); solo la función auth_resolver_cuenta.
  password_hash: string | null;
  is_platform_admin: Generated<boolean>;
  created_at: Fecha;
}

export interface MembershipTable {
  id: string;
  tenant_id: string;
  user_id: string;
  role_code: 'PROPIETARIO' | 'BARBERO';
  status: 'PENDIENTE' | 'ACTIVA' | 'DESACTIVADA';
  created_at: Fecha;
  updated_at: Fecha;
}

export interface AuthSessionTable {
  id: string;
  tenant_id: string;
  user_id: string;
  refresh_token_hash: string;
  previous_token_hash: string | null;
  status: 'ACTIVA' | 'CERRADA' | 'REVOCADA';
  created_at: Fecha;
  last_used_at: Fecha;
  absolute_expires_at: Fecha;
  ended_at: FechaNula;
  ip: string | null;
  user_agent: string | null;
  // Período de gracia (migración 0008, FR-008a).
  rotated_at: FechaNula;
  grace_used_at: FechaNula;
  superseded_token_hash: string | null;
}

export interface AccountActivationTable {
  id: string;
  tenant_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Fecha;
  used_at: FechaNula;
  revoked_at: FechaNula;
  created_by: string;
  created_at: Fecha;
}

export interface AuditLogTable {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  resource: string | null;
  result: 'PERMITIDO' | 'DENEGADO';
  ip: string | null;
  correlation_id: string | null;
  at: Fecha;
}

export interface PlanTable {
  id: string;
  code: string;
  trial_days: number | null;
  max_users: number;
  max_barbers: number;
  ai_enabled: boolean;
}

export interface SubscriptionTable {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';
  started_at: Fecha;
  trial_ends_at: FechaNula;
  current_period_end: FechaNula;
}

export interface TermsAcceptanceTable {
  id: string;
  tenant_id: string;
  user_id: string;
  document: 'TERMINOS' | 'POLITICA_DATOS';
  text_version: string;
  accepted_at: Fecha;
  ip: string | null;
}

export interface LoginAttemptTable {
  id: Generated<string>;
  email_hash: string;
  ip: string;
  attempted_at: Fecha;
}

export interface Database {
  tenant: TenantTable;
  role: RoleTable;
  user_account: UserAccountTable;
  membership: MembershipTable;
  auth_session: AuthSessionTable;
  account_activation: AccountActivationTable;
  audit_log: AuditLogTable;
  plan: PlanTable;
  subscription: SubscriptionTable;
  terms_acceptance: TermsAcceptanceTable;
  login_attempt: LoginAttemptTable;
}

import type { ColumnType, Generated } from 'kysely';

// Tipos de las tablas para Kysely. Reflejan las migraciones de migrations/ y data-model.md.
// Las historias siguientes agregan sus tablas aquí.

type Fecha = ColumnType<Date, Date | string | undefined, Date | string>;
type FechaNula = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** Texto opcional: puede omitirse al insertar. */
type TextoNulo = ColumnType<string | null, string | null | undefined, string | null>;
/** PostgreSQL devuelve `time` como texto `HH:MM:SS`. */
type Hora = string;
/** PostgreSQL devuelve `numeric` como texto para no perder precisión. */
type Decimal = ColumnType<string, string | number, string | number>;

export interface TenantTable {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVA' | 'SUSPENDIDA';
  created_at: Fecha;
  // Funcionalidad 002 (migración 0010, RF03).
  address: TextoNulo;
  phone: TextoNulo;
  description: TextoNulo;
  timezone: Generated<string>;
  cancel_min_notice_minutes: Generated<number>;
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
  role_code: 'PROPIETARIO' | 'BARBERO' | 'CLIENTE';
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

// --- Funcionalidad 002: cuenta de cliente (0009), catálogo (0010) y citas (0011) ---

export type OrigenCliente = 'EN_LINEA' | 'PRESENCIAL';

export interface CustomerProfileTable {
  id: string;
  tenant_id: string;
  user_id: string | null;
  full_name: string;
  email: TextoNulo;
  phone: string;
  origin: OrigenCliente;
  created_by: TextoNulo;
  created_at: Fecha;
  updated_at: Fecha;
}

export interface ConsentRecordTable {
  id: string;
  tenant_id: string;
  customer_id: string;
  document: 'POLITICA_DATOS';
  text_version: string;
  method: OrigenCliente;
  recorded_by: TextoNulo;
  ip: TextoNulo;
  accepted_at: Fecha;
}

export interface BusinessHoursTable {
  id: string;
  tenant_id: string;
  weekday: number;
  start_time: Hora;
  end_time: Hora;
}

export interface ServiceTable {
  id: string;
  tenant_id: string;
  name: string;
  description: TextoNulo;
  price: Decimal;
  duration_min: number;
  active: Generated<boolean>;
  created_at: Fecha;
  updated_at: Fecha;
}

export interface BarberTable {
  id: string;
  tenant_id: string;
  user_id: TextoNulo;
  display_name: string;
  active: Generated<boolean>;
  created_at: Fecha;
  updated_at: Fecha;
}

export interface BarberServiceTable {
  tenant_id: string;
  barber_id: string;
  service_id: string;
}

export interface WorkingHoursTable {
  id: string;
  tenant_id: string;
  barber_id: string;
  weekday: number;
  start_time: Hora;
  end_time: Hora;
}

export interface TimeOffTable {
  id: string;
  tenant_id: string;
  barber_id: string;
  starts_at: Fecha;
  ends_at: Fecha;
  reason: TextoNulo;
  created_by: string;
  created_at: Fecha;
}

export type EstadoCitaDb = 'PENDIENTE' | 'CONFIRMADA' | 'COMPLETADA' | 'NO_ASISTIO' | 'CANCELADA';

export interface AppointmentTable {
  id: string;
  tenant_id: string;
  barber_id: string;
  service_id: string;
  customer_id: string;
  service_name: string;
  price: Decimal;
  duration_min: number;
  starts_at: Fecha;
  ends_at: Fecha;
  /** Columna generada `[starts_at, ends_at)`: solo lectura. */
  period: ColumnType<string, never, never>;
  status: EstadoCitaDb;
  origin: OrigenCliente;
  late_cancellation: Generated<boolean>;
  created_by: string;
  cancelled_by: TextoNulo;
  cancelled_at: FechaNula;
  cancel_reason: TextoNulo;
  idempotency_key: TextoNulo;
  request_hash: TextoNulo;
  created_at: Fecha;
  updated_at: Fecha;
}

export interface AppointmentStatusHistoryTable {
  id: string;
  tenant_id: string;
  appointment_id: string;
  from_status: EstadoCitaDb | null;
  to_status: EstadoCitaDb;
  changed_by: string;
  changed_at: Fecha;
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
  customer_profile: CustomerProfileTable;
  consent_record: ConsentRecordTable;
  business_hours: BusinessHoursTable;
  service: ServiceTable;
  barber: BarberTable;
  barber_service: BarberServiceTable;
  working_hours: WorkingHoursTable;
  time_off: TimeOffTable;
  appointment: AppointmentTable;
  appointment_status_history: AppointmentStatusHistoryTable;
}

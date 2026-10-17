import { type Kysely, sql } from 'kysely';
import { TENANT_ACTUAL, rlsPorTenant } from './sql-comun';

// T007 · Catálogo de la barbería (funcionalidad 002, RF03, RF07–RF09).
//
// - tenant (M01) gana datos comerciales, zona horaria y antelación mínima de cancelación. Como la
//   aplicación ahora puede modificarla, se activa RLS con FORCE: lectura e inserción libres (la usan la
//   autenticación y el registro de 001), pero UPDATE solo sobre el tenant de la transacción (R15).
// - Tablas de M02 (catalogo): business_hours, service, barber, barber_service, working_hours, time_off,
//   todas con RLS por tenant, UNIQUE (tenant_id, id) y claves foráneas compuestas que impiden apuntar a
//   filas de otra barbería.
// - btree_gist (extensión de confianza: la crea el dueño de la base) para los índices GiST que combinan
//   uuid con rangos de tiempo; la usan también las restricciones de exclusión de 0011.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE EXTENSION IF NOT EXISTS btree_gist;

    ALTER TABLE tenant
      ADD COLUMN address varchar(200) CHECK (address IS NULL OR char_length(btrim(address)) BETWEEN 1 AND 200),
      ADD COLUMN phone varchar(20) CHECK (phone IS NULL OR phone ~ '^\\+?[0-9 ]{6,20}$'),
      ADD COLUMN description varchar(500),
      ADD COLUMN timezone varchar(40) NOT NULL DEFAULT 'America/Lima' CHECK (timezone = 'America/Lima'),
      ADD COLUMN cancel_min_notice_minutes int NOT NULL DEFAULT 120
        CHECK (cancel_min_notice_minutes BETWEEN 0 AND 4320);

    ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_lectura ON tenant FOR SELECT USING (true);
    CREATE POLICY tenant_alta ON tenant FOR INSERT WITH CHECK (true);
    CREATE POLICY tenant_edicion ON tenant FOR UPDATE
      USING (id = ${TENANT_ACTUAL})
      WITH CHECK (id = ${TENANT_ACTUAL});
    GRANT UPDATE (name, slug, address, phone, description, cancel_min_notice_minutes) ON tenant TO barberias_app;

    CREATE TABLE business_hours (
      id          uuid PRIMARY KEY,
      tenant_id   uuid     NOT NULL REFERENCES tenant (id),
      weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time  time     NOT NULL,
      end_time    time     NOT NULL,
      CHECK (start_time < end_time),
      UNIQUE (tenant_id, id)
    );
    CREATE INDEX business_hours_dia ON business_hours (tenant_id, weekday);

    CREATE TABLE service (
      id            uuid PRIMARY KEY,
      tenant_id     uuid          NOT NULL REFERENCES tenant (id),
      name          varchar(80)   NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
      description   varchar(300),
      price         numeric(10,2) NOT NULL CHECK (price >= 0 AND price < 100000),
      duration_min  smallint      NOT NULL CHECK (duration_min BETWEEN 5 AND 480 AND duration_min % 5 = 0),
      active        boolean       NOT NULL DEFAULT true,
      created_at    timestamptz   NOT NULL DEFAULT now(),
      updated_at    timestamptz   NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id)
    );
    CREATE UNIQUE INDEX service_nombre_unico ON service (tenant_id, lower(name));

    CREATE TABLE barber (
      id            uuid PRIMARY KEY,
      tenant_id     uuid        NOT NULL REFERENCES tenant (id),
      user_id       uuid,
      display_name  varchar(80) NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 80),
      active        boolean     NOT NULL DEFAULT true,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      -- El usuario vinculado debe tener membresía en la misma barbería.
      FOREIGN KEY (tenant_id, user_id) REFERENCES membership (tenant_id, user_id)
    );
    CREATE UNIQUE INDEX barber_usuario_unico ON barber (tenant_id, user_id) WHERE user_id IS NOT NULL;

    CREATE TABLE barber_service (
      tenant_id   uuid NOT NULL REFERENCES tenant (id),
      barber_id   uuid NOT NULL,
      service_id  uuid NOT NULL,
      PRIMARY KEY (tenant_id, barber_id, service_id),
      FOREIGN KEY (tenant_id, barber_id) REFERENCES barber (tenant_id, id),
      FOREIGN KEY (tenant_id, service_id) REFERENCES service (tenant_id, id)
    );
    CREATE INDEX barber_service_servicio ON barber_service (tenant_id, service_id);

    CREATE TABLE working_hours (
      id          uuid PRIMARY KEY,
      tenant_id   uuid     NOT NULL REFERENCES tenant (id),
      barber_id   uuid     NOT NULL,
      weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time  time     NOT NULL,
      end_time    time     NOT NULL,
      CHECK (start_time < end_time),
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, barber_id) REFERENCES barber (tenant_id, id)
    );
    CREATE INDEX working_hours_barbero_dia ON working_hours (tenant_id, barber_id, weekday);

    CREATE TABLE time_off (
      id          uuid PRIMARY KEY,
      tenant_id   uuid         NOT NULL REFERENCES tenant (id),
      barber_id   uuid         NOT NULL,
      starts_at   timestamptz  NOT NULL,
      ends_at     timestamptz  NOT NULL,
      reason      varchar(200),
      created_by  uuid         NOT NULL,
      created_at  timestamptz  NOT NULL DEFAULT now(),
      CHECK (starts_at < ends_at),
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, barber_id) REFERENCES barber (tenant_id, id)
    );
    CREATE INDEX time_off_rango ON time_off
      USING gist (tenant_id, barber_id, tstzrange(starts_at, ends_at, '[)'));

    ${rlsPorTenant('business_hours')}
    ${rlsPorTenant('service')}
    ${rlsPorTenant('barber')}
    ${rlsPorTenant('barber_service')}
    ${rlsPorTenant('working_hours')}
    ${rlsPorTenant('time_off')}

    -- Horarios: la semana se reemplaza completa (DELETE + INSERT en una transacción).
    GRANT SELECT, INSERT, DELETE ON business_hours TO barberias_app;
    GRANT SELECT, INSERT, DELETE ON working_hours TO barberias_app;
    -- Servicios y barberos no se eliminan: se desactivan (FR-006, FR-011).
    GRANT SELECT, INSERT ON service TO barberias_app;
    GRANT UPDATE (name, description, price, duration_min, active, updated_at) ON service TO barberias_app;
    GRANT SELECT, INSERT ON barber TO barberias_app;
    GRANT UPDATE (user_id, display_name, active, updated_at) ON barber TO barberias_app;
    GRANT SELECT, INSERT, DELETE ON barber_service TO barberias_app;
    GRANT SELECT, INSERT, DELETE ON time_off TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE IF EXISTS time_off;
    DROP TABLE IF EXISTS working_hours;
    DROP TABLE IF EXISTS barber_service;
    DROP TABLE IF EXISTS barber;
    DROP TABLE IF EXISTS service;
    DROP TABLE IF EXISTS business_hours;

    REVOKE UPDATE (name, slug, address, phone, description, cancel_min_notice_minutes) ON tenant FROM barberias_app;
    DROP POLICY IF EXISTS tenant_edicion ON tenant;
    DROP POLICY IF EXISTS tenant_alta ON tenant;
    DROP POLICY IF EXISTS tenant_lectura ON tenant;
    ALTER TABLE tenant NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE tenant DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tenant
      DROP COLUMN IF EXISTS cancel_min_notice_minutes,
      DROP COLUMN IF EXISTS timezone,
      DROP COLUMN IF EXISTS description,
      DROP COLUMN IF EXISTS phone,
      DROP COLUMN IF EXISTS address;
  `,
    )
    .execute(db);
}

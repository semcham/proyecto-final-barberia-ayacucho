-- Roles de base de datos de la plataforma (R04, ADR-015).
-- Lo ejecuta el superusuario sobre la base de la aplicación: en Docker Compose, la base "barberias"
-- (POSTGRES_DB) al iniciar el contenedor; en las pruebas, la base temporal que crea test/helpers/test-db.ts.
-- Es idempotente: los roles son globales al clúster y pueden existir de una ejecución anterior.
--
-- Contraseñas: valores SOLO para desarrollo local y pruebas. En cualquier otro entorno se crean
-- con secretos del gestor de secretos, nunca con estos valores.
--
-- POR VALIDAR (ADR-015): que el usuario administrador de Amazon RDS for PostgreSQL pueda crear un
-- rol con BYPASSRLS. Si no se puede, hay que registrar una alternativa en un nuevo ADR antes del
-- despliegue.

DO $$
BEGIN
  -- Dueño de las tablas; ejecuta las migraciones. Está sujeto a RLS por FORCE ROW LEVEL SECURITY.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberias_owner') THEN
    CREATE ROLE barberias_owner LOGIN PASSWORD 'barberias_owner_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  -- Rol con el que se conecta la aplicación: no puede omitir RLS ni es dueño de nada.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberias_app') THEN
    CREATE ROLE barberias_app LOGIN PASSWORD 'barberias_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  -- Dueño exclusivo de las 3 funciones SECURITY DEFINER de autenticación (ADR-015).
  -- NOLOGIN: nadie puede conectarse con este rol.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberias_auth') THEN
    CREATE ROLE barberias_auth NOLOGIN NOSUPERUSER NOINHERIT BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  -- Lecturas públicas por enlace (ADR-021): sin BYPASSRLS, sin propiedad de objetos y solo con SELECT
  -- por columna sobre las columnas públicas (migración 0012). Contraseña SOLO para desarrollo.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberias_publico') THEN
    CREATE ROLE barberias_publico LOGIN PASSWORD 'barberias_publico_dev'
      NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  END IF;

  -- Operaciones de la plataforma (ADR-031, constitución 1.3.1): lecturas entre barberías SIN BYPASSRLS,
  -- solo SELECT por columna (migración 0016), sin ningún INSERT, UPDATE ni DELETE y en transacciones de
  -- solo lectura. Contraseña SOLO para desarrollo.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberias_plataforma') THEN
    CREATE ROLE barberias_plataforma LOGIN PASSWORD 'barberias_plataforma_dev'
      NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- barberias_owner necesita poder asignar la propiedad de las funciones a barberias_auth.
GRANT barberias_auth TO barberias_owner;

-- La base pertenece a barberias_owner: así el esquema public (pg_database_owner) también es suyo.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO barberias_owner', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO barberias_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO barberias_publico', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO barberias_plataforma', current_database());
END
$$;

-- barberias_app, barberias_publico y barberias_plataforma no reciben privilegios por defecto: cada migración concede solo lo necesario.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO barberias_app;
GRANT USAGE ON SCHEMA public TO barberias_publico;
GRANT USAGE ON SCHEMA public TO barberias_plataforma;

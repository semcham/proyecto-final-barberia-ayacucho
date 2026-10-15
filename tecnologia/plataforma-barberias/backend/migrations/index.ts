import type { Migration, MigrationProvider } from 'kysely';
import * as m0001 from './0001_nucleo_identidad';
import * as m0002 from './0002_sesiones_y_activacion';
import * as m0003 from './0003_autenticacion_sin_tenant';
import * as m0004 from './0004_suscripciones';
import * as m0005 from './0005_aceptacion_terminos';
import * as m0006 from './0006_intentos_login';

// Registro explícito de migraciones, en orden. Cada historia agrega aquí las suyas.
// (Un proveedor estático evita depender de importaciones dinámicas de archivos .ts.)
const MIGRACIONES: Record<string, Migration> = {
  '0001_nucleo_identidad': m0001,
  '0002_sesiones_y_activacion': m0002,
  '0003_autenticacion_sin_tenant': m0003,
  '0004_suscripciones': m0004,
  '0005_aceptacion_terminos': m0005,
  '0006_intentos_login': m0006,
};

export class ProveedorDeMigraciones implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRACIONES;
  }
}

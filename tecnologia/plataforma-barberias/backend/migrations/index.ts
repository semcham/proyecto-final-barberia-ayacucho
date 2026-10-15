import type { Migration, MigrationProvider } from 'kysely';
import * as m0001 from './0001_nucleo_identidad';
import * as m0002 from './0002_sesiones_y_activacion';
import * as m0003 from './0003_autenticacion_sin_tenant';

// Registro explícito de migraciones, en orden. Cada historia agrega aquí las suyas.
// (Un proveedor estático evita depender de importaciones dinámicas de archivos .ts.)
const MIGRACIONES: Record<string, Migration> = {
  '0001_nucleo_identidad': m0001,
  '0002_sesiones_y_activacion': m0002,
  '0003_autenticacion_sin_tenant': m0003,
};

export class ProveedorDeMigraciones implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRACIONES;
  }
}

import type { Migration, MigrationProvider } from 'kysely';
import * as m0001 from './0001_nucleo_identidad';
import * as m0002 from './0002_sesiones_y_activacion';
import * as m0003 from './0003_autenticacion_sin_tenant';
import * as m0004 from './0004_suscripciones';
import * as m0005 from './0005_aceptacion_terminos';
import * as m0006 from './0006_intentos_login';
import * as m0007 from './0007_bloqueo_suscripcion';
import * as m0008 from './0008_periodo_gracia_renovacion';
import * as m0009 from './0009_cuenta_cliente';
import * as m0010 from './0010_catalogo';
import * as m0011 from './0011_citas';
import * as m0012 from './0012_lectura_publica';
import * as m0013 from './0013_salud_listo';
import * as m0014 from './0014_planes_y_suscripcion';
import * as m0015 from './0015_pagos';
import * as m0016 from './0016_plataforma';
import * as m0017 from './0017_tareas';

// Registro explícito de migraciones, en orden. Cada historia agrega aquí las suyas.
// (Un proveedor estático evita depender de importaciones dinámicas de archivos .ts.)
const MIGRACIONES: Record<string, Migration> = {
  '0001_nucleo_identidad': m0001,
  '0002_sesiones_y_activacion': m0002,
  '0003_autenticacion_sin_tenant': m0003,
  '0004_suscripciones': m0004,
  '0005_aceptacion_terminos': m0005,
  '0006_intentos_login': m0006,
  '0007_bloqueo_suscripcion': m0007,
  '0008_periodo_gracia_renovacion': m0008,
  '0009_cuenta_cliente': m0009,
  '0010_catalogo': m0010,
  '0011_citas': m0011,
  '0012_lectura_publica': m0012,
  '0013_salud_listo': m0013,
  '0014_planes_y_suscripcion': m0014,
  '0015_pagos': m0015,
  '0016_plataforma': m0016,
  '0017_tareas': m0017,
};

/** Nombre de la última migración que conoce el código (GET /salud/listo, 006). */
export const ULTIMA_MIGRACION = Object.keys(MIGRACIONES).sort().at(-1) as string;

export class ProveedorDeMigraciones implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRACIONES;
  }
}

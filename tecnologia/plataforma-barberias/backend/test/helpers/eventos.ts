import { RelojDelSistema } from '../../src/shared/clock/clock';
import { DespachadorDeEventos, type OpcionesDespachador } from '../../src/shared/eventos/despachador';
import { PendientesDeEventos } from '../../src/shared/eventos/pendientes-plataforma';
import { SalidaDeEventosPostgres } from '../../src/shared/eventos/salida-postgres';
import { LecturaPlataforma } from '../../src/shared/lectura-plataforma';
import { crearBaseDeDatos, type BaseDeDatos } from '../../src/shared/persistence/database';
import { KyselyUnitOfWork } from '../../src/shared/persistence/kysely-unit-of-work';
import { TenantContext } from '../../src/shared/tenant/tenant-context';

/**
 * Una "instancia" del bus de eventos de M06 (ADR-025), con sus propios pools del rol de la aplicación y del
 * de la plataforma, como cada réplica del backend (T013 a T016 de 004).
 */
export interface InstanciaDeEventos {
  db: BaseDeDatos;
  uow: KyselyUnitOfWork;
  bus: SalidaDeEventosPostgres;
  despachador: DespachadorDeEventos;
  cerrar(): Promise<void>;
}

export function crearInstanciaDeEventos(opciones: Partial<OpcionesDespachador> = {}): InstanciaDeEventos {
  const db = crearBaseDeDatos(process.env.TEST_DB_APP_URL as string, 4);
  const lectura = LecturaPlataforma.conectar(process.env.TEST_DB_PLATAFORMA_URL as string, 2);
  const tenantContext = new TenantContext();
  const uow = new KyselyUnitOfWork(db, tenantContext);
  const reloj = new RelojDelSistema();
  const despachador = new DespachadorDeEventos(uow, new PendientesDeEventos(lectura), reloj, opciones);
  const bus = new SalidaDeEventosPostgres(uow, tenantContext, despachador, reloj);
  return {
    db,
    uow,
    bus,
    despachador,
    cerrar: async () => {
      await db.destroy();
      await lectura.cerrar();
    },
  };
}

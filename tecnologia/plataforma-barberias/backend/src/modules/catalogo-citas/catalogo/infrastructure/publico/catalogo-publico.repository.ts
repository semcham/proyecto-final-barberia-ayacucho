import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Configuracion, type Database, HorarioSemanal, type TenantId } from '../../../../../shared';
import { LecturaPublica } from '../../../../../shared/lectura-publica';
import { ESTADOS_ACTIVOS } from '../../../citas/domain/estado-cita';
import {
  type ConsultaDelDia,
  type DatosDelDia,
  FuenteDisponibilidad,
} from '../../application/ports/fuente-disponibilidad';

/** Catálogo público sin los datos de la barbería (esos los da M01, `BarberiasApi.datosPublicos`). */
export interface CatalogoPublicoDatos {
  horario: { tramos: { diaSemana: number; inicio: string; fin: string }[] };
  servicios: {
    id: string;
    nombre: string;
    descripcion: string | null;
    precio: string;
    duracionMinutos: number;
  }[];
  barberos: { id: string; nombre: string; servicioIds: string[] }[];
}

const hhmm = (hora: string) => hora.slice(0, 5);
const minutos = (hora: string) => HorarioSemanal.minutosDe(hora);

/**
 * T070 · Lecturas de la vía pública por enlace (ADR-021). Es la única pieza que usa el pool del rol
 * `barberias_publico` (regla lectura-publica-confinada de PR14):
 *
 * - recibe el tenant que el controlador ya resolvió desde el `slug` con `BarberiasApi.resolverSlugPublico`;
 * - cada lectura corre en `LecturaPublica.ejecutar(tenantId, …)`: transacción de solo lectura con el tenant
 *   fijado, de modo que RLS filtra las filas; además cada consulta filtra por ese tenant;
 * - selecciona SOLO columnas de la lista cerrada de la migración 0012 (pedir otra falla en PostgreSQL) y
 *   devuelve objetos cerrados, sin motivos de bloqueo ni datos de clientes.
 */
@Injectable()
export class CatalogoPublicoRepository implements OnModuleDestroy {
  private readonly lectura: LecturaPublica;

  constructor(configuracion: Configuracion) {
    this.lectura = LecturaPublica.conectar(configuracion.databaseUrlPublico);
  }

  async onModuleDestroy(): Promise<void> {
    await this.lectura.cerrar();
  }

  /** Horario de atención, servicios activos y barberos activos con sus servicios activos. */
  catalogo(tenantId: TenantId): Promise<CatalogoPublicoDatos> {
    const tenant = tenantId.valor;
    return this.lectura.ejecutar(tenantId, async (tx) => {
      const horario = await tx
        .selectFrom('business_hours')
        .select(['weekday', 'start_time', 'end_time'])
        .where('tenant_id', '=', tenant)
        .orderBy('weekday')
        .orderBy('start_time')
        .execute();
      const servicios = await tx
        .selectFrom('service')
        .select(['id', 'name', 'description', 'price', 'duration_min'])
        .where('tenant_id', '=', tenant)
        .where('active', '=', true)
        .orderBy('name')
        .orderBy('id')
        .execute();
      const barberos = await tx
        .selectFrom('barber')
        .select(['id', 'display_name'])
        .where('tenant_id', '=', tenant)
        .where('active', '=', true)
        .orderBy('display_name')
        .orderBy('id')
        .execute();
      const activos = new Set(servicios.map((s) => s.id));
      const asignaciones = await tx
        .selectFrom('barber_service')
        .select(['barber_id', 'service_id'])
        .where('tenant_id', '=', tenant)
        .execute();
      return {
        horario: {
          tramos: horario.map((t) => ({
            diaSemana: t.weekday,
            inicio: hhmm(t.start_time),
            fin: hhmm(t.end_time),
          })),
        },
        servicios: servicios.map((s) => ({
          id: s.id,
          nombre: s.name,
          descripcion: s.description,
          precio: s.price,
          duracionMinutos: s.duration_min,
        })),
        barberos: barberos.map((b) => ({
          id: b.id,
          nombre: b.display_name,
          servicioIds: asignaciones
            .filter((a) => a.barber_id === b.id && activos.has(a.service_id))
            .map((a) => a.service_id),
        })),
      };
    });
  }

  /** Fuente de disponibilidad del cálculo de horarios para la barbería del enlace. */
  fuente(tenantId: TenantId): FuenteDisponibilidad {
    const lectura = this.lectura;
    return new (class extends FuenteDisponibilidad {
      datosDelDia(consulta: ConsultaDelDia): Promise<DatosDelDia> {
        return lectura.ejecutar(tenantId, (tx) => leerDia(tx, tenantId.valor, consulta));
      }
    })();
  }
}

async function leerDia(
  tx: Transaction<Database>,
  tenant: string,
  consulta: ConsultaDelDia,
): Promise<DatosDelDia> {
  const servicio = await tx
    .selectFrom('service')
    .select(['duration_min'])
    .where('tenant_id', '=', tenant)
    .where('id', '=', consulta.servicioId)
    .where('active', '=', true)
    .executeTakeFirst();
  if (!servicio) return { duracionMin: null, atencion: [], barberos: [], ocupacion: [] };

  const dia = consulta.fecha.diaSemana;
  const atencion = await tx
    .selectFrom('business_hours')
    .select(['start_time', 'end_time'])
    .where('tenant_id', '=', tenant)
    .where('weekday', '=', dia)
    .execute();

  // Mismos candidatos que CatalogQuery.barberosQueOfrecen: activos, con el servicio, por nombre.
  let candidatos = tx
    .selectFrom('barber')
    .innerJoin('barber_service', (join) =>
      join
        .onRef('barber_service.tenant_id', '=', 'barber.tenant_id')
        .onRef('barber_service.barber_id', '=', 'barber.id'),
    )
    .select(['barber.id'])
    .where('barber.tenant_id', '=', tenant)
    .where('barber.active', '=', true)
    .where('barber_service.service_id', '=', consulta.servicioId);
  if (consulta.barberoId) candidatos = candidatos.where('barber.id', '=', consulta.barberoId);
  const barberos = await candidatos.orderBy('barber.display_name').orderBy('barber.id').execute();
  const ids = barberos.map((b) => b.id);
  if (ids.length === 0) {
    return { duracionMin: servicio.duration_min, atencion: [], barberos: [], ocupacion: [] };
  }

  const disponibilidad = await tx
    .selectFrom('working_hours')
    .select(['barber_id', 'start_time', 'end_time'])
    .where('tenant_id', '=', tenant)
    .where('weekday', '=', dia)
    .where('barber_id', 'in', ids)
    .execute();
  // Bloqueos sin motivo y citas activas sin cliente: solo barbero, inicio, fin (y estado).
  const bloqueos = await tx
    .selectFrom('time_off')
    .select(['barber_id', 'starts_at', 'ends_at'])
    .where('tenant_id', '=', tenant)
    .where('barber_id', 'in', ids)
    .where('starts_at', '<', consulta.hasta)
    .where('ends_at', '>', consulta.desde)
    .execute();
  const citas = await tx
    .selectFrom('appointment')
    .select(['barber_id', 'starts_at', 'ends_at', 'status'])
    .where('tenant_id', '=', tenant)
    .where('barber_id', 'in', ids)
    .where('status', 'in', [...ESTADOS_ACTIVOS])
    .where('starts_at', '<', consulta.hasta)
    .where('ends_at', '>', consulta.desde)
    .execute();

  return {
    duracionMin: servicio.duration_min,
    atencion: atencion.map((t) => ({ inicioMin: minutos(t.start_time), finMin: minutos(t.end_time) })),
    barberos: ids.map((barberoId) => ({
      barberoId,
      activo: true,
      ofreceServicio: true,
      disponibilidad: disponibilidad
        .filter((d) => d.barber_id === barberoId)
        .map((d) => ({ inicioMin: minutos(d.start_time), finMin: minutos(d.end_time) })),
    })),
    ocupacion: [
      ...bloqueos.map((b) => ({ barberoId: b.barber_id, inicio: b.starts_at, fin: b.ends_at })),
      ...citas.map((c) => ({
        barberoId: c.barber_id,
        inicio: c.starts_at,
        fin: c.ends_at,
        estadoCita: c.status,
      })),
    ],
  };
}

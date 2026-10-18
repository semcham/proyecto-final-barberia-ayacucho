import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { type Actor, BarberiasApi, ClientesApi } from '../../../acceso-barberias';
import { AuditLog, Clock, Configuracion, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { CatalogQuery } from '../../catalogo/application/ports/catalog-query';
import {
  CitaSolapadaDelCliente,
  DatoInvalido,
  HorarioNoDisponible,
  IdempotenciaConflicto,
  NoEncontrado,
  ReservaInvalida,
} from '../../catalogo/domain/errores';
import { Cita } from '../domain/cita';
import type { EstadoCita } from '../domain/estado-cita';
import { CitaRepository, ClaveIdempotenciaEnUso, ConflictoConcurrente } from './ports/cita-repository';

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REINTENTOS_POR_BLOQUEO_MUTUO = 3;

export interface ComandoReservarCita {
  servicioId: string;
  barberoId: string;
  /** ISO 8601 con desplazamiento (la interfaz envía la hora de la barbería, R07). */
  inicio: string;
  /** Solo para el PROPIETARIO (cita presencial, FR-035): el cliente sale de la sesión. */
  clienteId?: string;
}

/** Cita como la devuelve la API (esquema Cita del contrato de 002). */
export interface CitaVista {
  id: string;
  barberia: string;
  servicio: string;
  barbero: string;
  inicio: string;
  fin: string;
  precio: string;
  estado: EstadoCita;
  cancelacionTardia: boolean;
  origen: 'EN_LINEA' | 'PRESENCIAL';
}

export interface ResultadoReserva {
  cita: CitaVista;
  /** false cuando un reintento con la misma Idempotency-Key devuelve la cita ya creada (200). */
  creada: boolean;
}

/**
 * T093 · Reservar una cita sin duplicados (RF12; FR-029 a FR-034; principio IV; research R06, R08, R09).
 *
 * Orden: autorización → cliente de la sesión → idempotencia → reglas (FR-030) con CatalogQuery y la hora
 * local → inserción. Las reglas solo dan mensajes mejores: que no haya dos citas activas del mismo barbero
 * que se solapen lo decide la restricción de exclusión de PostgreSQL, también con varias instancias.
 */
@Injectable()
export class ReservarCita {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly citas: CitaRepository,
    private readonly catalogo: CatalogQuery,
    private readonly clientes: ClientesApi,
    private readonly barberias: BarberiasApi,
    private readonly configuracion: Configuracion,
    private readonly reloj: Clock,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, comando: ComandoReservarCita, clave: string): Promise<ResultadoReserva> {
    await this.autorizacion.exigir(actor, 'RESERVAR_CITA');

    if (!FORMATO_UUID.test(clave)) throw new DatoInvalido('Idempotency-Key', 'formato');
    if (actor.rol === 'CLIENTE' && comando.clienteId !== undefined) {
      throw new DatoInvalido('clienteId', 'no_permitido');
    }
    if (actor.rol === 'PROPIETARIO' && !comando.clienteId) throw new DatoInvalido('clienteId', 'requerido');
    const inicio = new Date(comando.inicio);
    if (Number.isNaN(inicio.getTime())) throw new DatoInvalido('inicio', 'formato');

    const tenant = TenantId.de(actor.tenantId);
    const hashSolicitud = hashDe(comando, inicio);
    try {
      return await this.conReintentos(() =>
        this.uow.ejecutar(tenant, () => this.reservar(actor, comando, inicio, clave, hashSolicitud)),
      );
    } catch (error) {
      // Un reintento simultáneo con la misma clave choca con la cita que otro hilo acaba de confirmar (índice
      // de idempotencia o restricción de exclusión): en una transacción nueva se devuelve esa cita (R09).
      if (
        error instanceof ClaveIdempotenciaEnUso ||
        error instanceof HorarioNoDisponible ||
        error instanceof CitaSolapadaDelCliente
      ) {
        const previa = await this.uow.ejecutar(tenant, () => this.citaPrevia(actor, clave, hashSolicitud));
        if (previa) return previa;
        if (error instanceof ClaveIdempotenciaEnUso) {
          throw new Error('La clave de idempotencia está en uso, pero su cita no es visible');
        }
      }
      throw error;
    }
  }

  private async reservar(
    actor: Actor,
    comando: ComandoReservarCita,
    inicio: Date,
    clave: string,
    hashSolicitud: string,
  ): Promise<ResultadoReserva> {
    const previa = await this.citaPrevia(actor, clave, hashSolicitud);
    if (previa) return previa;

    // 1. El cliente: el de la sesión (CLIENTE) o el elegido por el propietario (cita presencial).
    const cliente =
      actor.rol === 'CLIENTE'
        ? await this.clientes.perfilDeSesion(actor.usuarioId)
        : await this.clientes.perfilDeBarberia(comando.clienteId as string);
    if (!cliente) throw new NoEncontrado();

    // 2. Reglas de FR-030 (mensajes claros; la garantía la da la base).
    const servicio = await this.catalogo.servicioActivo(comando.servicioId);
    if (!servicio) throw new ReservaInvalida('SERVICIO_INACTIVO');
    const barbero = await this.catalogo.barberoOfrece(comando.barberoId, comando.servicioId);
    if (!barbero) throw new ReservaInvalida('BARBERO_NO_OFRECE_SERVICIO');

    const agenda = await this.barberias.configuracionAgenda();
    const zona = new ZonaHoraria(agenda.zonaHoraria);
    const ahora = this.reloj.ahora();
    if (inicio.getTime() <= ahora.getTime()) throw new ReservaInvalida('HORA_PASADA');
    const local = zona.aLocal(inicio);
    if (local.fecha.diasDesde(zona.fechaDe(ahora)) > this.configuracion.horarios.horizonteDias) {
      throw new ReservaInvalida('FUERA_DEL_HORIZONTE');
    }
    // Solo las horas que se ofrecen: múltiplos del paso desde la medianoche local, sin segundos (R08).
    if (local.minutos % this.configuracion.horarios.pasoMinutos !== 0 || inicio.getTime() % 60_000 !== 0) {
      throw new ReservaInvalida('FUERA_DE_DISPONIBILIDAD');
    }
    const finMin = local.minutos + servicio.duracionMin;
    const tramos = await this.catalogo.tramosDelDia(comando.barberoId, local.fecha);
    if (!tramos.some((tramo) => tramo.inicioMin <= local.minutos && finMin <= tramo.finMin)) {
      throw new ReservaInvalida('FUERA_DE_DISPONIBILIDAD');
    }

    const cita = Cita.reservar({
      id: uuidv7(),
      barberoId: comando.barberoId,
      clienteId: cliente.clienteId,
      servicio,
      inicio,
      origen: actor.rol === 'PROPIETARIO' ? 'PRESENCIAL' : 'EN_LINEA',
      creadoPor: actor.usuarioId,
      ahora,
    });
    const bloqueos = await this.catalogo.bloqueosEnRango(
      comando.barberoId,
      cita.rango.inicio,
      cita.rango.fin,
    );
    if (bloqueos.length > 0) throw new ReservaInvalida('EN_BLOQUEO');

    // 3. Inserción: aquí actúan las restricciones de exclusión (principio IV).
    await this.citas.guardar(cita, { clave, hashSolicitud });
    await this.auditoria.registrar({
      accion: 'CITA_RESERVADA',
      actorId: actor.usuarioId,
      recurso: `cita:${cita.id}`,
      resultado: 'PERMITIDO',
    });
    return { cita: aVista(cita, agenda.nombre, barbero.nombre, zona), creada: true };
  }

  /**
   * Reintenta la transacción entera si PostgreSQL la abortó por bloqueo mutuo entre reservas simultáneas
   * (ConflictoConcurrente). Al reintentar, la reserva que ganó ya está confirmada: la nueva inserción choca
   * con ella al instante (409) o, si era el mismo reintento idempotente, la devuelve (200).
   */
  private async conReintentos<T>(operacion: () => Promise<T>): Promise<T> {
    for (let intento = 1; ; intento += 1) {
      try {
        return await operacion();
      } catch (error) {
        if (!(error instanceof ConflictoConcurrente) || intento >= REINTENTOS_POR_BLOQUEO_MUTUO) throw error;
      }
    }
  }

  /** Cita ya reservada con esta clave por el mismo autor: la misma si el contenido coincide (R09). */
  private async citaPrevia(
    actor: Actor,
    clave: string,
    hashSolicitud: string,
  ): Promise<ResultadoReserva | null> {
    const previa = await this.citas.buscarPorIdempotencia(actor.usuarioId, clave);
    if (!previa) return null;
    if (previa.hashSolicitud !== hashSolicitud) throw new IdempotenciaConflicto();
    const agenda = await this.barberias.configuracionAgenda();
    const barbero = await this.catalogo.barbero(previa.cita.barberoId);
    return {
      cita: aVista(previa.cita, agenda.nombre, barbero?.nombre ?? '', new ZonaHoraria(agenda.zonaHoraria)),
      creada: false,
    };
  }
}

/** SHA-256 del contenido normalizado de la reserva (el inicio, en UTC). */
function hashDe(comando: ComandoReservarCita, inicio: Date): string {
  const normalizado = JSON.stringify({
    servicioId: comando.servicioId.toLowerCase(),
    barberoId: comando.barberoId.toLowerCase(),
    inicio: inicio.toISOString(),
    clienteId: comando.clienteId?.toLowerCase() ?? null,
  });
  return createHash('sha256').update(normalizado).digest('hex');
}

/** Cita como la devuelve la API, con los nombres de la barbería y del barbero y la hora local. */
export function aVista(cita: Cita, barberia: string, barbero: string, zona: ZonaHoraria): CitaVista {
  const servicio = cita.servicio;
  return {
    id: cita.id,
    barberia,
    servicio: servicio.nombre,
    barbero,
    inicio: zona.formatoIso(cita.rango.inicio),
    fin: zona.formatoIso(cita.rango.fin),
    precio: servicio.precio,
    estado: cita.estado,
    cancelacionTardia: cita.cancelacionTardia,
    origen: cita.origen,
  };
}

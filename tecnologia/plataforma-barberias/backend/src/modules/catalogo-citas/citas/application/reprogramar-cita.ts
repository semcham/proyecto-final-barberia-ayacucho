import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi, ClientesApi } from '../../../acceso-barberias';
import { SuscripcionesApi } from '../../../suscripciones-pagos';
import { AuditLog, BusDeEventos, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { CatalogQuery } from '../../catalogo/application/ports/catalog-query';
import { DatoInvalido, NoEncontrado } from '../../catalogo/domain/errores';
import { CitaRepository, ConflictoConcurrente } from './ports/cita-repository';
import { ReglasDeHorario } from './reglas-de-horario';
import { aVista, type CitaVista } from './reservar-cita';

const REINTENTOS_POR_BLOQUEO_MUTUO = 3;

export interface ComandoReprogramarCita {
  /** ISO 8601 con desplazamiento (la hora de la barbería, R07 de 002). */
  inicio: string;
  /** Otro barbero que ofrezca el servicio; si falta, el de la cita. */
  barberoId?: string;
}

/** Esquema CitaConConfirmacion de 004: la Cita de 002 con la marca de asistencia del cliente. */
export interface CitaConConfirmacionVista extends CitaVista {
  confirmadaPorClienteEn: string | null;
}

/** Respuesta de POST /citas/{id}/reprogramar (esquema CitaReprogramada de 004). */
export interface ResultadoReprogramarCita {
  cita: CitaConConfirmacionVista;
  cambio: boolean;
  inicioAnterior?: string;
}

/**
 * T050 (004) · Reprogramar una cita con sesión (RF13; FR-001 a FR-007, FR-010, FR-035; research R01 a R03).
 *
 * Orden: autorización (CLIENTE sus citas, PROPIETARIO cualquiera; el barbero no) → política de la suscripción
 * (`RESERVAR`: toma una hora nueva) → la cita (de otro cliente = 404) → regla de antelación (solo el cliente) →
 * reglas de una reserva nueva (ReglasDeHorario) → UPDATE de la misma fila → historial, auditoría y el evento
 * `CitaReprogramada` en la MISMA transacción. Si la hora no está libre, la cita conserva su hora: lo garantizan
 * las restricciones de exclusión de PostgreSQL (principio IV). Sin cambio (misma hora y barbero) no se escribe
 * nada ni se avisa.
 */
@Injectable()
export class ReprogramarCita {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly citas: CitaRepository,
    private readonly catalogo: CatalogQuery,
    private readonly reglas: ReglasDeHorario,
    private readonly clientes: ClientesApi,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly auditoria: AuditLog,
    private readonly eventos: BusDeEventos,
    private readonly suscripciones: SuscripcionesApi,
  ) {}

  async ejecutar(
    actor: Actor,
    citaId: string,
    comando: ComandoReprogramarCita,
  ): Promise<ResultadoReprogramarCita> {
    const alcance = await this.autorizacion.exigir(actor, 'REPROGRAMAR_CITA');
    const inicio = new Date(comando.inicio);
    if (Number.isNaN(inicio.getTime())) throw new DatoInvalido('inicio', 'formato');
    const tenant = TenantId.de(actor.tenantId);

    // Un bloqueo mutuo (40P01) aborta la transacción entera: se reintenta desde la lectura (R03).
    for (let intento = 1; ; intento += 1) {
      try {
        return await this.uow.ejecutar(tenant, () =>
          this.reprogramar(actor, alcance === 'PROPIOS', citaId, comando, inicio),
        );
      } catch (error) {
        if (!(error instanceof ConflictoConcurrente) || intento >= REINTENTOS_POR_BLOQUEO_MUTUO) throw error;
      }
    }
  }

  private async reprogramar(
    actor: Actor,
    soloPropias: boolean,
    citaId: string,
    comando: ComandoReprogramarCita,
    inicio: Date,
  ): Promise<ResultadoReprogramarCita> {
    await this.suscripciones.exigirOperacion(TenantId.de(actor.tenantId), 'RESERVAR');

    const cita = await this.citas.buscarPorId(citaId);
    if (!cita) throw new NoEncontrado();
    if (soloPropias) {
      // La cita de otro cliente es, para él, inexistente (404, sin revelar que existe).
      const perfil = await this.clientes.perfilDeSesion(actor.usuarioId);
      if (!perfil || perfil.clienteId !== cita.clienteId) throw new NoEncontrado();
    }

    const agenda = await this.barberias.configuracionAgenda();
    const ahora = this.reloj.ahora();
    const antes = {
      barberoId: cita.barberoId,
      inicio: cita.rango.inicio,
      estado: cita.estado,
      version: cita.version,
    };
    const { cambio, anterior } = cita.reprogramar(
      { barberoId: comando.barberoId ?? cita.barberoId, inicio },
      { rol: actor.rol === 'CLIENTE' ? 'CLIENTE' : 'PROPIETARIO', usuarioId: actor.usuarioId },
      ahora,
      agenda.antelacionCancelacionMinutos,
    );
    const barberoNuevo = await this.catalogo.barbero(cita.barberoId);
    if (!cambio) return { cita: vista(cita, agenda, barberoNuevo?.nombre ?? ''), cambio: false };

    // Las mismas reglas de una reserva nueva, con la duración copiada en la cita (FR-003, FR-005).
    const servicio = cita.servicio;
    await this.reglas.validar({
      servicioId: servicio.servicioId,
      barberoId: cita.barberoId,
      inicio,
      ahora,
      zonaHoraria: agenda.zonaHoraria,
      duracionMin: servicio.duracionMin,
    });

    await this.citas.reprogramar(cita, antes, { via: 'SESION', usuarioId: actor.usuarioId });
    await this.auditoria.registrar({
      accion: 'CITA_REPROGRAMADA',
      actorId: actor.usuarioId,
      recurso: `cita:${cita.id};SESION;${horaCompacta(anterior.inicio)}>${horaCompacta(cita.rango.inicio)}`,
      resultado: 'PERMITIDO',
    });

    const zona = new ZonaHoraria(agenda.zonaHoraria);
    // contracts/eventos.md §3: solo lo que el mensaje necesita, nunca datos de contacto.
    await this.eventos.publicar({
      tipo: 'CitaReprogramada',
      payload: {
        citaId: cita.id,
        version: cita.version,
        clienteId: cita.clienteId,
        servicio: servicio.nombre,
        barbero: barberoNuevo?.nombre ?? '',
        ...(barberoNuevo?.usuarioId && { barberoUsuarioId: barberoNuevo.usuarioId }),
        inicioAnterior: zona.formatoIso(anterior.inicio),
        inicio: zona.formatoIso(cita.rango.inicio),
        fin: zona.formatoIso(cita.rango.fin),
        zonaHoraria: agenda.zonaHoraria,
        reprogramadaPor: actor.rol === 'CLIENTE' ? 'CLIENTE' : 'PROPIETARIO',
      },
    });

    return {
      cita: vista(cita, agenda, barberoNuevo?.nombre ?? ''),
      cambio: true,
      inicioAnterior: zona.formatoIso(anterior.inicio),
    };
  }
}

function vista(
  cita: Parameters<typeof aVista>[0],
  agenda: Parameters<typeof aVista>[1],
  barbero: string,
): CitaConConfirmacionVista {
  const zona = new ZonaHoraria(agenda.zonaHoraria);
  const confirmada = cita.confirmadaPorClienteEn;
  return {
    ...aVista(cita, agenda, barbero),
    confirmadaPorClienteEn: confirmada ? zona.formatoIso(confirmada) : null,
  };
}

/**
 * Hora en UTC para el recurso de la auditoría: 2026-11-12T15:00:00Z → 20261112T1500Z. Así la cita, la vía y las
 * dos horas caben en los 80 caracteres de `audit_log.resource` (data-model §6: sin cambios de esquema).
 */
function horaCompacta(instante: Date): string {
  return instante
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\d{2}\.\d{3}Z$/, 'Z');
}

import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BarberiasApi } from '../../../acceso-barberias';
import { AuditLog, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import {
  type AccionDeEnlace,
  type DatosDeEnlace,
  EnlacesFirmados,
} from '../../../../shared/enlaces-firmados';
import { CatalogQuery } from '../../catalogo/application/ports/catalog-query';
import { EnlaceNoValido } from '../../catalogo/domain/errores';
import type { Cita } from '../domain/cita';
import { CancelarCita } from './cancelar-cita';
import { LimiteRechazosEnlace } from './limite-rechazos-enlace';
import { CitaRepository, ConflictoConcurrente } from './ports/cita-repository';
import { type ComandoReprogramarCita, ReprogramarCita } from './reprogramar-cita';

const REINTENTOS_POR_BLOQUEO_MUTUO = 3;

/** GET /enlaces/accion (esquema EnlaceAccion): solo los datos mínimos (FR-013, FR-026). */
export interface DatosDelEnlace {
  accion: AccionDeEnlace;
  cita: {
    barberia: string;
    servicio: string;
    barbero: string;
    inicio: string;
    fin: string;
    zonaHoraria: string;
    cancelacionTardiaDesde?: string;
  };
  reprogramacion?: { slug: string; servicioId: string; barberoId: string };
}

/** POST /enlaces/accion/* (esquema ResultadoAccion). */
export interface ResultadoDeAccion {
  accion: AccionDeEnlace;
  cita: {
    estado: string;
    inicio: string;
    cancelacionTardia?: boolean;
    confirmadaPorClienteEn?: string | null;
  };
}

/**
 * T094 de 004 · Acciones por enlace, sin sesión (ADR-032; contracts/enlaces-de-accion.md §3; FR-024 a FR-027,
 * FR-031, FR-035; constitución 1.4.1, principio III, cuarta excepción). Orden estricto:
 *
 * 1. El bloqueo por IP (PoliticaIntentos de M01, sobre la tabla técnica sin barbería).
 * 2. La firma, el formato y el vencimiento con EnlacesFirmados, SIN leer la base de ninguna barbería.
 * 3. Una transacción con el tenant DEL ENLACE (rol de la aplicación, RLS): la cita bloqueada, misma versión, activa
 *    y sin empezar, y la acción de la ruta. GET no consume; POST aplica la acción con el mismo caso de uso que la
 *    vía con sesión (como cliente, sin usuario) e inserta el uso del enlace (SHA-256 del token) en la misma
 *    transacción: un segundo uso, también simultáneo, choca con UNIQUE (link_hash). Si la acción falla, todo se
 *    revierte y el enlace sigue sin usar.
 * 4. Auditoría en la barbería de la cita, con la vía ENLACE y sin el token.
 *
 * Todo rechazo es el mismo `EnlaceNoValido` y se anota en el contador de la IP. Ni el token ni el motivo interno
 * se escriben en ningún registro: solo el código.
 */
@Injectable()
export class AccionPorEnlace {
  private readonly logger = new Logger('AccionPorEnlace');

  constructor(
    private readonly enlaces: EnlacesFirmados,
    private readonly limite: LimiteRechazosEnlace,
    private readonly uow: UnitOfWork,
    private readonly citas: CitaRepository,
    private readonly catalogo: CatalogQuery,
    private readonly barberias: BarberiasApi,
    private readonly cancelar: CancelarCita,
    private readonly reprogramar: ReprogramarCita,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  /** GET: datos mínimos de la cita de un enlace válido. No consume el enlace. */
  async consultar(token: string | undefined, ip: string): Promise<DatosDelEnlace> {
    const { respuesta, tenantId } = await this.conEnlace(token, ip, null, async (cita, datos, linkHash) => {
      if (await this.citas.enlaceUsado(linkHash)) throw new EnlaceNoValido();
      const agenda = await this.barberias.configuracionAgenda();
      const zona = new ZonaHoraria(agenda.zonaHoraria);
      const barbero = await this.catalogo.barbero(cita.barberoId);
      const respuesta: DatosDelEnlace = {
        accion: datos.accion,
        cita: {
          barberia: agenda.nombre,
          servicio: cita.servicio.nombre,
          barbero: barbero?.nombre ?? '',
          inicio: zona.formatoIso(cita.rango.inicio),
          fin: zona.formatoIso(cita.rango.fin),
          zonaHoraria: agenda.zonaHoraria,
        },
      };
      if (datos.accion === 'CANCELAR') {
        respuesta.cita.cancelacionTardiaDesde = zona.formatoIso(
          cita.cancelacionTardiaDesde(agenda.antelacionCancelacionMinutos),
        );
      }
      if (datos.accion === 'REPROGRAMAR') {
        respuesta.reprogramacion = {
          slug: '',
          servicioId: cita.servicio.servicioId,
          barberoId: cita.barberoId,
        };
      }
      return { respuesta, tenantId: datos.tenantId };
    });
    if (respuesta.reprogramacion) {
      // Lo que necesita la pantalla de disponibilidad pública de 002 (R15): el enlace público de la barbería. Se
      // lee FUERA de la transacción del enlace (tenant es una tabla global). Una barbería suspendida no tiene
      // catálogo público: entonces no se ofrece (reprogramar respondería 403 igual).
      const publica = await this.barberias.datosPublicos(TenantId.de(tenantId));
      if (publica) respuesta.reprogramacion.slug = publica.slug;
      else delete respuesta.reprogramacion;
    }
    return respuesta;
  }

  confirmar(token: string | undefined, ip: string): Promise<ResultadoDeAccion> {
    return this.conEnlace(token, ip, 'CONFIRMAR', async (cita, _datos, linkHash) => {
      await this.citas.registrarUsoDeEnlace(cita.id, linkHash, 'CONFIRMAR');
      cita.confirmarAsistencia(this.reloj.ahora());
      await this.citas.confirmarAsistencia(cita);
      await this.auditoria.registrar({
        accion: 'ASISTENCIA_CONFIRMADA_ENLACE',
        actorId: null,
        recurso: `cita:${cita.id}`,
        resultado: 'PERMITIDO',
      });
      const zona = new ZonaHoraria((await this.barberias.configuracionAgenda()).zonaHoraria);
      return {
        accion: 'CONFIRMAR',
        cita: {
          estado: cita.estado,
          inicio: zona.formatoIso(cita.rango.inicio),
          confirmadaPorClienteEn: zona.formatoIso(cita.confirmadaPorClienteEn as Date),
        },
      };
    });
  }

  cancelarCita(token: string | undefined, ip: string): Promise<ResultadoDeAccion> {
    return this.conEnlace(token, ip, 'CANCELAR', async (cita, _datos, linkHash) => {
      await this.citas.registrarUsoDeEnlace(cita.id, linkHash, 'CANCELAR');
      // Las reglas de la cancelación del cliente de 002 (tardía incluida), sin usuario.
      const vista = await this.cancelar.cancelarEnTransaccion(
        cita,
        { rol: 'CLIENTE', usuarioId: null },
        'ENLACE',
      );
      return {
        accion: 'CANCELAR',
        cita: { estado: vista.estado, inicio: vista.inicio, cancelacionTardia: vista.cancelacionTardia },
      };
    });
  }

  reprogramarCita(
    token: string | undefined,
    ip: string,
    comando: ComandoReprogramarCita,
  ): Promise<ResultadoDeAccion> {
    return this.conEnlace(token, ip, 'REPROGRAMAR', async (cita, _datos, linkHash) => {
      await this.citas.registrarUsoDeEnlace(cita.id, linkHash, 'REPROGRAMAR');
      // Las reglas de la reprogramación del cliente (US1), sin usuario. Si falla (409, 422, 403), la transacción
      // se revierte entera y el enlace sigue sin usar.
      const { cita: vista } = await this.reprogramar.reprogramarEnTransaccion(
        cita,
        { rol: 'CLIENTE', usuarioId: null },
        comando,
        'ENLACE',
      );
      return {
        accion: 'REPROGRAMAR',
        cita: {
          estado: vista.estado,
          inicio: vista.inicio,
          confirmadaPorClienteEn: vista.confirmadaPorClienteEn,
        },
      };
    });
  }

  /**
   * Pasos 1 a 3 del contrato. `accionDeLaRuta` null para el GET (vale cualquier acción). `fn` corre en la
   * transacción con el tenant del enlace, con la cita bloqueada y ya validada.
   */
  private async conEnlace<T>(
    token: string | undefined,
    ip: string,
    accionDeLaRuta: AccionDeEnlace | null,
    fn: (cita: Cita, datos: DatosDeEnlace, linkHash: string) => Promise<T>,
  ): Promise<T> {
    await this.limite.exigirSinBloqueo(ip);

    const verificacion = typeof token === 'string' ? this.enlaces.verificar(token) : null;
    if (!verificacion?.valido) return this.rechazar(ip, verificacion?.motivo ?? 'AUSENTE');
    const { datos } = verificacion;
    const linkHash = createHash('sha256')
      .update(token as string)
      .digest('hex');

    try {
      return await this.conReintentos(() =>
        this.uow.ejecutar(TenantId.de(datos.tenantId), async () => {
          // Bloqueada hasta el fin de la transacción: dos acciones a la vez sobre la misma cita se atienden de a una.
          const cita = await this.citas.buscarParaActualizar(datos.recursoId);
          if (!cita || !cita.aceptaEnlace(datos, accionDeLaRuta ?? datos.accion, this.reloj.ahora())) {
            throw new EnlaceNoValido();
          }
          return fn(cita, datos, linkHash);
        }),
      );
    } catch (error) {
      if (error instanceof EnlaceNoValido) return this.rechazar(ip, 'CITA');
      throw error;
    }
  }

  /** Anota el rechazo en el contador de la IP y responde ENLACE_NO_VALIDO. Solo el código, nunca el token. */
  private async rechazar(ip: string, motivo: string): Promise<never> {
    await this.limite.registrarRechazo(ip);
    this.logger.log(`ENLACE_NO_VALIDO motivo=${motivo}`);
    throw new EnlaceNoValido();
  }

  /** Un bloqueo mutuo (40P01) aborta la transacción entera: se reintenta desde el principio (R03). */
  private async conReintentos<T>(operacion: () => Promise<T>): Promise<T> {
    for (let intento = 1; ; intento += 1) {
      try {
        return await operacion();
      } catch (error) {
        if (!(error instanceof ConflictoConcurrente) || intento >= REINTENTOS_POR_BLOQUEO_MUTUO) throw error;
      }
    }
  }
}

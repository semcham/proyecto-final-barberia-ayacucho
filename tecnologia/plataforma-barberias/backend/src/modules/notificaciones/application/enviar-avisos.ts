import { Injectable, Logger } from '@nestjs/common';
import { BarberiasApi, ClientesApi, PersonalApi } from '../../acceso-barberias';
import { Clock, procesarCadaUno, type ResultadoDeTarea, TenantId, UnitOfWork } from '../../../shared';
import type { CodigoErrorAviso, Destinatario } from '../domain/aviso';
import { type ContactoDelDestinatario, elegirCanal } from '../domain/eleccion-canal';
import { componerAviso, datosDelEvento } from '../domain/plantillas';
import { type Fallo, trasFallo } from '../domain/politica-reintentos';
import { type AvisoReclamado, AvisoRepository, PendientesDeAvisos } from './ports/aviso-repository';
import {
  CanalNoDisponible,
  DestinatarioInvalido,
  type MensajeSaliente,
  NotificationChannel,
} from './ports/notification-channel';

/** Avisos que toma cada corrida. */
const LOTE = 100;
/** Plazo del reclamo (R13): si la réplica cae antes de anotar el resultado, otra lo retoma al vencer. */
export const PLAZO_RECLAMO_MS = 2 * 60 * 1000;
/** Retención de los avisos en estado final (R17: 90 días). */
export const RETENCION_DIAS = 90;
const LOTE_DE_PURGA = 200;
const BARBERIAS_POR_PURGA = 100;
const DIA_MS = 24 * 60 * 60 * 1000;

type Preparado =
  | { tipo: 'nada' }
  | { tipo: 'cerrado' }
  | { tipo: 'enviar'; aviso: AvisoReclamado; mensaje: MensajeSaliente };

/**
 * T073 de 004 · Tarea `enviar-avisos` (ADR-025 pasos 4 a 6; FR-011, FR-012, FR-032, FR-033; research R13, R17).
 *
 * 1. Lista los avisos por enviar de todas las barberías con el rol de la plataforma (solo columnas técnicas).
 * 2. Por cada uno, en una transacción con SU tenant y el rol de la aplicación: lo reclama (SKIP LOCKED, plazo de
 *    2 min), lee el contacto del destinatario en M01 en ese momento, elige el canal y compone el mensaje.
 * 3. Envía FUERA de la transacción, por el puerto NotificationChannel (tiempo límite y circuito del adaptador),
 *    con el id del aviso como clave de idempotencia.
 * 4. Anota el resultado en otra transacción: ENVIADO, otro intento más tarde, FALLIDO o DESCARTADO.
 * 5. Purga los avisos en estado final de más de 90 días (no toca outbox_event: eso es de despachar-eventos).
 *
 * Un fallo de envío nunca toca la cita ni la operación que originó el aviso.
 */
@Injectable()
export class EnviarAvisos {
  private readonly logger = new Logger('EnviarAvisos');

  constructor(
    private readonly uow: UnitOfWork,
    private readonly avisos: AvisoRepository,
    private readonly pendientes: PendientesDeAvisos,
    private readonly canal: NotificationChannel,
    private readonly clientes: ClientesApi,
    private readonly personal: PersonalApi,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(): Promise<ResultadoDeTarea> {
    const lista = await this.pendientes.listar(this.reloj.ahora(), LOTE);
    const resultado = await procesarCadaUno(lista, ({ id, tenantId }) =>
      this.procesar(TenantId.de(tenantId), id),
    );
    await this.purgar();
    return resultado;
  }

  /** Retención (R17): finales de más de 90 días, barbería por barbería, con su tenant y RLS. */
  async purgar(): Promise<number> {
    const limite = new Date(this.reloj.ahora().getTime() - RETENCION_DIAS * DIA_MS);
    let borrados = 0;
    for (const tenant of await this.pendientes.barberiasConFinales(BARBERIAS_POR_PURGA)) {
      borrados += await this.uow
        .ejecutar(TenantId.de(tenant), () => this.avisos.purgar(limite, LOTE_DE_PURGA))
        .catch(() => 0);
    }
    return borrados;
  }

  /** false si no había nada que hacer (otra réplica lo tiene o ya no toca). */
  private async procesar(tenant: TenantId, id: string): Promise<boolean> {
    const preparado = await this.uow.ejecutar(tenant, () => this.preparar(id));
    if (preparado.tipo === 'nada') return false;
    if (preparado.tipo === 'cerrado') return true;

    const { aviso, mensaje } = preparado;
    let fallo: { fallo: Fallo; error: CodigoErrorAviso } | null = null;
    try {
      await this.canal.enviar(mensaje);
    } catch (error) {
      fallo = clasificar(error);
      if (!(error instanceof CanalNoDisponible) && !(error instanceof DestinatarioInvalido)) {
        // Un error inesperado del adaptador: solo el tipo, nunca el destino ni el texto.
        this.logger.error(
          `AVISO_ERROR_INESPERADO id=${aviso.id} tipo=${error instanceof Error ? error.name : 'Error'}`,
        );
      }
    }

    await this.uow.ejecutar(tenant, async () => {
      const ahora = this.reloj.ahora();
      if (!fallo) {
        await this.avisos.marcarEnviado(aviso.id, this.canal.canal, ahora);
        return;
      }
      const decision = trasFallo({
        intentos: aviso.intentos,
        fallo: fallo.fallo,
        ahora,
        descartarDespues: aviso.descartarDespues,
      });
      if (decision.estado === 'PENDIENTE') {
        await this.avisos.reintentar(aviso.id, decision.intentos, decision.proximoIntento, fallo.error);
      } else {
        await this.avisos.finalizar(aviso.id, 'FALLIDO', decision.intentos, fallo.error);
      }
    });
    return true;
  }

  /** Reclama, resuelve el destino y compone, en la transacción con el tenant del aviso. */
  private async preparar(id: string): Promise<Preparado> {
    const ahora = this.reloj.ahora();
    const aviso = await this.avisos.reclamar(id, ahora, PLAZO_RECLAMO_MS);
    if (!aviso) return { tipo: 'nada' };
    // FR-033: un aviso de cita sin enviar a las 24 h queda FALLIDO (conserva el último error).
    if (ahora.getTime() >= aviso.descartarDespues.getTime()) {
      await this.avisos.finalizar(aviso.id, 'FALLIDO', aviso.intentos);
      return { tipo: 'cerrado' };
    }
    // Sin el evento de origen no hay contenido que enviar.
    if (!aviso.evento) {
      await this.avisos.finalizar(aviso.id, 'DESCARTADO', aviso.intentos, null);
      return { tipo: 'cerrado' };
    }

    const elegido = elegirCanal(await this.contactoDe(aviso.destinatario));
    if ('descartar' in elegido) {
      // FR-015: el cliente presencial sin correo no recibe nada.
      await this.avisos.finalizar(aviso.id, 'DESCARTADO', aviso.intentos, elegido.descartar);
      return { tipo: 'cerrado' };
    }
    const datos = datosDelEvento(aviso.evento.payload, await this.barberias.nombre());
    const { asunto, texto } = componerAviso(aviso.tipo, aviso.destinatario.tipo, datos);
    return {
      tipo: 'enviar',
      aviso,
      mensaje: { destino: elegido.destino, asunto, texto, claveIdempotencia: aviso.id },
    };
  }

  /** El contacto se lee de M01 AL ENVIAR (R12): un cambio de correo intermedio se respeta. */
  private async contactoDe(destinatario: Destinatario): Promise<ContactoDelDestinatario | null> {
    switch (destinatario.tipo) {
      case 'CLIENTE':
        return this.clientes.contactoParaAvisos(destinatario.ref);
      case 'PROPIETARIO':
        return { correo: await this.barberias.correoDelPropietario(), canal: 'CORREO' };
      case 'BARBERO':
        return { correo: await this.personal.correoDe(destinatario.ref), canal: 'CORREO' };
    }
  }
}

function clasificar(error: unknown): { fallo: Fallo; error: CodigoErrorAviso } {
  if (error instanceof DestinatarioInvalido) return { fallo: 'PERMANENTE', error: 'DESTINATARIO_INVALIDO' };
  if (error instanceof CanalNoDisponible) {
    if (error.motivo === 'CIRCUITO_ABIERTO')
      return { fallo: 'CIRCUITO_ABIERTO', error: 'CANAL_NO_DISPONIBLE' };
    if (error.motivo === 'TIEMPO_AGOTADO') return { fallo: 'TEMPORAL', error: 'TIEMPO_AGOTADO' };
  }
  return { fallo: 'TEMPORAL', error: 'CANAL_NO_DISPONIBLE' };
}

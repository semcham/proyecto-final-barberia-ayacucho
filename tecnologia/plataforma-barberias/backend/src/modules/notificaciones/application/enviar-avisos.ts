import { Injectable, Logger } from '@nestjs/common';
import { BarberiasApi, ClientesApi, PersonalApi } from '../../acceso-barberias';
import {
  Clock,
  Configuracion,
  procesarCadaUno,
  type ResultadoDeTarea,
  TenantContext,
  TenantId,
  UnitOfWork,
} from '../../../shared';
import { EnlacesFirmados } from '../../../shared/enlaces-firmados';
import { type CodigoErrorAviso, type Destinatario, TIPOS_DE_AVISO_DE_SUSCRIPCION } from '../domain/aviso';
import {
  type CanalElegido,
  type ContactoDelDestinatario,
  debeRespaldar,
  elegirCanal,
  INTENTOS_WHATSAPP,
} from '../domain/eleccion-canal';
import {
  componerAviso,
  componerAvisoDeSuscripcion,
  datosDelEvento,
  datosDeSuscripcion,
  type EnlacesDelRecordatorio,
  type MensajeCompuesto,
} from '../domain/plantillas';
import { type Fallo, INTENTOS_MAXIMOS, trasFallo } from '../domain/politica-reintentos';
import { type AvisoReclamado, AvisoRepository, PendientesDeAvisos } from './ports/aviso-repository';
import {
  CanalesDeAviso,
  CanalNoDisponible,
  DestinatarioInvalido,
  type MensajeSaliente,
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
  | {
      tipo: 'enviar';
      aviso: AvisoReclamado;
      elegido: Exclude<CanalElegido, { descartar: 'SIN_CANAL' }>;
      contacto: ContactoDelDestinatario | null;
      /** El mensaje sin el destino: el destino depende del canal (WhatsApp o el correo de respaldo). */
      mensaje: Omit<MensajeSaliente, 'destino'>;
    };

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
    private readonly canales: CanalesDeAviso,
    private readonly clientes: ClientesApi,
    private readonly personal: PersonalApi,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly enlaces: EnlacesFirmados,
    private readonly tenantContext: TenantContext,
    configuracion: Configuracion,
  ) {
    this.urlPublica = configuracion.urlPublica.replace(/\/+$/, '');
  }

  private readonly urlPublica: string;

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

    const { aviso, elegido, contacto } = preparado;
    let intentos = aviso.intentos;
    let respaldo = 'respaldo' in elegido && elegido.respaldo === true;
    let canal: 'CORREO' | 'WHATSAPP' = elegido.canal;
    let fallo = await this.enviarPor(canal, { ...preparado.mensaje, destino: elegido.destino }, aviso.id);

    // FR-020 (R12, R13): si WhatsApp falla tras sus intentos, con su circuito abierto o con el número rechazado, el
    // MISMO aviso sale por correo, una sola vez, ahora.
    if (fallo && canal === 'WHATSAPP') {
      if (fallo.fallo !== 'CIRCUITO_ABIERTO') intentos += 1;
      if (debeRespaldar(intentos, fallo.fallo)) {
        const alCorreo = elegirCanal(contacto, { respaldo: true });
        if ('descartar' in alCorreo) {
          await this.uow.ejecutar(tenant, () =>
            this.avisos.finalizar(aviso.id, 'FALLIDO', intentos, fallo?.error ?? null),
          );
          return true;
        }
        // Desde ahora, los reintentos del aviso van por el correo (INTENTOS_WHATSAPP ya cumplidos).
        intentos = Math.max(intentos, INTENTOS_WHATSAPP);
        respaldo = true;
        canal = 'CORREO';
        fallo = await this.enviarPor('CORREO', { ...preparado.mensaje, destino: alCorreo.destino }, aviso.id);
      } else {
        // Un fallo temporal de WhatsApp: se reintenta por WhatsApp más tarde (el intento ya se contó).
        intentos -= 1;
      }
    }

    await this.uow.ejecutar(tenant, async () => {
      const ahora = this.reloj.ahora();
      if (!fallo) {
        await this.avisos.marcarEnviado(aviso.id, canal, ahora, { respaldo, intentos });
        return;
      }
      const decision = trasFallo({
        intentos,
        fallo: fallo.fallo,
        ahora,
        descartarDespues: aviso.descartarDespues,
      });
      if (decision.estado === 'PENDIENTE') {
        await this.avisos.reintentar(aviso.id, decision.intentos, decision.proximoIntento, fallo.error);
        return;
      }
      // FR-033: un recordatorio que ya no llegará antes de la hora de inicio se DESCARTA (no es un fallo del
      // canal: la cita empezó). Sin intentos o con un error permanente, sí es FALLIDO.
      const porPlazo = fallo.fallo !== 'PERMANENTE' && decision.intentos < INTENTOS_MAXIMOS;
      const estado = aviso.tipo === 'RECORDATORIO' && porPlazo ? 'DESCARTADO' : 'FALLIDO';
      await this.avisos.finalizar(aviso.id, estado, decision.intentos, fallo.error);
    });
    return true;
  }

  /** Envía por el canal y devuelve el fallo clasificado, o null si el canal lo aceptó. */
  private async enviarPor(
    canal: 'CORREO' | 'WHATSAPP',
    mensaje: MensajeSaliente,
    avisoId: string,
  ): Promise<{ fallo: Fallo; error: CodigoErrorAviso } | null> {
    try {
      await (canal === 'WHATSAPP' ? this.canales.whatsapp : this.canales.correo).enviar(mensaje);
      return null;
    } catch (error) {
      if (!(error instanceof CanalNoDisponible) && !(error instanceof DestinatarioInvalido)) {
        // Un error inesperado del adaptador: solo el tipo, nunca el destino ni el texto.
        this.logger.error(
          `AVISO_ERROR_INESPERADO id=${avisoId} tipo=${error instanceof Error ? error.name : 'Error'}`,
        );
      }
      return clasificar(error);
    }
  }

  /** Reclama, resuelve el destino y compone, en la transacción con el tenant del aviso. */
  private async preparar(id: string): Promise<Preparado> {
    const ahora = this.reloj.ahora();
    const aviso = await this.avisos.reclamar(id, ahora, PLAZO_RECLAMO_MS);
    if (!aviso) return { tipo: 'nada' };
    // FR-033: un aviso de cita sin enviar a las 24 h queda FALLIDO (conserva el último error); un recordatorio sin
    // enviar a la hora de inicio de la cita se DESCARTA.
    if (ahora.getTime() >= aviso.descartarDespues.getTime()) {
      await this.avisos.finalizar(
        aviso.id,
        aviso.tipo === 'RECORDATORIO' ? 'DESCARTADO' : 'FALLIDO',
        aviso.intentos,
      );
      return { tipo: 'cerrado' };
    }
    // Sin el evento de origen no hay contenido que enviar.
    if (!aviso.evento) {
      await this.avisos.finalizar(aviso.id, 'DESCARTADO', aviso.intentos, null);
      return { tipo: 'cerrado' };
    }

    // El canal, el número y el consentimiento se leen AHORA (R12): un retiro intermedio se respeta (FR-019). Tras 3
    // intentos de WhatsApp, el aviso sigue por el correo de respaldo.
    const contacto = await this.contactoDe(aviso.destinatario);
    const elegido = elegirCanal(contacto, { respaldo: aviso.intentos >= INTENTOS_WHATSAPP });
    if ('descartar' in elegido) {
      // FR-015: el cliente presencial sin correo no recibe nada.
      await this.avisos.finalizar(aviso.id, 'DESCARTADO', aviso.intentos, elegido.descartar);
      return { tipo: 'cerrado' };
    }
    const { asunto, texto } = await this.componer(aviso, aviso.evento.payload);
    return {
      tipo: 'enviar',
      aviso,
      elegido,
      contacto,
      mensaje: { asunto, texto, claveIdempotencia: aviso.id },
    };
  }

  /**
   * El texto del aviso, con datos de una lista cerrada. Los de suscripción (fase 6, US5) llevan las fechas en la zona
   * de la barbería, leída de M01 al enviar, como el nombre.
   */
  private async componer(aviso: AvisoReclamado, payload: Record<string, unknown>): Promise<MensajeCompuesto> {
    if (TIPOS_DE_AVISO_DE_SUSCRIPCION.includes(aviso.tipo)) {
      const { nombre, zonaHoraria } = await this.barberias.configuracionAgenda();
      return componerAvisoDeSuscripcion(aviso.tipo, datosDeSuscripcion(payload, nombre, zonaHoraria));
    }
    const datos = datosDelEvento(payload, await this.barberias.nombre());
    const enlaces = aviso.tipo === 'RECORDATORIO' ? this.enlacesDelRecordatorio(aviso) : undefined;
    return componerAviso(aviso.tipo, aviso.destinatario.tipo, datos, enlaces);
  }

  /**
   * T096 (fase 4; ADR-032, contracts/enlaces-de-accion.md §2): los tres enlaces de un solo uso del recordatorio, con
   * la barbería del aviso, la cita y la versión del evento, y que vencen a la hora de inicio. No se guarda nada: van
   * en el FRAGMENTO de la dirección (URL_PUBLICA/e#<token>), que el navegador no envía al servidor.
   */
  private enlacesDelRecordatorio(aviso: AvisoReclamado): EnlacesDelRecordatorio {
    const payload = aviso.evento?.payload ?? {};
    const datos = {
      tenantId: this.tenantContext.actual().valor,
      recursoId: aviso.citaId as string,
      version: Number(payload.version),
      venceEn: new Date(String(payload.inicio)),
    };
    const url = (accion: 'CONFIRMAR' | 'REPROGRAMAR' | 'CANCELAR') =>
      `${this.urlPublica}/e#${this.enlaces.emitir({ ...datos, accion })}`;
    return { confirmar: url('CONFIRMAR'), reprogramar: url('REPROGRAMAR'), cancelar: url('CANCELAR') };
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

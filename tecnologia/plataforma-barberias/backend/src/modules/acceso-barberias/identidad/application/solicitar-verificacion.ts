import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, Configuracion, TenantContext, TenantId, UnitOfWork } from '../../../../shared';
import { DemasiadosIntentos } from '../domain/errores';
import { evaluarLimiteDeEnlace, VENTANA_LIMITE_ENLACES_MS } from '../domain/limite-enlaces';
import type { Actor } from './autorizacion';
import { EstadoDeCuentas, IntentosEnlaceDeCuentaRepository } from './ports/enlace-de-cuenta-repository';
import { SolicitarEnlaceDeCuenta } from './solicitar-enlace-de-cuenta';
import { conTiempoMinimo } from './tiempo-minimo';
import { hashDeToken } from './tokens-opacos';

const IP_DESCONOCIDA = '0.0.0.0';

/** Respuesta neutra del reenvío: la misma esté o no verificada la cuenta (research R07). */
export const MENSAJE_REENVIO = 'Si tu correo aún no está verificado, te enviamos un enlace nuevo.';

/**
 * T056 de 010 · Pedir el correo de verificación (US1; FR-008, FR-012, FR-013; research R03, R07, R08 y R15).
 *
 * - `alRegistrarse`: el registro del cliente lo llama en SU transacción y con la barbería donde se registra (T057): el
 *   enlace y el evento existen solo si el registro se confirma. Sin límites propios (el registro ya tiene el suyo).
 * - `reenviar`: el cliente con sesión, en la barbería de su sesión. Hace el mismo trabajo esté o no verificada la cuenta
 *   (contar y registrar el intento, leer el estado) y responde lo mismo, con un piso de tiempo. Solo el cliente se
 *   verifica en 010 (spec, supuestos): para el personal, el reenvío responde igual y no envía nada.
 */
@Injectable()
export class SolicitarVerificacion {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly intentos: IntentosEnlaceDeCuentaRepository,
    private readonly cuentas: EstadoDeCuentas,
    private readonly solicitarEnlace: SolicitarEnlaceDeCuenta,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
    private readonly tenantContext: TenantContext,
    private readonly configuracion: Configuracion,
  ) {}

  /** En la transacción del registro (con su barbería): anula el anterior, crea el enlace y publica el evento. */
  async alRegistrarse(usuarioId: string): Promise<void> {
    await this.solicitarEnlace.ejecutar(usuarioId, 'VERIFICAR_CORREO');
    await this.auditoria.registrar({
      accion: 'CORREO_VERIFICACION_SOLICITADA',
      actorId: usuarioId,
      recurso: `cuenta:${usuarioId}`,
      resultado: 'PERMITIDO',
    });
  }

  /** POST /cuenta/verificacion/reenvio. Lanza DemasiadosIntentos (429) por encima de los límites de R08. */
  async reenviar(actor: Actor): Promise<{ mensaje: string }> {
    return conTiempoMinimo(this.configuracion.cuentas.respuestaMinimaMs, async () => {
      const ip = this.tenantContext.datosSolicitud().ip ?? IP_DESCONOCIDA;
      // El sujeto es el SHA-256 del id de la cuenta (data-model §3): nunca el correo en claro.
      const sujeto = hashDeToken(actor.usuarioId);

      // 1. Límites (tabla técnica sin barbería). Solo se registran los intentos permitidos.
      await this.uow.ejecutarSinTenant(async () => {
        const ahora = this.reloj.ahora();
        const recientes = await this.intentos.recientes(
          'REENVIO',
          sujeto,
          ip,
          new Date(ahora.getTime() - VENTANA_LIMITE_ENLACES_MS),
        );
        const decision = evaluarLimiteDeEnlace('REENVIO', recientes, ahora);
        if (!decision.permitido) throw new DemasiadosIntentos(decision.reintentarEnSegundos);
        await this.intentos.registrar('REENVIO', sujeto, ip, ahora);
      });

      // 2. En la barbería de la sesión: el aviso sale de ella (R03).
      await this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
        const estado = await this.cuentas.correoYVerificacion(actor.usuarioId);
        if (!estado || estado.verificado || actor.rol !== 'CLIENTE') return;
        await this.alRegistrarse(actor.usuarioId);
      });
      return { mensaje: MENSAJE_REENVIO };
    });
  }
}

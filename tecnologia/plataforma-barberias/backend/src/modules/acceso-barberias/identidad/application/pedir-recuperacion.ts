import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, Configuracion, TenantContext, TenantId, UnitOfWork } from '../../../../shared';
import { BarberiasApi } from '../../api-publica';
import { BarberiaNoDisponible } from '../../barberias/domain/errores';
import { DemasiadosIntentos } from '../domain/errores';
import { evaluarLimiteDeEnlace, VENTANA_LIMITE_ENLACES_MS } from '../domain/limite-enlaces';
import { FuncionesDeCuenta, IntentosEnlaceDeCuentaRepository } from './ports/enlace-de-cuenta-repository';
import { UsuarioRepository } from './ports/usuario-repository';
import { SolicitarEnlaceDeCuenta } from './solicitar-enlace-de-cuenta';
import { conTiempoMinimo } from './tiempo-minimo';
import { hashDeToken } from './tokens-opacos';

const IP_DESCONOCIDA = '0.0.0.0';

/** Respuesta neutra: la misma exista o no la cuenta (contracts/openapi.yaml de 010, research R07). */
export const MENSAJE_RECUPERACION = 'Si hay una cuenta con ese correo, te enviamos un enlace.';

/**
 * T076 de 010 · Pedir la recuperación de la contraseña, sin sesión (US2; FR-018 a FR-020; research R03, R07, R08 y R15).
 *
 * Hace el mismo trabajo exista o no la cuenta: contar y registrar el intento (por el SHA-256 del correo normalizado y
 * por el origen), resolver la cuenta con la función de sistema existente y responder lo mismo, con un piso de tiempo.
 * Solo si la cuenta existe y tiene contraseña (el personal PENDIENTE no la tiene: su camino es la activación) elige la
 * barbería del aviso con `auth_barberia_para_enlace` y, en ella, anula el enlace anterior, crea el nuevo (1 h) y
 * publica el evento. Una solicitud con un correo sin cuenta no se audita (no hay barbería).
 */
@Injectable()
export class PedirRecuperacion {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly intentos: IntentosEnlaceDeCuentaRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly funciones: FuncionesDeCuenta,
    private readonly barberias: BarberiasApi,
    private readonly solicitarEnlace: SolicitarEnlaceDeCuenta,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
    private readonly tenantContext: TenantContext,
    private readonly configuracion: Configuracion,
  ) {}

  /** `slug`: la barbería desde cuyo ingreso se pide (solo elige la del aviso, y solo si la cuenta es de ella). */
  async ejecutar(correoIngresado: string, slug?: string): Promise<{ mensaje: string }> {
    return conTiempoMinimo(this.configuracion.cuentas.respuestaMinimaMs, async () => {
      // Misma normalización que el ingreso, sin rechazar formatos: un correo mal escrito es solo uno sin cuenta.
      const correo = correoIngresado.trim().toLowerCase();
      const sujeto = hashDeToken(correo);
      const ip = this.tenantContext.datosSolicitud().ip ?? IP_DESCONOCIDA;
      const preferida = slug ? await this.tenantDelSlug(slug) : null;

      const destino = await this.uow.ejecutarSinTenant(async () => {
        const ahora = this.reloj.ahora();
        const recientes = await this.intentos.recientes(
          'RECUPERACION',
          sujeto,
          ip,
          new Date(ahora.getTime() - VENTANA_LIMITE_ENLACES_MS),
        );
        const decision = evaluarLimiteDeEnlace('RECUPERACION', recientes, ahora);
        if (!decision.permitido) throw new DemasiadosIntentos(decision.reintentarEnSegundos);
        await this.intentos.registrar('RECUPERACION', sujeto, ip, ahora);

        const cuenta = await this.usuarios.resolverCuenta(correo);
        if (!cuenta?.hashContrasena) return null;
        const tenantId = await this.funciones.barberiaParaEnlace(cuenta.usuarioId, preferida);
        return tenantId ? { usuarioId: cuenta.usuarioId, tenantId } : null;
      });

      if (destino) {
        await this.uow.ejecutar(TenantId.de(destino.tenantId), async () => {
          await this.solicitarEnlace.ejecutar(destino.usuarioId, 'RECUPERAR_CONTRASENA');
          await this.auditoria.registrar({
            accion: 'RECUPERACION_SOLICITADA',
            actorId: destino.usuarioId,
            recurso: `cuenta:${destino.usuarioId}`,
            resultado: 'PERMITIDO',
          });
        });
      }
      return { mensaje: MENSAJE_RECUPERACION };
    });
  }

  /** Un enlace de barbería inexistente o suspendida no cambia nada: se elige como si no se hubiera indicado. */
  private async tenantDelSlug(slug: string): Promise<string | null> {
    try {
      return (await this.barberias.resolverSlugPublico(slug)).valor;
    } catch (error) {
      if (error instanceof BarberiaNoDisponible) return null;
      throw error;
    }
  }
}

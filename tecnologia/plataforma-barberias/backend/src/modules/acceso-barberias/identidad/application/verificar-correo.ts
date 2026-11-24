import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, Configuracion, TenantContext, TenantId, UnitOfWork } from '../../../../shared';
import { TenantRepository } from '../../barberias/application/ports/tenant-repository';
import { DemasiadosIntentos, EnlaceNoValido } from '../domain/errores';
import { evaluarLimiteDeEnlace, VENTANA_LIMITE_ENLACES_MS } from '../domain/limite-enlaces';
import { FuncionesDeCuenta, IntentosEnlaceDeCuentaRepository } from './ports/enlace-de-cuenta-repository';
import { conTiempoMinimo } from './tiempo-minimo';
import { hashDeToken } from './tokens-opacos';

const IP_DESCONOCIDA = '0.0.0.0';
/** Forma de los tokens que emite `generarTokenOpaco` (base64url); otra forma es un enlace mal formado. */
const FORMA_DEL_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

type Resultado = { verificado: true; barberia: string } | { verificado: false };

/**
 * T056 de 010 · Verificar el correo con el enlace, sin sesión (US1; FR-002 a FR-007, FR-009; research R04, R07, R08 y
 * R15). La función de sistema `auth_verificar_correo` valida y consume el enlace en una sola sentencia y verifica la
 * cuenta, para todas sus barberías.
 *
 * Hacia fuera: un enlace usado, vencido, anulado, desconocido o mal formado responde el MISMO 410, con un piso de tiempo.
 * Por dentro (R15): el que pertenece a una cuenta (APLICADO o RECHAZADO) se audita en la barbería del enlace; el
 * desconocido o mal formado no tiene cuenta ni barbería y queda solo como USO_FALLIDO por origen, que alimenta el límite
 * (20 por hora: el siguiente recibe 429).
 */
@Injectable()
export class VerificarCorreo {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly funciones: FuncionesDeCuenta,
    private readonly intentos: IntentosEnlaceDeCuentaRepository,
    private readonly barberias: TenantRepository,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
    private readonly tenantContext: TenantContext,
    private readonly configuracion: Configuracion,
  ) {}

  /** Devuelve el `slug` de la barbería de origen del enlace, para volver a ella. */
  async ejecutar(token: string): Promise<{ barberia: string }> {
    return conTiempoMinimo(this.configuracion.cuentas.respuestaMinimaMs, async () => {
      const ip = this.tenantContext.datosSolicitud().ip ?? IP_DESCONOCIDA;
      // Sin barbería: aún no se conoce. Se fija (ADR-015) solo si la función devuelve una cuenta.
      const resultado = await this.uow.ejecutarSinTenant(async (): Promise<Resultado> => {
        const ahora = this.reloj.ahora();
        const recientes = await this.intentos.recientes(
          'USO_FALLIDO',
          null,
          ip,
          new Date(ahora.getTime() - VENTANA_LIMITE_ENLACES_MS),
        );
        const decision = evaluarLimiteDeEnlace('USO_FALLIDO', recientes, ahora);
        if (!decision.permitido) throw new DemasiadosIntentos(decision.reintentarEnSegundos);

        const consumo = FORMA_DEL_TOKEN.test(token)
          ? await this.funciones.verificarCorreo(hashDeToken(token))
          : null;
        if (!consumo) {
          await this.intentos.registrar('USO_FALLIDO', null, ip, ahora);
          return { verificado: false };
        }

        await this.uow.fijarTenant(TenantId.de(consumo.tenantId));
        const aceptado = consumo.resultado === 'APLICADO';
        await this.auditoria.registrar({
          accion: aceptado ? 'CORREO_VERIFICADO' : 'ENLACE_DE_CUENTA_RECHAZADO',
          actorId: consumo.usuarioId,
          recurso: `cuenta:${consumo.usuarioId};VERIFICAR_CORREO`,
          resultado: aceptado ? 'PERMITIDO' : 'DENEGADO',
        });
        if (!aceptado) return { verificado: false };
        const barberia = await this.barberias.configuracion(consumo.tenantId);
        if (!barberia) throw new Error('La barbería del enlace no existe');
        return { verificado: true, barberia: barberia.slug };
      });
      // Fuera de la transacción: el rechazo y el uso fallido ya quedaron guardados.
      if (!resultado.verificado) throw new EnlaceNoValido();
      return { barberia: resultado.barberia };
    });
  }
}

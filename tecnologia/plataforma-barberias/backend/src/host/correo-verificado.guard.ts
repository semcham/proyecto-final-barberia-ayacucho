import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CorreoNoVerificado } from '../modules/acceso-barberias';
import { CuentasApi } from '../modules/acceso-barberias/cuentas';
import { CLAVE_CORREO_VERIFICADO, TenantId, UnitOfWork } from '../shared';
import type { SolicitudConActor } from './solicitud';

/** Cuentas verificadas recordadas por réplica; al llenarse se vacía (solo cuesta volver a consultar). */
const MAXIMO_RECORDADAS = 10_000;

/**
 * T060 de 010 (research R05; FR-009 a FR-011) · En las rutas con @RequiereCorreoVerificado(), un actor CLIENTE sin el
 * correo verificado recibe 403 CORREO_NO_VERIFICADO. Va después del AuthGuard (que no cambia) y del de roles. El
 * propietario y el barbero pasan sin consulta (cita presencial y asistente del personal).
 *
 * Vive en el host porque la matriz de dependencias prohíbe que M03 y M04 llamen a M01; el host es la raíz de
 * composición. El estado se lee con la barbería del token (RLS, PR09).
 *
 * Costo (medido con PR06 del asistente, que cuenta su presupuesto de 3 s desde el caso de uso, no desde la solicitud):
 * - Una cuenta verificada no puede dejar de estarlo (la aplicación no tiene permiso sobre esas columnas), así que el
 *   "sí" se recuerda por barbería y cuenta, en memoria de la réplica. El "no" nunca se recuerda: una cuenta sin
 *   verificar se consulta en cada solicitud, y verificar en otro dispositivo vale al instante.
 * - Las solicitudes simultáneas de la misma cuenta comparten una sola consulta.
 */
@Injectable()
export class CorreoVerificadoGuard implements CanActivate {
  private readonly verificadas = new Set<string>();
  private readonly enCurso = new Map<string, Promise<boolean>>();

  constructor(
    private readonly reflector: Reflector,
    private readonly cuentas: CuentasApi,
    private readonly uow: UnitOfWork,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const exige = this.reflector.getAllAndOverride<boolean | undefined>(CLAVE_CORREO_VERIFICADO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!exige) return true;
    const actor = contexto.switchToHttp().getRequest<SolicitudConActor>().actor;
    if (!actor || actor.rol !== 'CLIENTE') return true;
    if (!(await this.verificada(actor.tenantId, actor.usuarioId))) throw new CorreoNoVerificado();
    return true;
  }

  private async verificada(tenantId: string, usuarioId: string): Promise<boolean> {
    const clave = `${tenantId}:${usuarioId}`;
    if (this.verificadas.has(clave)) return true;
    let consulta = this.enCurso.get(clave);
    if (!consulta) {
      consulta = this.uow
        .ejecutar(TenantId.de(tenantId), () => this.cuentas.correoVerificado(usuarioId))
        .finally(() => this.enCurso.delete(clave));
      this.enCurso.set(clave, consulta);
    }
    const verificado = await consulta;
    if (verificado) {
      if (this.verificadas.size >= MAXIMO_RECORDADAS) this.verificadas.clear();
      this.verificadas.add(clave);
    }
    return verificado;
  }
}

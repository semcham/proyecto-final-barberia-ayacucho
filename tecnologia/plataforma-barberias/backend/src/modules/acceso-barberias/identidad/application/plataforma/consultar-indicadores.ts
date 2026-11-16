import { Injectable } from '@nestjs/common';
import { Clock, RegistroDeIndicadores, UnitOfWork } from '../../../../../shared';
import { AuditoriaAccesoPlataforma } from '../ports/plataforma';
import type { ActorPlataforma } from '../validar-solicitud-plataforma';

/** Esquema Indicadores del contrato: la hora del cálculo y la sección de cada fuente registrada. */
export type Indicadores = { calculadoEn: string } & Record<string, unknown>;

/**
 * T036 de 007 · GET /plataforma/indicadores (US2, RF31; FR-012 a FR-016; research R01). El administrador de la
 * plataforma ve los indicadores agregados de todas las barberías: los junta el registro de M06 con las fuentes que
 * el host registró (cada módulo cuenta solo sus tablas, con el rol de lectura de la plataforma, sin `BYPASSRLS`).
 * Solo números: ninguna fuente devuelve ids, nombres ni datos de personas. Cada consulta queda en
 * `platform_audit_log` (M01 es su dueño). No escribe ningún dato de negocio.
 */
@Injectable()
export class ConsultarIndicadores {
  constructor(
    private readonly registro: RegistroDeIndicadores,
    private readonly uow: UnitOfWork,
    private readonly auditoria: AuditoriaAccesoPlataforma,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(admin: ActorPlataforma): Promise<Indicadores> {
    const calculadoEn = this.reloj.ahora();
    // Si una fuente falla, la consulta falla entera: nunca se muestran resultados parciales como si fueran ceros.
    const secciones = await this.registro.calcular();
    await this.uow.ejecutarSinTenant(() =>
      this.auditoria.registrar({
        accion: 'ADMIN_INDICADORES_CONSULTADOS',
        adminId: admin.adminId,
        resultado: 'PERMITIDO',
      }),
    );
    return { calculadoEn: calculadoEn.toISOString(), ...secciones };
  }
}

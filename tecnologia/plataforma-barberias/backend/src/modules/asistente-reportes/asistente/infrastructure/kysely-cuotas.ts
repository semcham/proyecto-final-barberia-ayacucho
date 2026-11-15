import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import type { AlcanceDeCuota } from '../domain/errores';
import type { LimitesDeCuota } from '../domain/politica-cuota';
import { AlcanceAgotado, CuotasDelAsistente, type UsoDeLaCuota } from '../application/ports/cuotas';

/**
 * T041 de 005 · Las cuotas con PostgreSQL (research R08, data-model §1). La suma es atómica: INSERT … ON CONFLICT DO
 * UPDATE … WHERE used < límite RETURNING used. Con la fila bloqueada por el conflicto, dos réplicas a la vez nunca pasan
 * del límite; sin fila devuelta, la cuota está agotada. Se suma primero la del usuario y después la de la barbería, en
 * la MISMA transacción: si la segunda está agotada, AlcanceAgotado hace que el llamador revierta las dos.
 */
@Injectable()
export class KyselyCuotasDelAsistente extends CuotasDelAsistente {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  private async sumarUna(
    alcance: AlcanceDeCuota,
    sujeto: string,
    dia: string,
    limite: number,
  ): Promise<number> {
    const { rows } = await sql<{ used: number }>`
      INSERT INTO assistant_quota (tenant_id, scope, subject_id, day, used)
      VALUES (${this.tenantId}, ${alcance}, ${sujeto}, ${dia}::date, 1)
      ON CONFLICT (tenant_id, scope, subject_id, day)
      DO UPDATE SET used = assistant_quota.used + 1, updated_at = now()
      WHERE assistant_quota.used < ${limite}
      RETURNING used`.execute(this.uow.transaccionActual());
    if (rows.length === 0) throw new AlcanceAgotado(alcance);
    return rows[0].used;
  }

  async sumar(usuarioId: string, dia: string, limites: LimitesDeCuota): Promise<UsoDeLaCuota> {
    const usuario = await this.sumarUna('USUARIO', usuarioId, dia, limites.usuario);
    const barberia = await this.sumarUna('BARBERIA', this.tenantId, dia, limites.barberia);
    return { usuario, barberia };
  }

  async devolver(usuarioId: string, dia: string): Promise<void> {
    await sql`
      UPDATE assistant_quota SET used = used - 1, updated_at = now()
       WHERE tenant_id = ${this.tenantId} AND day = ${dia}::date AND used > 0
         AND ((scope = 'USUARIO' AND subject_id = ${usuarioId}) OR (scope = 'BARBERIA' AND subject_id = ${this.tenantId}))`.execute(
      this.uow.transaccionActual(),
    );
  }
}

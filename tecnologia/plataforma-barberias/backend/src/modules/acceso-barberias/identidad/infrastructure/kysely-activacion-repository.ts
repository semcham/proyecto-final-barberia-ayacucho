import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { ActivacionRepository } from '../application/ports/activacion-repository';
import { Activacion } from '../domain/activacion';

@Injectable()
export class KyselyActivacionRepository extends ActivacionRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  async crear(activacion: Activacion, hashToken: string, creadaPor: string): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('account_activation')
      .values({
        id: activacion.id,
        tenant_id: this.tenantId,
        user_id: activacion.usuarioId,
        token_hash: hashToken,
        expires_at: activacion.venceEn,
        created_by: creadaPor,
      })
      .execute();
  }

  async revocarVigentesDe(usuarioId: string, ahora: Date): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('account_activation')
      .set({ revoked_at: ahora })
      .where('tenant_id', '=', this.tenantId)
      .where('user_id', '=', usuarioId)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async buscarPorHash(hashToken: string): Promise<Activacion | null> {
    // ADR-015: búsqueda previa a conocer el tenant, mediante la función SECURITY DEFINER.
    const { rows } = await sql<{
      activation_id: string;
      tenant_id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
      revoked_at: Date | null;
    }>`select * from auth_buscar_activacion(${hashToken})`.execute(this.uow.transaccionActual());
    const fila = rows[0];
    return fila
      ? Activacion.reconstruir({
          id: fila.activation_id,
          tenantId: fila.tenant_id,
          usuarioId: fila.user_id,
          venceEn: fila.expires_at,
          usadaEn: fila.used_at,
          revocadaEn: fila.revoked_at,
        })
      : null;
  }

  async marcarUsada(activacion: Activacion): Promise<boolean> {
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('account_activation')
      .set({ used_at: activacion.usadaEn })
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', activacion.id)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows) === 1;
  }

  async tieneActivacionUsada(usuarioId: string): Promise<boolean> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('account_activation')
      .select('id')
      .where('tenant_id', '=', this.tenantId)
      .where('user_id', '=', usuarioId)
      .where('used_at', 'is not', null)
      .executeTakeFirst();
    return fila !== undefined;
  }
}

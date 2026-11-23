import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import {
  EnlaceDeCuentaRepository,
  EstadoDeCuentas,
  FuncionesDeCuenta,
  type ResultadoDeConsumo,
} from '../application/ports/enlace-de-cuenta-repository';
import type { EnlaceDeCuenta, PropositoEnlace } from '../domain/enlace-de-cuenta';

/**
 * T040 de 010 · Enlaces de cuenta con Kysely (data-model §2). Usa la transacción del caso de uso y filtra además por
 * el tenant del contexto. Nunca recibe ni guarda el token: solo su SHA-256.
 */
@Injectable()
export class KyselyEnlaceDeCuentaRepository extends EnlaceDeCuentaRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  async crear(enlace: EnlaceDeCuenta): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('account_link')
      .values({
        id: enlace.id,
        tenant_id: this.tenantId,
        user_id: enlace.usuarioId,
        purpose: enlace.proposito,
        requested_at: enlace.solicitadoEn,
        expires_at: enlace.venceEn,
      })
      .execute();
  }

  async anularVigentesDe(usuarioId: string, proposito: PropositoEnlace, ahora: Date): Promise<number> {
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('account_link')
      .set({ revoked_at: ahora })
      .where('tenant_id', '=', this.tenantId)
      .where('user_id', '=', usuarioId)
      .where('purpose', '=', proposito)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows);
  }

  async guardarHashSiVigente(
    enlaceId: string,
    hashToken: string,
    ahora: Date,
  ): Promise<{ proposito: PropositoEnlace; venceEn: Date } | null> {
    const fila = await this.uow
      .transaccionActual()
      .updateTable('account_link')
      .set({ token_hash: hashToken })
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', enlaceId)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', ahora)
      .returning(['purpose', 'expires_at'])
      .executeTakeFirst();
    return fila ? { proposito: fila.purpose, venceEn: fila.expires_at } : null;
  }

  async purgarTerminados(limite: Date, lote: number): Promise<number> {
    const trx = this.uow.transaccionActual();
    const resultado = await trx
      .deleteFrom('account_link')
      .where(
        'id',
        'in',
        trx
          .selectFrom('account_link')
          .select('id')
          .where('tenant_id', '=', this.tenantId)
          .where((eb) =>
            eb.or([eb('used_at', '<', limite), eb('revoked_at', '<', limite), eb('expires_at', '<', limite)]),
          )
          .orderBy('expires_at')
          .limit(lote),
      )
      .executeTakeFirst();
    return Number(resultado.numDeletedRows);
  }
}

/** Las cuatro funciones de sistema de la migración 0036 (barberias_auth), en la transacción en curso. */
@Injectable()
export class KyselyFuncionesDeCuenta extends FuncionesDeCuenta {
  constructor(private readonly uow: KyselyUnitOfWork) {
    super();
  }

  async barberiaParaEnlace(usuarioId: string, preferida: string | null): Promise<string | null> {
    const { rows } = await sql<{ tenant_id: string | null }>`
      select auth_barberia_para_enlace(${usuarioId}::uuid, ${preferida}::uuid) as tenant_id
    `.execute(this.uow.transaccionActual());
    return rows[0]?.tenant_id ?? null;
  }

  async verificarCorreo(hashToken: string): Promise<ResultadoDeConsumo> {
    const { rows } = await sql<FilaDeConsumo>`select * from auth_verificar_correo(${hashToken})`.execute(
      this.uow.transaccionActual(),
    );
    return deFila(rows[0]);
  }

  async restablecerContrasena(hashToken: string, hashContrasenaNueva: string): Promise<ResultadoDeConsumo> {
    const { rows } = await sql<FilaDeConsumo>`
      select * from auth_restablecer_contrasena(${hashToken}, ${hashContrasenaNueva})
    `.execute(this.uow.transaccionActual());
    return deFila(rows[0]);
  }

  async marcarVerificadaPorActivacion(usuarioId: string): Promise<void> {
    await sql`select auth_marcar_verificada_por_activacion(${usuarioId}::uuid)`.execute(
      this.uow.transaccionActual(),
    );
  }
}

interface FilaDeConsumo {
  resultado: 'APLICADO' | 'RECHAZADO';
  tenant_id: string;
  user_id: string;
}

const deFila = (fila: FilaDeConsumo | undefined): ResultadoDeConsumo =>
  fila ? { resultado: fila.resultado, tenantId: fila.tenant_id, usuarioId: fila.user_id } : null;

/** Correo y verificación de una cuenta con membresía en la barbería del contexto (RLS de user_account, ADR-015). */
@Injectable()
export class KyselyEstadoDeCuentas extends EstadoDeCuentas {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async correoYVerificacion(usuarioId: string): Promise<{ correo: string; verificado: boolean } | null> {
    // Falla si no hay tenant: sin él, RLS no deja ver ninguna cuenta (y aquí sería un error de programación).
    this.tenantContext.actual();
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('user_account')
      .select(['email', 'email_verified_at'])
      .where('id', '=', usuarioId)
      .executeTakeFirst();
    return fila ? { correo: fila.email, verificado: fila.email_verified_at !== null } : null;
  }
}

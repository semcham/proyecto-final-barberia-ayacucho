import { Injectable } from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { type Database, type DatosSolicitud, KyselyUnitOfWork, TenantContext } from '../../../../shared';
import type { CodigoRol } from '../domain/rol';
import { RETENCION_MS, Sesion, VIDA_DESLIZANTE_MS, type EstadoSesion } from '../domain/sesion';
import {
  type EstadoDeAcceso,
  SesionRepository,
  type SesionPorHash,
} from '../application/ports/sesion-repository';

type FilaSesion = Omit<Selectable<Database['auth_session']>, 'ip' | 'user_agent'>;

const COLUMNAS = [
  'auth_session.id',
  'auth_session.tenant_id',
  'auth_session.user_id',
  'auth_session.refresh_token_hash',
  'auth_session.previous_token_hash',
  'auth_session.status',
  'auth_session.created_at',
  'auth_session.last_used_at',
  'auth_session.absolute_expires_at',
  'auth_session.ended_at',
  'auth_session.rotated_at',
  'auth_session.grace_used_at',
  'auth_session.superseded_token_hash',
] as const;

function aDominio(fila: FilaSesion): Sesion {
  return Sesion.reconstruir({
    id: fila.id,
    tenantId: fila.tenant_id,
    usuarioId: fila.user_id,
    hashTokenVigente: fila.refresh_token_hash,
    hashTokenAnterior: fila.previous_token_hash,
    estado: fila.status,
    creadaEn: fila.created_at,
    ultimoUsoEn: fila.last_used_at,
    venceAbsolutoEn: fila.absolute_expires_at,
    terminadaEn: fila.ended_at,
    rotadaEn: fila.rotated_at,
    graciaUsadaEn: fila.grace_used_at,
    hashTokenReemplazado: fila.superseded_token_hash,
  });
}

@Injectable()
export class KyselySesionRepository extends SesionRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  async crear(sesion: Sesion, metadatos: DatosSolicitud): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('auth_session')
      .values({
        id: sesion.id,
        tenant_id: this.tenantId,
        user_id: sesion.usuarioId,
        refresh_token_hash: sesion.hashTokenVigente,
        previous_token_hash: sesion.hashTokenAnterior,
        status: sesion.estado,
        created_at: sesion.creadaEn,
        last_used_at: sesion.ultimoUsoEn,
        absolute_expires_at: sesion.venceAbsolutoEn,
        ended_at: sesion.terminadaEn,
        rotated_at: sesion.rotadaEn,
        grace_used_at: sesion.graciaUsadaEn,
        superseded_token_hash: sesion.hashTokenReemplazado,
        ip: metadatos.ip ?? null,
        user_agent: metadatos.userAgent?.slice(0, 200) ?? null,
      })
      .execute();
  }

  async obtener(sesionId: string): Promise<Sesion | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('auth_session')
      .select(COLUMNAS)
      .where('auth_session.tenant_id', '=', this.tenantId)
      .where('auth_session.id', '=', sesionId)
      .executeTakeFirst();
    return fila ? aDominio(fila) : null;
  }

  async guardar(sesion: Sesion): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('auth_session')
      .set({
        refresh_token_hash: sesion.hashTokenVigente,
        previous_token_hash: sesion.hashTokenAnterior,
        status: sesion.estado,
        last_used_at: sesion.ultimoUsoEn,
        ended_at: sesion.terminadaEn,
        rotated_at: sesion.rotadaEn,
        grace_used_at: sesion.graciaUsadaEn,
        superseded_token_hash: sesion.hashTokenReemplazado,
      })
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', sesion.id)
      .execute();
  }

  async revocarTodasDe(usuarioId: string, ahora: Date): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('auth_session')
      .set({ status: 'REVOCADA', ended_at: ahora })
      .where('tenant_id', '=', this.tenantId)
      .where('user_id', '=', usuarioId)
      .where('status', '=', 'ACTIVA')
      .execute();
  }

  async purgarTerminadasDe(usuarioId: string, ahora: Date): Promise<number> {
    const limite = new Date(ahora.getTime() - RETENCION_MS);
    const limiteUso = new Date(limite.getTime() - VIDA_DESLIZANTE_MS);
    const resultado = await this.uow
      .transaccionActual()
      .deleteFrom('auth_session')
      .where('tenant_id', '=', this.tenantId)
      .where('user_id', '=', usuarioId)
      .where((eb) =>
        eb.or([
          eb('ended_at', '<', limite),
          eb('absolute_expires_at', '<', limite),
          eb.and([eb('status', '=', 'ACTIVA'), eb('last_used_at', '<', limiteUso)]),
        ]),
      )
      .executeTakeFirst();
    return Number(resultado.numDeletedRows);
  }

  async buscarPorHash(hashToken: string): Promise<SesionPorHash | null> {
    // ADR-015: búsqueda previa a conocer el tenant, mediante la función SECURITY DEFINER.
    const { rows } = await sql<{
      session_id: string;
      tenant_id: string;
      user_id: string;
      status: EstadoSesion;
      es_token_anterior: boolean;
    }>`select * from auth_buscar_sesion(${hashToken})`.execute(this.uow.transaccionActual());
    const fila = rows[0];
    return fila
      ? {
          sesionId: fila.session_id,
          tenantId: fila.tenant_id,
          usuarioId: fila.user_id,
          estado: fila.status,
          esTokenAnterior: fila.es_token_anterior,
        }
      : null;
  }

  async estadoDeAcceso(sesionId: string, usuarioId: string): Promise<EstadoDeAcceso | null> {
    return this.leerEstadoDeAcceso(sesionId, usuarioId, false);
  }

  async bloquearParaRenovar(sesionId: string, usuarioId: string): Promise<EstadoDeAcceso | null> {
    return this.leerEstadoDeAcceso(sesionId, usuarioId, true);
  }

  private async leerEstadoDeAcceso(
    sesionId: string,
    usuarioId: string,
    bloquear: boolean,
  ): Promise<EstadoDeAcceso | null> {
    const consulta = this.uow
      .transaccionActual()
      .selectFrom('auth_session')
      .innerJoin('membership', (join) =>
        join
          .onRef('membership.tenant_id', '=', 'auth_session.tenant_id')
          .onRef('membership.user_id', '=', 'auth_session.user_id'),
      )
      .innerJoin('tenant', 'tenant.id', 'auth_session.tenant_id')
      .select([
        ...COLUMNAS,
        'membership.role_code',
        'membership.status as membership_status',
        'tenant.status as tenant_status',
      ])
      .where('auth_session.tenant_id', '=', this.tenantId)
      .where('membership.tenant_id', '=', this.tenantId)
      .where('auth_session.id', '=', sesionId)
      .where('auth_session.user_id', '=', usuarioId);
    // Solo se bloquea la fila de la sesión: membresía y barbería se leen sin bloquear.
    const fila = await (bloquear ? consulta.forUpdate('auth_session') : consulta).executeTakeFirst();
    if (!fila) return null;
    return {
      sesion: aDominio(fila),
      rolMembresia: fila.role_code as CodigoRol,
      membresiaActiva: fila.membership_status === 'ACTIVA',
      barberiaActiva: fila.tenant_status === 'ACTIVA',
    };
  }
}

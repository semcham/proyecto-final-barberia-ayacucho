import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { KyselyUnitOfWork, TenantContext } from '../../../../../shared';
import {
  AccesoPlataformaRepository,
  type AccionAccesoAdmin,
  AuditoriaAccesoPlataforma,
  CodigoRecuperacionYaUsado,
  type DesafioPlataforma,
  type SesionPlataforma,
} from '../../application/ports/plataforma';

const CODIGO_UN_USO = 'platform_challenge_codigo_un_uso';

function esUnicoViolado(error: unknown, restriccion: string): boolean {
  const e = error as { code?: unknown; constraint?: unknown };
  return e?.code === '23505' && e.constraint === restriccion;
}

/**
 * T068 · Desafíos y sesiones del administrador con el rol de la aplicación, sin tenant (las tablas de la
 * plataforma no tienen barbería). Las fechas salen del reloj de la aplicación, no de `now()`, para que las
 * vidas máximas (CHECK de 5 minutos y 8 horas) se midan con el mismo reloj que las decide.
 */
@Injectable()
export class KyselyAccesoPlataforma extends AccesoPlataformaRepository {
  constructor(private readonly uow: KyselyUnitOfWork) {
    super();
  }

  async crearDesafio(desafio: {
    id: string;
    adminId: string;
    creadoEn: Date;
    expiraEn: Date;
  }): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('platform_challenge')
      .values({
        id: desafio.id,
        admin_id: desafio.adminId,
        created_at: desafio.creadoEn,
        expires_at: desafio.expiraEn,
      })
      .execute();
  }

  async desafio(id: string): Promise<DesafioPlataforma | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('platform_challenge')
      .select(['id', 'admin_id', 'expires_at', 'used_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    return fila
      ? { id: fila.id, adminId: fila.admin_id, expiraEn: fila.expires_at, usadoEn: fila.used_at }
      : null;
  }

  async usarDesafio(id: string, ahora: Date, indiceRecuperacion: number | null): Promise<boolean> {
    try {
      const resultado = await this.uow
        .transaccionActual()
        .updateTable('platform_challenge')
        .set({ used_at: ahora, used_recovery_index: indiceRecuperacion })
        .where('id', '=', id)
        .where('used_at', 'is', null)
        .where('expires_at', '>', ahora)
        .executeTakeFirst();
      return resultado.numUpdatedRows === 1n;
    } catch (error) {
      if (esUnicoViolado(error, CODIGO_UN_USO)) throw new CodigoRecuperacionYaUsado();
      throw error;
    }
  }

  async indicesRecuperacionUsados(adminId: string): Promise<Set<number>> {
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('platform_challenge')
      .select('used_recovery_index')
      .where('admin_id', '=', adminId)
      .where('used_recovery_index', 'is not', null)
      .execute();
    return new Set(filas.map((fila) => fila.used_recovery_index as number));
  }

  async ultimoPaso(adminId: string): Promise<number | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('platform_session')
      .select((eb) => eb.fn.max('totp_step').as('paso'))
      .where('admin_id', '=', adminId)
      .executeTakeFirst();
    return fila?.paso === null || fila?.paso === undefined ? null : Number(fila.paso);
  }

  async crearSesion(sesion: {
    id: string;
    adminId: string;
    hashRenovacion: string;
    paso: number | null;
    creadaEn: Date;
    expiraEn: Date;
  }): Promise<boolean> {
    // ON CONFLICT sobre el paso: el segundo ingreso simultáneo con el mismo código no abre sesión (R07).
    const fila = await this.uow
      .transaccionActual()
      .insertInto('platform_session')
      .values({
        id: sesion.id,
        admin_id: sesion.adminId,
        refresh_token_hash: sesion.hashRenovacion,
        status: 'ACTIVA',
        totp_step: sesion.paso,
        created_at: sesion.creadaEn,
        expires_at: sesion.expiraEn,
        last_used_at: sesion.creadaEn,
      })
      .onConflict((oc) => oc.constraint('platform_session_un_ingreso_por_codigo').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }

  async bloquearSesionPorHash(hash: string): Promise<SesionPlataforma | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('platform_session')
      .select(['id', 'admin_id', 'status', 'expires_at', 'refresh_token_hash'])
      .where((eb) => eb.or([eb('refresh_token_hash', '=', hash), eb('previous_token_hash', '=', hash)]))
      .forUpdate()
      .executeTakeFirst();
    if (!fila) return null;
    return {
      id: fila.id,
      adminId: fila.admin_id,
      estado: fila.status,
      expiraEn: fila.expires_at,
      coincide: fila.refresh_token_hash === hash ? 'ACTUAL' : 'ANTERIOR',
    };
  }

  async rotarSesion(id: string, hashNuevo: string, hashAnterior: string, ahora: Date): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('platform_session')
      .set({ refresh_token_hash: hashNuevo, previous_token_hash: hashAnterior, last_used_at: ahora })
      .where('id', '=', id)
      .where('status', '=', 'ACTIVA')
      .execute();
  }

  async terminarSesion(
    id: string,
    adminId: string,
    estado: 'CERRADA' | 'REVOCADA',
    ahora: Date,
  ): Promise<boolean> {
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('platform_session')
      .set({ status: estado, ended_at: ahora })
      .where('id', '=', id)
      .where('admin_id', '=', adminId)
      .where('status', '=', 'ACTIVA')
      .executeTakeFirst();
    return resultado.numUpdatedRows === 1n;
  }
}

/** T068 · platform_audit_log, en la transacción en curso (solo INSERT para el rol de la aplicación). */
@Injectable()
export class KyselyAuditoriaAccesoPlataforma extends AuditoriaAccesoPlataforma {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async registrar(entrada: {
    accion: AccionAccesoAdmin;
    adminId: string | null;
    resultado: 'PERMITIDO' | 'DENEGADO';
  }): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('platform_audit_log')
      .values({
        id: uuidv7(),
        admin_id: entrada.adminId,
        action: entrada.accion,
        result: entrada.resultado,
        ip: this.tenantContext.datosSolicitud().ip ?? null,
      })
      .execute();
  }
}

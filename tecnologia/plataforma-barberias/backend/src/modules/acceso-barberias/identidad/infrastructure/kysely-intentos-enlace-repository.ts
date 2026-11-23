import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Configuracion, KyselyUnitOfWork } from '../../../../shared';
import { IntentosEnlaceDeCuentaRepository } from '../application/ports/enlace-de-cuenta-repository';
import type { IntentosRecientes, TipoIntentoEnlace } from '../domain/limite-enlaces';
import { HISTORIAL_MS } from '../domain/politica-intentos';

/**
 * T040 de 010 · Intentos de los enlaces de cuenta (`account_link_attempt`, research R08). Tabla técnica sin barbería:
 * se usa dentro de UnitOfWork.ejecutarSinTenant. La IP nunca se guarda: el origen se deriva aquí como
 * HMAC-SHA256(INTENTOS_SAL_IP, ip) (data-model §3). Sin la sal, que no está en la base, no se puede saber de qué IP
 * fue un intento; la misma IP da siempre el mismo valor, así que el límite funciona igual.
 */
@Injectable()
export class KyselyIntentosEnlaceDeCuentaRepository extends IntentosEnlaceDeCuentaRepository {
  private readonly sal: string;

  constructor(
    private readonly uow: KyselyUnitOfWork,
    configuracion: Configuracion,
  ) {
    super();
    this.sal = configuracion.intentos.salIp;
  }

  private origenDe(ip: string): string {
    return createHmac('sha256', this.sal).update(ip).digest('hex');
  }

  async recientes(
    tipo: TipoIntentoEnlace,
    sujetoHash: string | null,
    ip: string,
    desde: Date,
  ): Promise<IntentosRecientes> {
    const trx = this.uow.transaccionActual();
    const porOrigen = await trx
      .selectFrom('account_link_attempt')
      .select('at')
      .where('kind', '=', tipo)
      .where('origin_hash', '=', this.origenDe(ip))
      .where('at', '>=', desde)
      .orderBy('at')
      .execute();
    const porCuenta = sujetoHash
      ? await trx
          .selectFrom('account_link_attempt')
          .select('at')
          .where('kind', '=', tipo)
          .where('subject_hash', '=', sujetoHash)
          .where('at', '>=', desde)
          .orderBy('at')
          .execute()
      : [];
    return { porCuenta: porCuenta.map((f) => f.at), porOrigen: porOrigen.map((f) => f.at) };
  }

  async registrar(
    tipo: TipoIntentoEnlace,
    sujetoHash: string | null,
    ip: string,
    ahora: Date,
  ): Promise<void> {
    const limite = new Date(ahora.getTime() - HISTORIAL_MS);
    await sql`
      with purga as (delete from account_link_attempt where at < ${limite})
      insert into account_link_attempt (kind, subject_hash, origin_hash, at)
      values (${tipo}, ${sujetoHash}, ${this.origenDe(ip)}, ${ahora})
    `.execute(this.uow.transaccionActual());
  }
}

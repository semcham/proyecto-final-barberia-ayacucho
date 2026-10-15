import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork } from '../../../../shared';
import { IntentosRepository } from '../application/ports/intentos-repository';
import { HISTORIAL_MS } from '../domain/politica-intentos';

/** Tabla global sin tenant: se usa dentro de UnitOfWork.ejecutarSinTenant. */
@Injectable()
export class KyselyIntentosRepository extends IntentosRepository {
  constructor(private readonly uow: KyselyUnitOfWork) {
    super();
  }

  async fallosDesde(hashCorreo: string, ip: string, desde: Date): Promise<Date[]> {
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('login_attempt')
      .select('attempted_at')
      .where('email_hash', '=', hashCorreo)
      .where('ip', '=', ip)
      .where('attempted_at', '>=', desde)
      .orderBy('attempted_at')
      .execute();
    return filas.map((fila) => fila.attempted_at);
  }

  async registrarFallo(hashCorreo: string, ip: string, ahora: Date): Promise<void> {
    const limite = new Date(ahora.getTime() - HISTORIAL_MS);
    await sql`
      with purga as (delete from login_attempt where attempted_at < ${limite})
      insert into login_attempt (email_hash, ip, attempted_at) values (${hashCorreo}, ${ip}, ${ahora})
    `.execute(this.uow.transaccionActual());
  }

  async borrarFallos(hashCorreo: string, ip: string): Promise<void> {
    await this.uow
      .transaccionActual()
      .deleteFrom('login_attempt')
      .where('email_hash', '=', hashCorreo)
      .where('ip', '=', ip)
      .execute();
  }
}

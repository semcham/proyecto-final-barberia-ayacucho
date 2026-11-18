import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Configuracion, KyselyUnitOfWork } from '../../../../shared';
import { IntentosRepository } from '../application/ports/intentos-repository';
import { HISTORIAL_MS } from '../domain/politica-intentos';

/**
 * Tabla global sin tenant: se usa dentro de UnitOfWork.ejecutarSinTenant.
 *
 * 007 (US3; patrón de KyselyIntentosEnlaceRepository): la IP nunca se guarda. El origen se deriva aquí, en el
 * adaptador, como SHA-256(INTENTOS_SAL_IP ‖ ip): sin la sal, que no está en la base, no se puede saber de qué IP fue un
 * fallo. El puerto, el ingreso e IntentosAdmin siguen recibiendo la IP y no cambian; el límite se comporta igual porque
 * la misma IP da siempre el mismo valor derivado.
 */
@Injectable()
export class KyselyIntentosRepository extends IntentosRepository {
  private readonly sal: string;

  constructor(
    private readonly uow: KyselyUnitOfWork,
    configuracion: Configuracion,
  ) {
    super();
    this.sal = configuracion.intentos.salIp;
  }

  private origenDe(ip: string): string {
    return createHash('sha256').update(this.sal).update(ip).digest('hex');
  }

  async fallosDesde(hashCorreo: string, ip: string, desde: Date): Promise<Date[]> {
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('login_attempt')
      .select('attempted_at')
      .where('email_hash', '=', hashCorreo)
      .where('ip_hash', '=', this.origenDe(ip))
      .where('attempted_at', '>=', desde)
      .orderBy('attempted_at')
      .execute();
    return filas.map((fila) => fila.attempted_at);
  }

  async registrarFallo(hashCorreo: string, ip: string, ahora: Date): Promise<void> {
    const limite = new Date(ahora.getTime() - HISTORIAL_MS);
    await sql`
      with purga as (delete from login_attempt where attempted_at < ${limite})
      insert into login_attempt (email_hash, ip_hash, attempted_at)
      values (${hashCorreo}, ${this.origenDe(ip)}, ${ahora})
    `.execute(this.uow.transaccionActual());
  }

  async borrarFallos(hashCorreo: string, ip: string): Promise<void> {
    await this.uow
      .transaccionActual()
      .deleteFrom('login_attempt')
      .where('email_hash', '=', hashCorreo)
      .where('ip_hash', '=', this.origenDe(ip))
      .execute();
  }
}

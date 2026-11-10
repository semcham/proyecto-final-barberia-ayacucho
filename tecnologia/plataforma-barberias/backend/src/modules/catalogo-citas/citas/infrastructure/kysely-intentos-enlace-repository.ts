import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Configuracion, KyselyUnitOfWork } from '../../../../shared';
import { IntentosEnlaceRepository } from '../application/ports/intentos-enlace-repository';

/**
 * T092 de 004 · `action_link_attempt` con Kysely, con el rol de la aplicación y sin barbería (ejecutarSinTenant).
 * La IP nunca se guarda: solo SHA-256(ENLACES_SAL_IP ‖ IP), así que la tabla no permite saber de qué IP fue un
 * rechazo sin la sal (data-model §5; constitución 1.4.1, principio III).
 */
@Injectable()
export class KyselyIntentosEnlaceRepository extends IntentosEnlaceRepository {
  private readonly sal: string;

  constructor(
    private readonly uow: KyselyUnitOfWork,
    configuracion: Configuracion,
  ) {
    super();
    this.sal = configuracion.enlaces.salIp;
  }

  private hashDe(ip: string): string {
    return createHash('sha256').update(this.sal).update(ip).digest('hex');
  }

  fallosDesde(ip: string, desde: Date): Promise<Date[]> {
    return this.uow.ejecutarSinTenant(async () => {
      const filas = await this.uow
        .transaccionActual()
        .selectFrom('action_link_attempt')
        .select('attempted_at')
        .where('ip_hash', '=', this.hashDe(ip))
        .where('attempted_at', '>=', desde)
        .orderBy('attempted_at')
        .execute();
      return filas.map((f) => f.attempted_at);
    });
  }

  registrar(ip: string, en: Date): Promise<void> {
    return this.uow.ejecutarSinTenant(async () => {
      await this.uow
        .transaccionActual()
        .insertInto('action_link_attempt')
        .values({ ip_hash: this.hashDe(ip), attempted_at: en })
        .execute();
    });
  }

  purgarAnterioresA(limite: Date, lote: number): Promise<number> {
    return this.uow.ejecutarSinTenant(async () => {
      const trx = this.uow.transaccionActual();
      const resultado = await trx
        .deleteFrom('action_link_attempt')
        .where(
          'id',
          'in',
          trx
            .selectFrom('action_link_attempt')
            .select('id')
            .where('attempted_at', '<', limite)
            .orderBy('attempted_at')
            .limit(lote),
        )
        .executeTakeFirst();
      return Number(resultado.numDeletedRows);
    });
  }
}

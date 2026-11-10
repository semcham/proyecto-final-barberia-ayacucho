import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LecturaPlataforma } from '../../../../shared/lectura-plataforma';
import { type AvisoPorEnviar, PendientesDeAvisos } from '../../application/ports/aviso-repository';
import { ESTADOS_FINALES } from '../../domain/aviso';

// T071 de 004 · Avisos por enviar entre barberías con el rol barberias_plataforma (research R08; constitución
// 1.4.1, principio III, tercera excepción). Lee SOLO las cinco columnas que ese rol puede leer de notification
// (id, tenant_id, status, next_attempt_at, claimed_until): ni el tipo, ni el destinatario, ni la cita. Cada aviso
// se reclama y se envía después en una transacción con su tenant y el rol de la aplicación (enviar-avisos.ts).

@Injectable()
export class AvisosPendientesPlataforma extends PendientesDeAvisos {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  listar(ahora: Date, limite: number): Promise<AvisoPorEnviar[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const filas = await trx
        .selectFrom('notification')
        .select(['id', 'tenant_id'])
        .where((eb) =>
          eb.or([
            eb.and([
              eb('status', '=', 'PENDIENTE'),
              eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', ahora)]),
            ]),
            eb.and([eb('status', '=', 'ENVIANDO'), eb('claimed_until', '<', ahora)]),
          ]),
        )
        // Los nuevos (sin próximo intento) primero; después, los reintentos por orden de espera.
        .orderBy('next_attempt_at', (ob) => ob.asc().nullsFirst())
        .orderBy('id')
        .limit(limite)
        .execute();
      return filas.map((f) => ({ id: f.id, tenantId: f.tenant_id }));
    });
  }

  barberiasConFinales(maximo: number): Promise<string[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      // Sin created_at (el rol no lo lee), no se puede filtrar por antigüedad aquí. En orden aleatorio, para que
      // con más de `maximo` barberías ninguna se quede siempre fuera de la purga.
      const filas = await trx
        .selectFrom(
          trx
            .selectFrom('notification')
            .select('tenant_id')
            .distinct()
            .where('status', 'in', ESTADOS_FINALES)
            .as('con_finales'),
        )
        .select('tenant_id')
        .orderBy(sql`random()`)
        .limit(maximo)
        .execute();
      return filas.map((f) => f.tenant_id);
    });
  }
}

import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { type PreguntaRegistrada, RegistroDePreguntas } from '../application/ports/registro';

/**
 * T041 de 005 · El registro de preguntas con Kysely (data-model §2): una fila por pregunta en assistant_question, que
 * no tiene columnas para el texto de la pregunta, de la respuesta ni para los argumentos (FR-010, SC-007).
 */
@Injectable()
export class KyselyRegistroDePreguntas extends RegistroDePreguntas {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async registrar(pregunta: PreguntaRegistrada): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('assistant_question')
      .values({
        id: uuidv7(),
        tenant_id: this.tenantContext.actual().valor,
        user_id: pregunta.usuarioId,
        role: pregunta.rol,
        intent: pregunta.intencion,
        result: pregunta.resultado,
        duration_ms: Math.max(0, Math.round(pregunta.duracionMs)),
        tokens_in: pregunta.tokensEntrada,
        tokens_out: pregunta.tokensSalida,
      })
      .execute();
  }
}

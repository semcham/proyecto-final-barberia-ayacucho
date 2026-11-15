import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Allow } from 'class-validator';
import { ActorActual, RequiereOperacion } from '../../../../shared';
import type { ActorDeBarberia } from '../../comun/application/autorizacion';
import type { OperacionAsistenteReportes } from '../../comun/domain/permisos';
import { PreguntarAlAsistente, type RespuestaDelAsistente } from '../application/preguntar-al-asistente';

/** Operación de la matriz de M04 (primera barrera en el RolesGuard; el caso de uso exige la del rol). */
const OperacionM04 = (operacion: OperacionAsistenteReportes) => RequiereOperacion(operacion);

/**
 * Cuerpo de POST /asistente/mensajes (contracts/openapi.yaml de 005, PreguntaAsistente). Aquí solo los dos campos
 * admitidos: el largo, la cantidad de intervenciones y su forma los valida el CASO DE USO, para que una pregunta
 * inválida quede registrada como INVALIDA (T030, SC-007). Un campo de más (tenantId, tenant…) responde 400 (FR-004).
 */
export class PreguntaAsistenteDto {
  @Allow()
  mensaje?: unknown;

  @Allow()
  contexto?: unknown;
}

/** T043 de 005 · POST /asistente/mensajes: una pregunta al asistente, con las herramientas del rol del token. */
@Controller('asistente')
export class AsistenteController {
  constructor(private readonly preguntarAlAsistente: PreguntarAlAsistente) {}

  @Post('mensajes')
  @HttpCode(200)
  @OperacionM04('USAR_ASISTENTE')
  preguntar(
    @ActorActual() actor: ActorDeBarberia,
    @Body() cuerpo: PreguntaAsistenteDto,
  ): Promise<RespuestaDelAsistente> {
    return this.preguntarAlAsistente.ejecutar(actor, { mensaje: cuerpo.mensaje, contexto: cuerpo.contexto });
  }
}

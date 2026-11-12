import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { ActorActual } from '../../../../shared';
import type { Actor } from '../../identidad/application/autorizacion';
import { Operacion } from '../../identidad/presentation/operacion.decorator';
import { CanalDeAvisoDelCliente, type VistaPreferenciaAviso } from '../application/canal-de-aviso';
import { CambioCanalAvisoDto } from './aviso.dto';

/**
 * T118 de 004 · Canal de aviso del cliente con sesión (RF33; FR-016 a FR-018). Solo CLIENTE y solo su propio perfil
 * en la barbería del token: la ruta no recibe ningún identificador de cliente ni de barbería.
 */
@Controller('clientes/yo/aviso')
export class AvisoController {
  constructor(private readonly canal: CanalDeAvisoDelCliente) {}

  /** GET /api/v1/clientes/yo/aviso · Canal, número y texto vigente del consentimiento. */
  @Get()
  @Operacion('GESTIONAR_CANAL_AVISO')
  obtener(@ActorActual() actor: Actor): Promise<VistaPreferenciaAviso> {
    return this.canal.obtener(actor);
  }

  /** PUT /api/v1/clientes/yo/aviso · Elegir canal; WhatsApp exige número y aceptar el texto vigente. */
  @Put()
  @Operacion('GESTIONAR_CANAL_AVISO')
  cambiar(@ActorActual() actor: Actor, @Body() dto: CambioCanalAvisoDto): Promise<VistaPreferenciaAviso> {
    return this.canal.cambiar(actor, {
      canal: dto.canal,
      numeroWhatsapp: dto.numeroWhatsapp ?? undefined,
      aceptaWhatsapp: dto.aceptaWhatsapp,
      versionTexto: dto.versionTexto,
    });
  }

  /** DELETE /api/v1/clientes/yo/aviso/consentimiento-whatsapp · Retira el consentimiento; el canal vuelve a correo. */
  @Delete('consentimiento-whatsapp')
  @HttpCode(204)
  @Operacion('GESTIONAR_CANAL_AVISO')
  async retirar(@ActorActual() actor: Actor): Promise<void> {
    await this.canal.retirar(actor);
  }
}

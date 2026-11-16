import { Injectable } from '@nestjs/common';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { ContextoSolicitudes, type VistaSolicitud } from './comun';
import { type DatosNuevaSolicitud, RegistroDeSolicitud } from './registrar-solicitud';

/**
 * T012 de 007 · POST /datos-personales/solicitudes/en-nombre (FR-003): el propietario registra una solicitud por un
 * cliente de su barbería que la pidió por otro medio (por ejemplo, presencial). Queda quién la registró y
 * `enNombre = true`. Un cliente que no es de esta barbería responde 404 CLIENTE_NO_ENCONTRADO.
 */
@Injectable()
export class RegistrarEnNombre {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly registro: RegistroDeSolicitud,
    private readonly contexto: ContextoSolicitudes,
  ) {}

  async ejecutar(actor: Actor, datos: DatosNuevaSolicitud & { clienteId: string }): Promise<VistaSolicitud> {
    await this.autorizacion.exigir(actor, 'REGISTRAR_SOLICITUD_DATOS_EN_NOMBRE');
    return this.registro.ejecutar(
      actor,
      datos,
      () => this.contexto.clienteDeLaBarberia(datos.clienteId),
      true,
    );
  }
}

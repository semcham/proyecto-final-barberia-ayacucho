import { Injectable } from '@nestjs/common';
import { Clock, type FechaLocal, ZonaHoraria } from '../../../../shared';
import { BarberiasApi } from '../../api-publica';
import type { Actor } from '../../identidad/application/autorizacion';
import { UsuarioRepository } from '../../identidad/application/ports/usuario-repository';
import { PerfilClienteRepository } from '../../clientes/application/ports/perfil-cliente-repository';
import { ClienteNoEncontrado } from '../domain/errores';
import type { SolicitudDatos, Titular } from '../domain/solicitud-datos';
import type { SolicitudConTitular, TitularEnBandeja } from './ports/solicitudes-repository';

/** Una solicitud como la ve su titular (esquema Solicitud de contracts/openapi.yaml de 007). */
export interface VistaSolicitud {
  id: string;
  tipo: SolicitudDatos['tipo'];
  estado: SolicitudDatos['estado'];
  detalle: string | null;
  respuesta: string | null;
  motivo: string | null;
  recibidaEn: string;
  venceEl: string;
  vencida: boolean;
  enAtencionDesde: string | null;
  cerradaEn: string | null;
  enNombre: boolean;
}

/** Una solicitud en la bandeja del propietario, con su titular (esquema SolicitudEnBandeja). */
export interface VistaSolicitudEnBandeja extends VistaSolicitud {
  titular: TitularEnBandeja;
}

export function aVista(solicitud: SolicitudDatos, hoy: FechaLocal): VistaSolicitud {
  return {
    id: solicitud.id,
    tipo: solicitud.tipo,
    estado: solicitud.estado,
    detalle: solicitud.detalle,
    respuesta: solicitud.respuesta,
    motivo: solicitud.motivo,
    recibidaEn: solicitud.recibidaEn.toISOString(),
    venceEl: solicitud.venceEl.toString(),
    vencida: solicitud.vencidaEn(hoy),
    enAtencionDesde: solicitud.enAtencionDesde?.toISOString() ?? null,
    cerradaEn: solicitud.cerradaEn?.toISOString() ?? null,
    enNombre: solicitud.enNombre,
  };
}

export function aVistaEnBandeja(
  { solicitud, titular }: SolicitudConTitular,
  hoy: FechaLocal,
): VistaSolicitudEnBandeja {
  return { ...aVista(solicitud, hoy), titular };
}

export function recursoAuditado(solicitud: SolicitudDatos): string {
  return `solicitud_datos:${solicitud.id};${solicitud.tipo}`;
}

/**
 * T012 de 007 · Lo que comparten los casos de uso de las solicitudes, dentro de la transacción con el tenant del
 * token: la fecha local de la barbería (de ella salen el plazo y "vencida") y el titular de la sesión. El titular sale
 * de `clientes` (perfil del cliente con cuenta) y de `identidad` (membresía del barbero): llamadas internas de M01.
 */
@Injectable()
export class ContextoSolicitudes {
  constructor(
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly perfiles: PerfilClienteRepository,
    private readonly usuarios: UsuarioRepository,
  ) {}

  ahora(): Date {
    return this.reloj.ahora();
  }

  /** Fecha local de hoy en la zona de la barbería del contexto. */
  async hoy(instante: Date = this.reloj.ahora()): Promise<FechaLocal> {
    const { zonaHoraria } = await this.barberias.configuracionAgenda();
    return new ZonaHoraria(zonaHoraria).fechaDe(instante);
  }

  /** El titular de la sesión: su perfil de cliente o su membresía de barbero en la barbería del contexto. */
  async titularDe(actor: Actor): Promise<Titular> {
    if (actor.rol === 'CLIENTE') {
      const perfil = await this.perfiles.porUsuario(actor.usuarioId);
      if (!perfil) throw new ClienteNoEncontrado();
      return { tipo: 'CLIENTE', clienteId: perfil.clienteId };
    }
    const membresia = await this.usuarios.obtenerMembresia(actor.usuarioId);
    // Solo llega aquí un barbero con su membresía validada por la guardia (el propietario no tiene la operación).
    if (!membresia) throw new Error('El barbero de la sesión no tiene membresía en la barbería del contexto');
    return { tipo: 'BARBERO', membresiaId: membresia.id };
  }

  /** Un cliente (con cuenta o presencial) de la barbería del contexto, para "en nombre de". */
  async clienteDeLaBarberia(clienteId: string): Promise<Titular> {
    const perfil = await this.perfiles.porId(clienteId);
    if (!perfil) throw new ClienteNoEncontrado();
    return { tipo: 'CLIENTE', clienteId: perfil.clienteId };
  }
}

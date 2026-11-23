import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { BusDeEventos, Clock, TenantContext } from '../../../../shared';
import { EnlaceDeCuenta, type PropositoEnlace } from '../domain/enlace-de-cuenta';
import { claveDeReemplazoDeEnlace, enlaceDeCuentaSolicitado } from './eventos-de-cuenta';
import { EnlaceDeCuentaRepository } from './ports/enlace-de-cuenta-repository';

/**
 * T040/T042 de 010 · Base común de los enlaces de cuenta (data-model §2 y §6; research R02): en la transacción en curso
 * y con la barbería del contexto (la del enlace, R03), anula los anteriores del mismo propósito, crea el nuevo SIN token
 * y publica `EnlaceDeCuentaSolicitado` por la salida de eventos, con su clave de reemplazo. No envía nada: el correo
 * lo envía M05, que emite el token en ese momento.
 *
 * Los casos de uso de la verificación (fase 4) y de la recuperación (fase 5) la llaman después de comprobar sus
 * límites; con la misma transacción, el enlace y el evento existen solo si la operación se confirma.
 */
@Injectable()
export class SolicitarEnlaceDeCuenta {
  constructor(
    private readonly enlaces: EnlaceDeCuentaRepository,
    private readonly bus: BusDeEventos,
    private readonly tenantContext: TenantContext,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(usuarioId: string, proposito: PropositoEnlace): Promise<EnlaceDeCuenta> {
    const ahora = this.reloj.ahora();
    const tenantId = this.tenantContext.actual().valor;
    await this.enlaces.anularVigentesDe(usuarioId, proposito, ahora);
    const enlace = EnlaceDeCuenta.solicitar(uuidv7(), tenantId, usuarioId, proposito, ahora);
    await this.enlaces.crear(enlace);
    await this.bus.reemplazar(
      claveDeReemplazoDeEnlace(usuarioId, proposito),
      enlaceDeCuentaSolicitado(enlace),
      {
        disponibleDesde: ahora,
      },
    );
    return enlace;
  }
}

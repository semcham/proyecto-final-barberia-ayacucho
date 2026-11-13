import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi, ClientesApi } from '../../../acceso-barberias';
import { AdelantosApi, type ResumenDeAdelanto } from '../../../suscripciones-pagos';
import { TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { BarberoRepository } from '../../catalogo/application/ports/catalogo-repositorios';
import { CitaRepository } from './ports/cita-repository';

/** Un adelanto en la bandeja (contracts/openapi.yaml de 008, AdelantoEnBandeja). */
export interface AdelantoEnBandejaVista {
  citaId: string;
  /** Nombre del cliente (el propietario ya lo ve en la agenda). */
  cliente: string;
  servicio: string;
  barbero: string;
  inicio: string;
  adelanto: ResumenDeAdelanto;
}

export type EstadoDeBandeja = 'POR_REVISAR' | 'POR_DEVOLVER';

/** Tope de la bandeja (maxItems del contrato). */
const MAXIMO = 200;

/**
 * T042 de 008 · Bandeja del propietario (US3; FR-012): los pagos por revisar de su barbería, de la hora límite más
 * próxima a la más lejana, con la cita y el nombre del cliente; o los adelantos por devolver (fase 6). Une
 * AdelantosApi (M03) con las citas de M02 y los nombres de M01, en lote. Sin la captura: se pide aparte, con sesión.
 */
@Injectable()
export class BandejaAdelantos {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly adelantos: AdelantosApi,
    private readonly citas: CitaRepository,
    private readonly barberos: BarberoRepository,
    private readonly clientes: ClientesApi,
    private readonly barberias: BarberiasApi,
  ) {}

  async ejecutar(actor: Actor, estado: EstadoDeBandeja): Promise<AdelantoEnBandejaVista[]> {
    await this.autorizacion.exigir(actor, 'REVISAR_ADELANTO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const adelantos = await this.adelantos.enBandeja(estado, MAXIMO);
      if (adelantos.length === 0) return [];
      const citas = new Map((await this.citas.porIds(adelantos.map((a) => a.citaId))).map((c) => [c.id, c]));
      const nombresBarberos = new Map((await this.barberos.listar()).map((b) => [b.id, b.nombre]));
      const clientes = new Map(
        (await this.clientes.datosDeContacto([...new Set([...citas.values()].map((c) => c.clienteId))])).map(
          (p) => [p.clienteId, p.nombre],
        ),
      );
      const zona = new ZonaHoraria((await this.barberias.configuracionAgenda()).zonaHoraria);
      return adelantos.flatMap((adelanto) => {
        const cita = citas.get(adelanto.citaId);
        if (!cita) return [];
        return [
          {
            citaId: cita.id,
            cliente: clientes.get(cita.clienteId) ?? '',
            servicio: cita.servicio.nombre,
            barbero: nombresBarberos.get(cita.barberoId) ?? '',
            inicio: zona.formatoIso(cita.rango.inicio),
            adelanto,
          },
        ];
      });
    });
  }
}

import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi, ClientesApi } from '../../../acceso-barberias';
import { TenantId, UnitOfWork } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { BarberoRepository } from '../../catalogo/application/ports/catalogo-repositorios';
import { CitaRepository } from './ports/cita-repository';
import { aVista, type CitaVista } from './reservar-cita';

/** Página del historial (esquema PaginaCitas del contrato de 002). */
export interface PaginaCitasVista {
  total: number;
  pagina: number;
  tamano: number;
  elementos: CitaVista[];
}

/**
 * T122 · Historial del cliente en la barbería de su sesión (RF17; R16): sus citas en cualquier estado, por
 * inicio descendente, con paginación simple (tercera línea de corte: sin filtros). El cliente sale del
 * token (`ClientesApi.perfilDeSesion`): nunca ve citas de otro cliente ni de otra barbería.
 */
@Injectable()
export class ConsultarHistorial {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly clientes: ClientesApi,
    private readonly citas: CitaRepository,
    private readonly barberos: BarberoRepository,
    private readonly barberias: BarberiasApi,
  ) {}

  async ejecutar(actor: Actor, pagina: number, tamano: number): Promise<PaginaCitasVista> {
    await this.autorizacion.exigir(actor, 'VER_HISTORIAL');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const perfil = await this.clientes.perfilDeSesion(actor.usuarioId);
      if (!perfil) return { total: 0, pagina, tamano, elementos: [] };

      const { total, citas } = await this.citas.delCliente(perfil.clienteId, pagina, tamano);
      if (citas.length === 0) return { total, pagina, tamano, elementos: [] };
      const agenda = await this.barberias.configuracionAgenda();
      const nombres = new Map((await this.barberos.listar()).map((b) => [b.id, b.nombre]));
      return {
        total,
        pagina,
        tamano,
        elementos: citas.map((cita) => aVista(cita, agenda, nombres.get(cita.barberoId) ?? '')),
      };
    });
  }
}

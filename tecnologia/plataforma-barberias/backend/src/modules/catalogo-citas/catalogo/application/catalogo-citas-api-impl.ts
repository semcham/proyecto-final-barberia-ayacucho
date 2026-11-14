import { Injectable } from '@nestjs/common';
import { BarberiasApi } from '../../../acceso-barberias';
import type { TenantId } from '../../../../shared';
import {
  type BarberoVisible,
  CatalogoCitasApi,
  type ConsultaDeHorariosLibres,
  type ContextoDeLaBarberia,
} from '../../catalogo-citas-api';
import {
  type ActividadDeCitas,
  type ConteosDeCitas,
  ReportesDeCitasQuery,
  type ServicioSolicitado,
} from '../../citas/application/ports/reportes-de-citas';
import { ConsultarHorarios, type HorariosLibresVista } from './consultar-horarios';
import { CatalogQuery, type ServicioPublico } from './ports/catalog-query';
import { FuenteDisponibilidad } from './ports/fuente-disponibilidad';

/**
 * T009 de 005 · Implementación de CatalogoCitasApi (research R01). Solo lee: reutiliza CatalogQuery, el cálculo de
 * horarios de ConsultarHorarios con la fuente autenticada que ya provee el módulo y la lectura de agregados. Todas las
 * lecturas, salvo contextoDeLaBarberia, corren en la transacción del llamador (M04 la abre con el tenant del token).
 */
@Injectable()
export class CatalogoCitasApiImpl extends CatalogoCitasApi {
  constructor(
    private readonly barberias: BarberiasApi,
    private readonly catalogo: CatalogQuery,
    private readonly consultarHorarios: ConsultarHorarios,
    private readonly fuenteConSesion: FuenteDisponibilidad,
    private readonly reportes: ReportesDeCitasQuery,
  ) {
    super();
  }

  async contextoDeLaBarberia(tenantId: TenantId): Promise<ContextoDeLaBarberia> {
    const datos = await this.barberias.datosPublicos(tenantId);
    if (!datos) throw new Error('La barbería pedida no existe');
    return { nombre: datos.nombre, zonaHoraria: datos.zonaHoraria, slug: datos.slug };
  }

  serviciosActivos(): Promise<ServicioPublico[]> {
    return this.catalogo.serviciosActivosPublicos();
  }

  async barberosQueOfrecen(servicioId: string): Promise<BarberoVisible[]> {
    const barberos = await this.catalogo.barberosQueOfrecen(servicioId);
    return barberos.map((barbero) => ({ barberoId: barbero.barberoId, nombre: barbero.nombre }));
  }

  async horariosLibres(consulta: ConsultaDeHorariosLibres): Promise<HorariosLibresVista> {
    const { zonaHoraria } = await this.barberias.configuracionAgenda();
    return this.consultarHorarios.ejecutar(this.fuenteConSesion, zonaHoraria, consulta);
  }

  conteosDeCitas(inicio: Date, fin: Date): Promise<ConteosDeCitas> {
    return this.reportes.conteos(inicio, fin);
  }

  serviciosMasSolicitados(inicio: Date, fin: Date, limite: number): Promise<ServicioSolicitado[]> {
    return this.reportes.serviciosMasSolicitados(inicio, fin, limite);
  }

  async actividad(inicio: Date, fin: Date): Promise<ActividadDeCitas> {
    const { zonaHoraria } = await this.barberias.configuracionAgenda();
    return this.reportes.actividad(inicio, fin, zonaHoraria);
  }
}

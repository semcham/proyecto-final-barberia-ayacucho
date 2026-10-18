import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BarberiaNoDisponible, BarberiasApi } from '../../../acceso-barberias';
import { Publica } from '../../../../shared';
import { ConsultarHorarios, type HorariosLibresVista } from '../application/consultar-horarios';
import { CatalogoPublicoRepository } from '../infrastructure/publico/catalogo-publico.repository';
import { ConsultaHorariosDto } from './horarios.dto';

/** Solicitudes por IP y minuto a la vía pública (configurable para las pruebas). */
const limitePublico = () => Number(process.env.PUBLICO_LIMITE_POR_MINUTO ?? 120);

/**
 * T072 · Vía pública por enlace (RF10, RF11; ADR-021). Solo GET, sin sesión: no lee `Authorization` (un
 * token enviado no cambia nada). El `slug` lo resuelve M01; si no existe, cambió o la barbería está
 * suspendida, la respuesta es la misma: 404 `BARBERIA_NO_DISPONIBLE` (FR-022).
 */
@Controller('publico')
@Publica()
@Throttle({ general: { limit: limitePublico, ttl: 60_000 } })
export class PublicoController {
  constructor(
    private readonly barberias: BarberiasApi,
    private readonly repositorio: CatalogoPublicoRepository,
    private readonly consultarHorarios: ConsultarHorarios,
  ) {}

  /** GET /api/v1/publico/:slug · Barbería, horario de atención, servicios y barberos activos. */
  @Get(':slug')
  async catalogo(@Param('slug') slug: string) {
    const { tenantId, barberia } = await this.barberiaDelEnlace(slug);
    const datos = await this.repositorio.catalogo(tenantId);
    return { barberia, ...datos };
  }

  /** GET /api/v1/publico/:slug/horarios · Horas de inicio libres por servicio, fecha y barbero opcional. */
  @Get(':slug/horarios')
  async horarios(
    @Param('slug') slug: string,
    @Query() consulta: ConsultaHorariosDto,
  ): Promise<HorariosLibresVista> {
    const { tenantId, barberia } = await this.barberiaDelEnlace(slug);
    return this.consultarHorarios.ejecutar(this.repositorio.fuente(tenantId), barberia.zonaHoraria, {
      servicioId: consulta.servicio,
      fecha: consulta.fecha,
      barberoId: consulta.barbero,
    });
  }

  private async barberiaDelEnlace(slug: string) {
    const tenantId = await this.barberias.resolverSlugPublico(slug);
    const barberia = await this.barberias.datosPublicos(tenantId);
    // Suspendida entre las dos lecturas: misma respuesta que un enlace inexistente.
    if (!barberia) throw new BarberiaNoDisponible();
    return {
      tenantId,
      // Objeto cerrado con las columnas públicas del contrato (CatalogoPublico.barberia).
      barberia: {
        nombre: barberia.nombre,
        slug: barberia.slug,
        direccion: barberia.direccion,
        telefono: barberia.telefono,
        descripcion: barberia.descripcion,
        zonaHoraria: barberia.zonaHoraria,
      },
    };
  }
}

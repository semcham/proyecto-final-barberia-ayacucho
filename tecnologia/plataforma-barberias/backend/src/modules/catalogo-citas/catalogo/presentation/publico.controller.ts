import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BarberiasApi } from '../../../acceso-barberias';
import { Publica } from '../../../../shared';
import { ConsultarHorarios, type HorariosLibresVista } from '../application/consultar-horarios';
import { ObtenerCatalogoPublico } from '../application/obtener-catalogo-publico';
import { CatalogoPublicoQuery } from '../application/ports/catalogo-publico-query';
import { ConsultaHorariosDto } from './horarios.dto';

/** Solicitudes por IP y minuto a la vía pública (configurable para las pruebas). */
const limitePublico = () => Number(process.env.PUBLICO_LIMITE_POR_MINUTO ?? 120);

/**
 * T072 · Vía pública por enlace (RF10, RF11; ADR-021). Solo GET, sin sesión: no lee `Authorization` (un
 * token enviado no cambia nada). El `slug` lo resuelve M01; si no existe, cambió o la barbería está
 * suspendida, la respuesta es la misma: 404 `BARBERIA_NO_DISPONIBLE` (FR-022).
 *
 * 006 (T039): el enlace y los datos de la barbería se leen en cada solicitud, en una transacción de M01; el
 * catálogo sale de la caché compartida por barbería (R07) y los horarios usan esa entrada si ya existe, sin
 * llenarla, y leen siempre vigente la ocupación del día (R11).
 */
@Controller('publico')
@Publica()
@Throttle({ general: { limit: limitePublico, ttl: 60_000 } })
export class PublicoController {
  constructor(
    private readonly barberias: BarberiasApi,
    private readonly obtenerCatalogo: ObtenerCatalogoPublico,
    private readonly consulta: CatalogoPublicoQuery,
    private readonly consultarHorarios: ConsultarHorarios,
  ) {}

  /** GET /api/v1/publico/:slug · Barbería, horario de atención, servicios y barberos activos. */
  @Get(':slug')
  async catalogo(@Param('slug') slug: string) {
    const { tenantId, barberia } = await this.barberiaDelEnlace(slug);
    return { barberia, ...(await this.obtenerCatalogo.ejecutar(tenantId)) };
  }

  /** GET /api/v1/publico/:slug/horarios · Horas de inicio libres por servicio, fecha y barbero opcional. */
  @Get(':slug/horarios')
  async horarios(
    @Param('slug') slug: string,
    @Query() consulta: ConsultaHorariosDto,
  ): Promise<HorariosLibresVista> {
    const { tenantId, barberia } = await this.barberiaDelEnlace(slug);
    const entrada = await this.obtenerCatalogo.soloDesdeCache(tenantId);
    const fuente = entrada
      ? this.consulta.fuenteDelDia(tenantId, entrada)
      : this.consulta.fuenteCompleta(tenantId);
    return this.consultarHorarios.ejecutar(fuente, barberia.zonaHoraria, {
      servicioId: consulta.servicio,
      fecha: consulta.fecha,
      barberoId: consulta.barbero,
    });
  }

  private async barberiaDelEnlace(slug: string) {
    const { tenantId, barberia } = await this.barberias.barberiaPublicaPorEnlace(slug);
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

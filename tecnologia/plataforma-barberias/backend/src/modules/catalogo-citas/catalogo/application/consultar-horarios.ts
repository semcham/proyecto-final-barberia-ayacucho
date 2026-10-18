import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi } from '../../../acceso-barberias';
import { Clock, Configuracion, FechaLocal, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { calcularHorariosLibres } from '../domain/calculadora-horarios';
import { AutorizacionCatalogoCitas } from './autorizacion';
import { FuenteDisponibilidad } from './ports/fuente-disponibilidad';

const MINUTO_MS = 60 * 1000;

export interface ConsultaHorarios {
  servicioId: string;
  /** Fecha local de la barbería, YYYY-MM-DD. */
  fecha: string;
  barberoId?: string;
}

/** Horarios libres como los devuelve la API (esquema HorariosLibres del contrato de 002). */
export interface HorariosLibresVista {
  fecha: string;
  zonaHoraria: string;
  calculadoEn: string;
  servicioId: string;
  horas: { inicio: string; barberoIds: string[] }[];
}

/**
 * T069 · Horarios libres de un día (RF11, research R08). Convierte la fecha local en instantes con la zona
 * de la barbería, aplica el paso y el horizonte de la configuración y deja el cálculo a la función pura del
 * dominio. Las dos vías (pública y con sesión) usan este mismo cálculo; solo cambia la fuente de los datos.
 */
@Injectable()
export class ConsultarHorarios {
  constructor(
    private readonly configuracion: Configuracion,
    private readonly reloj: Clock,
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly barberias: BarberiasApi,
    private readonly fuenteConSesion: FuenteDisponibilidad,
  ) {}

  /** Vía autenticada (GET /horarios): tenant del token y la fuente con la transacción de ese tenant. */
  async conSesion(actor: Actor, consulta: ConsultaHorarios): Promise<HorariosLibresVista> {
    await this.autorizacion.exigir(actor, 'CONSULTAR_HORARIOS');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const { zonaHoraria } = await this.barberias.configuracionAgenda();
      return this.ejecutar(this.fuenteConSesion, zonaHoraria, consulta);
    });
  }

  async ejecutar(
    fuente: FuenteDisponibilidad,
    zonaHoraria: string,
    consulta: ConsultaHorarios,
  ): Promise<HorariosLibresVista> {
    const fecha = FechaLocal.de(consulta.fecha);
    const zona = new ZonaHoraria(zonaHoraria);
    const ahora = this.reloj.ahora();
    const momento = zona.aLocal(ahora);
    const diasDesdeHoy = fecha.diasDesde(momento.fecha);
    const { pasoMinutos, horizonteDias } = this.configuracion.horarios;
    const vista: HorariosLibresVista = {
      fecha: fecha.toString(),
      zonaHoraria: zona.nombre,
      calculadoEn: zona.formatoIso(ahora),
      servicioId: consulta.servicioId,
      horas: [],
    };
    // Fecha pasada o fuera del horizonte: no hay horas y no hace falta leer nada.
    if (diasDesdeHoy < 0 || diasDesdeHoy > horizonteDias) return vista;

    const desde = zona.inicioDelDia(fecha);
    const hasta = zona.finDelDia(fecha);
    const datos = await fuente.datosDelDia({
      servicioId: consulta.servicioId,
      barberoId: consulta.barberoId,
      fecha,
      desde,
      hasta,
    });
    if (datos.duracionMin === null) return vista;

    // Instante → minutos del día local. Los inicios se redondean hacia abajo y los fines hacia arriba: una
    // ocupación nunca se achica. Los días locales tienen siempre 1440 minutos en las zonas admitidas (R07).
    const minutos = (instante: Date, redondeo: (x: number) => number) =>
      redondeo((instante.getTime() - desde.getTime()) / MINUTO_MS);
    const libres = calcularHorariosLibres({
      atencion: datos.atencion,
      barberos: datos.barberos.map((barbero) => ({
        ...barbero,
        ocupado: datos.ocupacion
          .filter((o) => o.barberoId === barbero.barberoId)
          .map((o) => ({
            inicioMin: minutos(o.inicio, Math.floor),
            finMin: minutos(o.fin, Math.ceil),
            estadoCita: o.estadoCita,
          })),
      })),
      duracionMin: datos.duracionMin,
      pasoMin: pasoMinutos,
      diasDesdeHoy,
      ahoraMin: momento.minutos,
      horizonteDias,
      barberoId: consulta.barberoId,
    });
    vista.horas = libres.map((libre) => ({
      inicio: zona.formatoIso(zona.aInstante(fecha, libre.inicioMin)),
      barberoIds: libre.barberoIds,
    }));
    return vista;
  }
}

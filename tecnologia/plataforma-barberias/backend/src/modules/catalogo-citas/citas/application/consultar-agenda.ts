import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi, ClientesApi } from '../../../acceso-barberias';
import { FechaLocal, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { BarberoRepository, HorarioRepository } from '../../catalogo/application/ports/catalogo-repositorios';
import { CatalogQuery } from '../../catalogo/application/ports/catalog-query';
import { AccesoDenegado } from '../../catalogo/domain/errores';
import { type IntervaloDelDia, MarcaConflicto } from '../domain/marca-conflicto';
import { CitaRepository } from './ports/cita-repository';
import { aVista, type CitaVista } from './reservar-cita';

const MINUTO_MS = 60 * 1000;

/** Cita de la agenda (esquema CitaAgenda del contrato de 002). */
export interface CitaAgendaVista extends CitaVista {
  barberoId: string;
  cliente: { nombre: string; telefono: string };
  enConflicto: boolean;
}

export interface AgendaVista {
  fecha: string;
  zonaHoraria: string;
  citas: CitaAgendaVista[];
}

/**
 * T107 · Agenda del día por barbero (RF16; R10, R16). El PROPIETARIO ve toda la barbería (con filtro por
 * barbero); el BARBERO, solo la del barbero vinculado a su usuario (sin vínculo o con otro barbero → 403).
 * La marca "en conflicto" se calcula al leer con los bloqueos y los tramos vigentes del día. Los datos de
 * contacto de los clientes llegan en lote desde M01 (sin N+1).
 */
@Injectable()
export class ConsultarAgenda {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly citas: CitaRepository,
    private readonly barberos: BarberoRepository,
    private readonly horarios: HorarioRepository,
    private readonly catalogo: CatalogQuery,
    private readonly clientes: ClientesApi,
    private readonly barberias: BarberiasApi,
  ) {}

  async ejecutar(actor: Actor, consulta: { fecha: string; barberoId?: string }): Promise<AgendaVista> {
    const alcance = await this.autorizacion.exigir(actor, 'VER_AGENDA');
    const fecha = FechaLocal.de(consulta.fecha);

    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      let barberoId = consulta.barberoId;
      if (alcance === 'PROPIOS') {
        const propio = await this.barberos.porUsuario(actor.usuarioId);
        if (!propio || (barberoId !== undefined && barberoId !== propio.id)) throw new AccesoDenegado();
        barberoId = propio.id;
      }

      const agenda = await this.barberias.configuracionAgenda();
      const zona = new ZonaHoraria(agenda.zonaHoraria);
      const desde = zona.inicioDelDia(fecha);
      const hasta = zona.finDelDia(fecha);
      const citas = await this.citas.delRango(desde, hasta, barberoId);
      const vista: AgendaVista = { fecha: fecha.toString(), zonaHoraria: zona.nombre, citas: [] };
      if (citas.length === 0) return vista;

      // Instante → minutos del día local (los inicios hacia abajo y los fines hacia arriba).
      const minutos = (instante: Date, redondeo: (x: number) => number) =>
        redondeo((instante.getTime() - desde.getTime()) / MINUTO_MS);
      const intervalo = (inicio: Date, fin: Date): IntervaloDelDia => ({
        inicioMin: minutos(inicio, Math.floor),
        finMin: minutos(fin, Math.ceil),
      });

      const dia = fecha.diaSemana;
      const nombres = new Map((await this.barberos.listar()).map((b) => [b.id, b.nombre]));
      const atencion = (await this.horarios.atencion()).tramosDe(dia);
      const porBarbero = new Map<
        string,
        { disponibilidad: IntervaloDelDia[]; bloqueos: IntervaloDelDia[] }
      >();
      for (const id of new Set(citas.map((c) => c.barberoId))) {
        const disponibilidad = (await this.horarios.disponibilidad(id)).tramosDe(dia);
        const bloqueos = await this.catalogo.bloqueosEnRango(id, desde, hasta);
        porBarbero.set(id, {
          disponibilidad: disponibilidad.map((t) => ({ inicioMin: t.inicioMin, finMin: t.finMin })),
          bloqueos: bloqueos.map((b) => intervalo(b.inicio, b.fin)),
        });
      }
      const contactos = new Map(
        (await this.clientes.datosDeContacto(citas.map((c) => c.clienteId))).map((p) => [p.clienteId, p]),
      );

      vista.citas = citas.map((cita) => {
        const contexto = porBarbero.get(cita.barberoId) as {
          disponibilidad: IntervaloDelDia[];
          bloqueos: IntervaloDelDia[];
        };
        // Solo una cita activa puede estar en conflicto: las finalizadas o canceladas ya no ocupan la agenda.
        const enConflicto =
          cita.ocupaHorario() &&
          MarcaConflicto.de({
            cita: intervalo(cita.rango.inicio, cita.rango.fin),
            bloqueos: contexto.bloqueos,
            atencion,
            disponibilidad: contexto.disponibilidad,
          }) !== null;
        const contacto = contactos.get(cita.clienteId);
        return {
          ...aVista(cita, agenda, nombres.get(cita.barberoId) ?? ''),
          barberoId: cita.barberoId,
          cliente: { nombre: contacto?.nombre ?? '', telefono: contacto?.telefono ?? '' },
          enConflicto,
        };
      });
      return vista;
    });
  }
}

import { Injectable } from '@nestjs/common';
import { CatalogoCitasApi, type ContextoDeLaBarberia } from '../../../catalogo-citas';
import { SuscripcionesApi } from '../../../suscripciones-pagos';
import {
  AuditLog,
  Clock,
  Configuracion,
  FechaLocal,
  Interruptor,
  TenantId,
  UnitOfWork,
  ZonaHoraria,
} from '../../../../shared';
import { type ActorDeBarberia, AutorizacionAsistenteReportes } from '../../comun/application/autorizacion';
import { resolverPorNombre, validarFechaDeHorarios } from '../domain/argumentos';
import { type Entrada, EntradaInvalida, validarEntrada } from '../domain/entrada';
import { AsistenteNoDisponible, CuotaAsistenteAgotada } from '../domain/errores';
import { intencionesPermitidas, type RolDelAsistente, tieneAsistente } from '../domain/herramientas';
import { type IntencionValidada, validarIntencion } from '../domain/intencion';
import {
  type ContextoDeLaRespuesta,
  plantillaAccionNoPermitida,
  plantillaBarberos,
  plantillaFueraDeAlcance,
  plantillaHorarios,
  plantillaServicios,
  plantillaSinDatos,
  type RespuestaCompuesta,
} from '../domain/plantillas';
import { cuotaDelMomento, limitesDeCuota } from '../domain/politica-cuota';
import { AIProvider, type Interpretacion, ProveedorIANoDisponible } from './ports/ai-provider';
import { AlcanceAgotado, CuotasDelAsistente, type UsoDeLaCuota } from './ports/cuotas';
import { RegistroDePreguntas, type ResultadoDeLaPregunta } from './ports/registro';

/** El cuerpo de POST /asistente/mensajes, sin validar (lo valida el caso de uso: T030). */
export interface PreguntaDelCliente {
  mensaje?: unknown;
  contexto?: unknown;
}

export interface RespuestaDelAsistente extends RespuestaCompuesta {
  cuota: { restantesUsuario: number; restantesBarberia: number; reiniciaEn: string };
}

/** SC-003: la respuesta (también la de "no disponible") llega en 3 s o menos desde la solicitud. */
const PRESUPUESTO_MS = 3000;
/**
 * Lo que se reserva dentro del presupuesto para lo que no es el proveedor: el guardia, la cuota (tramo 1) y la
 * herramienta, la devolución, el registro y la auditoría (tramo 3). Medido: unos 200 ms con una pregunta y unos 600 ms
 * con 10 preguntas a la vez de la misma barbería (T034). Por eso la llamada al proveedor termina, a más tardar, 2,1 s
 * después del inicio, aunque IA_TIEMPO_LIMITE_MS sea mayor.
 */
const RESERVA_PARA_RESPONDER_MS = 900;
/** Lo mínimo que tiene que quedar para que valga la pena el único reintento. */
const MINIMO_PARA_REINTENTAR_MS = 200;

/**
 * T042 de 005 · Una pregunta al asistente (US1 y, desde la fase 4, US3), con los TRES TRAMOS de contracts/asistente.md
 * §1 y research R08:
 * 1. cuota: una transacción corta suma las dos cuotas y CONFIRMA antes de llamar al proveedor;
 * 2. proveedor: fuera de toda transacción (no retiene la fila de la cuota de la barbería), con el tiempo límite, un
 *    reintento ante 429 o 5xx dentro del presupuesto de 3 s y el Interruptor de M06 (5 fallas en 60 s, pausa de 30 s);
 * 3. resultado: otra transacción ejecuta la herramienta del rol (solo lecturas por CatalogoCitasApi y SuscripcionesApi),
 *    compone con plantillas, registra y audita; o, si el proveedor falló, devuelve la cuota, registra y audita.
 * El modelo solo clasifica: su texto nunca llega al usuario (FR-001), y no recibe el catálogo ni los resultados de
 * las herramientas (FR-011). La barbería es siempre la del token (FR-004).
 */
@Injectable()
export class PreguntarAlAsistente {
  private readonly interruptor: Interruptor;

  constructor(
    private readonly autorizacion: AutorizacionAsistenteReportes,
    private readonly catalogoCitas: CatalogoCitasApi,
    private readonly suscripciones: SuscripcionesApi,
    private readonly proveedor: AIProvider,
    private readonly cuotas: CuotasDelAsistente,
    private readonly registro: RegistroDePreguntas,
    private readonly auditoria: AuditLog,
    private readonly uow: UnitOfWork,
    private readonly reloj: Clock,
    private readonly configuracion: Configuracion,
  ) {
    this.interruptor = new Interruptor({ fallosParaAbrir: 5, ventanaMs: 60_000, pausaMs: 30_000, reloj });
  }

  async ejecutar(actor: ActorDeBarberia, pregunta: PreguntaDelCliente): Promise<RespuestaDelAsistente> {
    const inicio = Date.now();
    const tenantId = TenantId.de(actor.tenantId);

    // El permiso del rol (el guardia ya exigió USAR_ASISTENTE). El barbero no tiene asistente; el propietario, tampoco
    // hasta la fase 4 (US3): sin herramientas, 403 auditado.
    const rol: RolDelAsistente = actor.rol === 'PROPIETARIO' ? 'PROPIETARIO' : 'CLIENTE';
    await this.autorizacion.exigir(
      actor,
      rol === 'CLIENTE' ? 'USAR_ASISTENTE_CLIENTE' : 'USAR_ASISTENTE_PROPIETARIO',
    );
    if (!tieneAsistente(rol)) await this.autorizacion.denegar(actor, 'USAR_ASISTENTE_PROPIETARIO');

    let entrada: Entrada;
    try {
      entrada = validarEntrada(pregunta);
    } catch (error) {
      if (error instanceof EntradaInvalida) {
        await this.uow.ejecutar(tenantId, () => this.registrar(actor, rol, null, 'INVALIDA', inicio, null));
      }
      throw error;
    }

    const barberia = await this.catalogoCitas.contextoDeLaBarberia(tenantId);
    const zona = new ZonaHoraria(barberia.zonaHoraria);
    const ahora = this.reloj.ahora();
    const momento = cuotaDelMomento(ahora, zona);
    const limites = limitesDeCuota(this.configuracion.ia);

    // Tramo 1: la cuota, en una transacción corta que confirma antes de llamar al proveedor.
    let uso: UsoDeLaCuota;
    try {
      uso = await this.uow.ejecutar(tenantId, () => this.cuotas.sumar(actor.usuarioId, momento.dia, limites));
    } catch (error) {
      if (!(error instanceof AlcanceAgotado)) throw error;
      // La suma se revirtió: la pregunta queda registrada en una transacción propia.
      await this.uow.ejecutar(tenantId, () =>
        this.registrar(actor, rol, null, 'CUOTA_AGOTADA', inicio, null),
      );
      throw new CuotaAsistenteAgotada(
        error.alcance,
        zona.formatoIso(momento.reiniciaEn),
        momento.reintentarEnSegundos,
      );
    }

    // Tramo 2: el proveedor, fuera de toda transacción.
    const interpretacion = await this.interpretar(
      {
        rol,
        intencionesPermitidas: intencionesPermitidas(rol),
        hoy: momento.dia,
        zonaHoraria: zona.nombre,
        pregunta: entrada.mensaje,
        contexto: entrada.contexto,
      },
      inicio,
    );

    // Tramo 3: la herramienta, el registro y la auditoría (o la devolución de la cuota), en otra transacción.
    const respuesta = await this.uow.ejecutar(tenantId, async () => {
      if (!interpretacion) {
        await this.cuotas.devolver(actor.usuarioId, momento.dia);
        await this.registrar(actor, rol, null, 'PROVEEDOR_NO_DISPONIBLE', inicio, null);
        return null;
      }
      const validada = validarIntencion(rol, interpretacion);
      const compuesta = await this.responder(rol, validada, barberia, tenantId, momento.dia);
      await this.registrar(actor, rol, validada.tipo, compuesta.resultado, inicio, interpretacion);
      return compuesta;
    });
    if (!respuesta) throw new AsistenteNoDisponible(rol === 'CLIENTE' ? 'RESERVAR' : 'REPORTES');

    return {
      ...respuesta,
      cuota: {
        restantesUsuario: Math.max(0, limites.usuario - uso.usuario),
        restantesBarberia: Math.max(0, limites.barberia - uso.barberia),
        reiniciaEn: zona.formatoIso(momento.reiniciaEn),
      },
    };
  }

  /**
   * El proveedor con el tiempo límite, UN reintento ante 429 o 5xx si queda presupuesto, y el interruptor. Cualquier
   * falla (incluido el circuito abierto) es null: el tramo 3 devuelve la cuota y se responde 503.
   */
  private interpretar(
    solicitud: Parameters<AIProvider['interpretar']>[0],
    inicio: number,
  ): Promise<Interpretacion | null> {
    const limite = inicio + PRESUPUESTO_MS - RESERVA_PARA_RESPONDER_MS;
    const intentar = () => {
      const restante = limite - Date.now();
      if (restante <= 0) throw new ProveedorIANoDisponible('TIEMPO_AGOTADO');
      const tiempo = Math.min(this.configuracion.ia.tiempoLimiteMs, restante);
      return this.proveedor.interpretar(solicitud, AbortSignal.timeout(tiempo));
    };
    return this.interruptor.ejecutar<Interpretacion | null>(
      async () => {
        try {
          return await intentar();
        } catch (error) {
          const reintentable = error instanceof ProveedorIANoDisponible && error.reintentable;
          if (reintentable && limite - Date.now() > MINIMO_PARA_REINTENTAR_MS) return await intentar();
          throw error;
        }
      },
      () => null,
    );
  }

  /** La herramienta del rol, de solo lectura, y la plantilla. */
  private async responder(
    rol: RolDelAsistente,
    validada: IntencionValidada,
    barberia: ContextoDeLaBarberia,
    tenantId: TenantId,
    hoy: string,
  ): Promise<RespuestaCompuesta> {
    const ctx: ContextoDeLaRespuesta = {
      barberia: barberia.nombre,
      slug: barberia.slug,
      aceptaReservas: false,
    };
    switch (validada.tipo) {
      case 'fuera_de_alcance':
        return plantillaFueraDeAlcance(ctx, rol);
      case 'accion_no_permitida':
        return plantillaAccionNoPermitida(ctx);
      case 'servicios':
        return plantillaServicios(ctx, await this.catalogoCitas.serviciosActivos());
      case 'barberos': {
        const servicio = await this.servicioPedido(ctx, validada.servicio);
        if ('resultado' in servicio) return servicio;
        return plantillaBarberos(
          ctx,
          servicio,
          await this.catalogoCitas.barberosQueOfrecen(servicio.servicioId),
        );
      }
      case 'horarios_libres':
        return this.horarios(ctx, validada, tenantId, hoy);
      // Herramientas del propietario (fase 4, US3): el esquema todavía no se las da a ningún rol.
      case 'resumen_citas':
      case 'servicios_mas_pedidos':
        return plantillaFueraDeAlcance(ctx, rol);
    }
  }

  /** El servicio pedido, resuelto SOLO entre los activos de la barbería del token; o la respuesta SIN_DATOS. */
  private async servicioPedido(
    ctx: ContextoDeLaRespuesta,
    nombre: string | undefined,
  ): Promise<{ servicioId: string; nombre: string } | RespuestaCompuesta> {
    const servicios = await this.catalogoCitas.serviciosActivos();
    const nombres = servicios.map((s) => s.nombre);
    if (!nombre) return plantillaSinDatos(ctx, { tipo: 'falta_servicio', servicios: nombres });
    const resolucion = resolverPorNombre(nombre, servicios);
    if (resolucion.tipo === 'ninguno')
      return plantillaSinDatos(ctx, { tipo: 'servicio_no_encontrado', servicios: nombres });
    if (resolucion.tipo === 'varios') {
      return plantillaSinDatos(ctx, {
        tipo: 'servicio_ambiguo',
        opciones: resolucion.opciones.map((s) => s.nombre),
      });
    }
    return { servicioId: resolucion.valor.servicioId, nombre: resolucion.valor.nombre };
  }

  private async horarios(
    ctx: ContextoDeLaRespuesta,
    validada: Extract<IntencionValidada, { tipo: 'horarios_libres' }>,
    tenantId: TenantId,
    hoy: string,
  ): Promise<RespuestaCompuesta> {
    const servicio = await this.servicioPedido(ctx, validada.servicio);
    if ('resultado' in servicio) return servicio;
    if (!validada.fecha) return plantillaSinDatos(ctx, { tipo: 'falta_fecha' });
    const fecha = validarFechaDeHorarios(
      validada.fecha,
      FechaLocal.de(hoy),
      this.configuracion.horarios.horizonteDias,
    );
    if (fecha.tipo === 'formato')
      return plantillaSinDatos(ctx, { tipo: 'fecha_invalida', valor: fecha.valor });
    if (fecha.tipo === 'pasada') return plantillaSinDatos(ctx, { tipo: 'fecha_pasada', fecha: fecha.fecha });
    if (fecha.tipo === 'fuera_del_horizonte')
      return plantillaSinDatos(ctx, { tipo: 'fuera_del_horizonte', ultimo: fecha.ultimo });

    const barberos = await this.catalogoCitas.barberosQueOfrecen(servicio.servicioId);
    let barberoId: string | undefined;
    if (validada.barbero) {
      const resolucion = resolverPorNombre(validada.barbero, barberos);
      if (resolucion.tipo === 'ninguno') {
        return plantillaSinDatos(ctx, {
          tipo: 'barbero_no_encontrado',
          barberos: barberos.map((b) => b.nombre),
        });
      }
      if (resolucion.tipo === 'varios') {
        return plantillaSinDatos(ctx, {
          tipo: 'barbero_ambiguo',
          opciones: resolucion.opciones.map((b) => b.nombre),
        });
      }
      barberoId = resolucion.valor.barberoId;
    }
    const vista = await this.catalogoCitas.horariosLibres({
      servicioId: servicio.servicioId,
      fecha: fecha.fecha.toString(),
      barberoId,
    });
    const nombres = new Map(barberos.map((b) => [b.barberoId, b.nombre]));
    const horas = vista.horas.map((hora) => ({
      inicio: hora.inicio,
      barberos: hora.barberoIds
        .filter((id) => nombres.has(id))
        .map((id) => ({ barberoId: id, nombre: nombres.get(id) as string })),
    }));
    // FR-018: ofrecer reservar solo si la suscripción de la barbería lo permite.
    const { aceptaReservas } = await this.suscripciones.estadoOperativo(tenantId);
    return plantillaHorarios({ ...ctx, aceptaReservas }, { servicio, fecha: fecha.fecha, horas, barberoId });
  }

  /** La fila sin texto en assistant_question y la de la auditoría, en la transacción en curso. */
  private async registrar(
    actor: ActorDeBarberia,
    rol: RolDelAsistente,
    intencion: IntencionValidada['tipo'] | null,
    resultado: ResultadoDeLaPregunta,
    inicio: number,
    interpretacion: Interpretacion | null,
  ): Promise<void> {
    await this.registro.registrar({
      usuarioId: actor.usuarioId,
      rol,
      intencion,
      resultado,
      duracionMs: Date.now() - inicio,
      tokensEntrada: interpretacion?.tokensEntrada ?? null,
      tokensSalida: interpretacion?.tokensSalida ?? null,
    });
    await this.auditoria.registrar({
      accion: 'ASISTENTE_CONSULTADO',
      actorId: actor.usuarioId,
      recurso: `asistente:${rol};${resultado}`,
      resultado: 'PERMITIDO',
    });
  }
}

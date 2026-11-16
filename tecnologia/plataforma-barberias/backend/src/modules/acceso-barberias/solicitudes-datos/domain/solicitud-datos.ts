import type { FechaLocal } from '../../../../shared/nucleo';
import { sumarDiasHabiles } from './dias-habiles';
import { SolicitudCerrada, SolicitudYaEnAtencion, ValidacionSolicitud } from './errores';

// T009 de 007 · Solicitud sobre datos personales (data-model §1 de 007; FR-001 a FR-011).
//
// RECIBIDA ──iniciar──▶ EN_ATENCION ──atender(respuesta)──▶ ATENDIDA
//    │                      └──────rechazar(motivo)───────▶ RECHAZADA
//    ├──atender(respuesta)──────────────────────────────▶ ATENDIDA
//    └──rechazar(motivo)────────────────────────────────▶ RECHAZADA
//
// ATENDIDA y RECHAZADA son finales. "Vencida" se calcula al leer (abierta y con el plazo pasado); no se guarda ni
// cierra nada sola. El sistema no borra ni exporta datos: atender solo registra la respuesta (FR-007, FR-008).

export const TIPOS_SOLICITUD = ['ACCESO', 'RECTIFICACION', 'ELIMINACION'] as const;
export type TipoSolicitud = (typeof TIPOS_SOLICITUD)[number];

export const ESTADOS_SOLICITUD = ['RECIBIDA', 'EN_ATENCION', 'ATENDIDA', 'RECHAZADA'] as const;
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];

export type Titular = { tipo: 'CLIENTE'; clienteId: string } | { tipo: 'BARBERO'; membresiaId: string };

/** Plazo interno: 10 días hábiles, por validar contra el plazo legal (FR-004). */
export const DIAS_HABILES_DE_PLAZO = 10;
export const LARGO_MAXIMO_DETALLE = 500;
export const LARGO_MAXIMO_RESPUESTA = 1000;
export const LARGO_MOTIVO = { minimo: 5, maximo: 300 } as const;

export interface NuevaSolicitudDatos {
  id: string;
  tenantId: string;
  tipo: TipoSolicitud;
  titular: Titular;
  detalle: string | null;
  /** La cuenta que la registra: el titular o el propietario "en nombre de". */
  registradaPor: string;
  enNombre: boolean;
  recibidaEn: Date;
  /** Fecha local de la barbería en que se recibe: de ella sale el plazo. */
  fechaLocal: FechaLocal;
}

export interface DatosSolicitud {
  id: string;
  tenantId: string;
  tipo: TipoSolicitud;
  titular: Titular;
  estado: EstadoSolicitud;
  detalle: string | null;
  respuesta: string | null;
  motivo: string | null;
  registradaPor: string;
  enNombre: boolean;
  recibidaEn: Date;
  venceEl: FechaLocal;
  enAtencionDesde: Date | null;
  cerradaEn: Date | null;
  cerradaPor: string | null;
}

/** Quita los espacios de los extremos; vacío cuenta como ausente. */
function texto(valor: string | null | undefined): string | null {
  const limpio = valor?.trim() ?? '';
  return limpio.length > 0 ? limpio : null;
}

export class SolicitudDatos {
  private constructor(private datos: DatosSolicitud) {}

  static registrar(nueva: NuevaSolicitudDatos): SolicitudDatos {
    const detalle = texto(nueva.detalle);
    if (detalle !== null && detalle.length > LARGO_MAXIMO_DETALLE)
      throw new ValidacionSolicitud('detalle', 'largo');
    // Una rectificación debe decir qué dato y cómo corregirlo (FR-001, US1-2).
    if (nueva.tipo === 'RECTIFICACION' && detalle === null)
      throw new ValidacionSolicitud('detalle', 'requerido');
    return new SolicitudDatos({
      id: nueva.id,
      tenantId: nueva.tenantId,
      tipo: nueva.tipo,
      titular: nueva.titular,
      estado: 'RECIBIDA',
      detalle,
      respuesta: null,
      motivo: null,
      registradaPor: nueva.registradaPor,
      enNombre: nueva.enNombre,
      recibidaEn: nueva.recibidaEn,
      venceEl: sumarDiasHabiles(nueva.fechaLocal, DIAS_HABILES_DE_PLAZO),
      enAtencionDesde: null,
      cerradaEn: null,
      cerradaPor: null,
    });
  }

  static reconstruir(datos: DatosSolicitud): SolicitudDatos {
    return new SolicitudDatos({ ...datos });
  }

  get id(): string {
    return this.datos.id;
  }
  get tenantId(): string {
    return this.datos.tenantId;
  }
  get tipo(): TipoSolicitud {
    return this.datos.tipo;
  }
  get titular(): Titular {
    return this.datos.titular;
  }
  get estado(): EstadoSolicitud {
    return this.datos.estado;
  }
  get detalle(): string | null {
    return this.datos.detalle;
  }
  get respuesta(): string | null {
    return this.datos.respuesta;
  }
  get motivo(): string | null {
    return this.datos.motivo;
  }
  get registradaPor(): string {
    return this.datos.registradaPor;
  }
  get enNombre(): boolean {
    return this.datos.enNombre;
  }
  get recibidaEn(): Date {
    return this.datos.recibidaEn;
  }
  get venceEl(): FechaLocal {
    return this.datos.venceEl;
  }
  get enAtencionDesde(): Date | null {
    return this.datos.enAtencionDesde;
  }
  get cerradaEn(): Date | null {
    return this.datos.cerradaEn;
  }
  get cerradaPor(): string | null {
    return this.datos.cerradaPor;
  }

  get abierta(): boolean {
    return this.datos.estado === 'RECIBIDA' || this.datos.estado === 'EN_ATENCION';
  }

  /** Abierta y con el plazo pasado (el mismo día del plazo todavía no está vencida). */
  vencidaEn(hoy: FechaLocal): boolean {
    return this.abierta && hoy.diasDesde(this.datos.venceEl) > 0;
  }

  iniciarAtencion(en: Date): void {
    this.exigirAbierta();
    if (this.datos.estado === 'EN_ATENCION') throw new SolicitudYaEnAtencion();
    this.datos = { ...this.datos, estado: 'EN_ATENCION', enAtencionDesde: en };
  }

  /** La atiende a mano: el sistema solo registra la respuesta (qué se hizo y qué se conserva por obligación). */
  atender(respuesta: string | null | undefined, por: string, en: Date): void {
    this.exigirAbierta();
    const limpia = texto(respuesta);
    if (limpia === null) throw new ValidacionSolicitud('respuesta', 'requerido');
    if (limpia.length > LARGO_MAXIMO_RESPUESTA) throw new ValidacionSolicitud('respuesta', 'largo');
    this.datos = { ...this.datos, estado: 'ATENDIDA', respuesta: limpia, cerradaEn: en, cerradaPor: por };
  }

  rechazar(motivo: string | null | undefined, por: string, en: Date): void {
    this.exigirAbierta();
    const limpio = texto(motivo);
    if (limpio === null) throw new ValidacionSolicitud('motivo', 'requerido');
    if (limpio.length < LARGO_MOTIVO.minimo || limpio.length > LARGO_MOTIVO.maximo) {
      throw new ValidacionSolicitud('motivo', 'largo');
    }
    this.datos = { ...this.datos, estado: 'RECHAZADA', motivo: limpio, cerradaEn: en, cerradaPor: por };
  }

  private exigirAbierta(): void {
    if (!this.abierta) throw new SolicitudCerrada();
  }
}

import { EnlaceNoValido } from './errores';

// T039 de 010 · Enlace de cuenta por correo (data-model §2; research R01 y R02). Mismas reglas que la activación del
// personal (activacion.ts): un solo uso, el mismo error para usado, vencido, anulado o inexistente, y anulación del
// anterior al pedir uno nuevo del mismo propósito. Diferencia: el enlace nace SIN token ("por enviar"); el token se
// emite al enviar el correo (y se reemite en cada reintento, sin mover el vencimiento). Solo se guarda su hash.
//
//   solicitado (sin token) ──emitir──▶ vigente (con hash) ──usar──▶ usado
//         ├──── nueva solicitud del mismo propósito, verificar o cambiar la contraseña ───▶ anulado
//         └──── llega el vencimiento ───▶ vencido (no se marca: se calcula al leer)

export const PROPOSITOS_ENLACE = ['VERIFICAR_CORREO', 'RECUPERAR_CONTRASENA'] as const;
export type PropositoEnlace = (typeof PROPOSITOS_ENLACE)[number];

const HORA_MS = 60 * 60 * 1000;

/** Vigencia de cada propósito: 24 h para verificar el correo (FR-008), 1 h para recuperar la contraseña (FR-019). */
export const VIGENCIA_ENLACE_MS: Readonly<Record<PropositoEnlace, number>> = {
  VERIFICAR_CORREO: 24 * HORA_MS,
  RECUPERAR_CONTRASENA: HORA_MS,
};

export type EstadoEnlace = 'POR_ENVIAR' | 'VIGENTE' | 'USADO' | 'ANULADO' | 'VENCIDO';

export interface DatosEnlaceDeCuenta {
  id: string;
  tenantId: string;
  usuarioId: string;
  proposito: PropositoEnlace;
  solicitadoEn: Date;
  venceEn: Date;
  usadoEn: Date | null;
  anuladoEn: Date | null;
  /** Si ya se emitió un token (se guarda solo su hash, fuera del dominio). */
  conToken: boolean;
}

export class EnlaceDeCuenta {
  private constructor(private datos: DatosEnlaceDeCuenta) {}

  /** Un enlace nuevo, todavía sin token: el token se emite al enviar el correo (R02). */
  static solicitar(
    id: string,
    tenantId: string,
    usuarioId: string,
    proposito: PropositoEnlace,
    ahora: Date,
  ): EnlaceDeCuenta {
    return new EnlaceDeCuenta({
      id,
      tenantId,
      usuarioId,
      proposito,
      solicitadoEn: ahora,
      venceEn: new Date(ahora.getTime() + VIGENCIA_ENLACE_MS[proposito]),
      usadoEn: null,
      anuladoEn: null,
      conToken: false,
    });
  }

  static reconstruir(datos: DatosEnlaceDeCuenta): EnlaceDeCuenta {
    return new EnlaceDeCuenta({ ...datos });
  }

  get id(): string {
    return this.datos.id;
  }
  get tenantId(): string {
    return this.datos.tenantId;
  }
  get usuarioId(): string {
    return this.datos.usuarioId;
  }
  get proposito(): PropositoEnlace {
    return this.datos.proposito;
  }
  get solicitadoEn(): Date {
    return this.datos.solicitadoEn;
  }
  get venceEn(): Date {
    return this.datos.venceEn;
  }
  get usadoEn(): Date | null {
    return this.datos.usadoEn;
  }
  get anuladoEn(): Date | null {
    return this.datos.anuladoEn;
  }

  /** El vencimiento no se guarda como estado: se calcula al leer. */
  estado(ahora: Date): EstadoEnlace {
    if (this.datos.usadoEn) return 'USADO';
    if (this.datos.anuladoEn) return 'ANULADO';
    if (ahora.getTime() >= this.datos.venceEn.getTime()) return 'VENCIDO';
    return this.datos.conToken ? 'VIGENTE' : 'POR_ENVIAR';
  }

  /** Se puede emitir (o reemitir, en un reintento del envío) un token solo mientras no esté usado, anulado ni vencido. */
  puedeEmitirToken(ahora: Date): boolean {
    const estado = this.estado(ahora);
    return estado === 'POR_ENVIAR' || estado === 'VIGENTE';
  }

  /** Registra que se emitió un token. El vencimiento no se mueve. */
  emitirToken(ahora: Date): void {
    if (!this.puedeEmitirToken(ahora)) throw new EnlaceNoValido();
    this.datos.conToken = true;
  }

  /** Un solo uso. Mismo error para usado, vencido, anulado o sin token: no se revela el motivo (FR-005). */
  usar(ahora: Date): void {
    if (this.estado(ahora) !== 'VIGENTE') throw new EnlaceNoValido();
    this.datos.usadoEn = ahora;
  }

  /** Sin efecto si ya está usado o anulado. */
  anular(ahora: Date): void {
    if (this.datos.usadoEn || this.datos.anuladoEn) return;
    this.datos.anuladoEn = ahora;
  }
}

/**
 * Pedir un enlace nuevo anula los anteriores del MISMO propósito que sigan sin usar (FR-006); los de otro propósito no
 * cambian. Devuelve el nuevo.
 */
export function solicitarReemplazando(
  anteriores: readonly EnlaceDeCuenta[],
  nuevo: { id: string; tenantId: string; usuarioId: string; proposito: PropositoEnlace },
  ahora: Date,
): EnlaceDeCuenta {
  for (const anterior of anteriores) {
    if (anterior.usuarioId === nuevo.usuarioId && anterior.proposito === nuevo.proposito)
      anterior.anular(ahora);
  }
  return EnlaceDeCuenta.solicitar(nuevo.id, nuevo.tenantId, nuevo.usuarioId, nuevo.proposito, ahora);
}

import { ValorInvalido } from './errores';

// Forma práctica (no la RFC completa): una parte local, una arroba y un dominio con punto.
const FORMATO = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Correo normalizado (trim + minúsculas): "Ana@Mail.com " y "ana@mail.com" son la misma cuenta (FR-029). */
export class Correo {
  private constructor(readonly valor: string) {}

  static crear(entrada: string): Correo {
    const valor = entrada.trim().toLowerCase();
    if (valor.length === 0) throw new ValorInvalido('correo', 'requerido');
    if (valor.length > 254) throw new ValorInvalido('correo', 'demasiado_largo');
    if (!FORMATO.test(valor)) throw new ValorInvalido('correo', 'formato');
    return new Correo(valor);
  }

  get parteLocal(): string {
    return this.valor.slice(0, this.valor.indexOf('@'));
  }

  equals(otro: Correo): boolean {
    return this.valor === otro.valor;
  }
}

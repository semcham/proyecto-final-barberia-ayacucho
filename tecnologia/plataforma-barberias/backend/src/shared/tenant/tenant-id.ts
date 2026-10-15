const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Identificador de una barbería (tenant). Valor compartido del núcleo (M06). */
export class TenantId {
  private constructor(readonly valor: string) {}

  static de(valor: string): TenantId {
    if (!UUID.test(valor)) {
      throw new Error('El identificador de tenant no es un UUID válido');
    }
    return new TenantId(valor.toLowerCase());
  }

  equals(otro: TenantId): boolean {
    return this.valor === otro.valor;
  }

  toString(): string {
    return this.valor;
  }
}

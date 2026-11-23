import { Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared';
import { CuentasApi, type TokenDeEnlace } from '../../api-publica';
import { EnlaceDeCuentaRepository, EstadoDeCuentas } from './ports/enlace-de-cuenta-repository';
import { generarTokenOpaco, hashDeToken } from './tokens-opacos';

/**
 * T041 de 010 · Implementación de `CuentasApi`. Corre en la transacción de quien la llama, con su barbería: el guard
 * (el tenant del token) o el envío de un aviso (el tenant del aviso). Con RLS, una cuenta o un enlace de otra barbería
 * simplemente no existen.
 */
@Injectable()
export class CuentasApiImpl extends CuentasApi {
  constructor(
    private readonly cuentas: EstadoDeCuentas,
    private readonly enlaces: EnlaceDeCuentaRepository,
    private readonly reloj: Clock,
  ) {
    super();
  }

  async correoVerificado(usuarioId: string): Promise<boolean> {
    return (await this.cuentas.correoYVerificacion(usuarioId))?.verificado ?? false;
  }

  async correoDeCuenta(usuarioId: string): Promise<string | null> {
    return (await this.cuentas.correoYVerificacion(usuarioId))?.correo ?? null;
  }

  /** R02: el token se genera AL ENVIAR y vive solo en memoria; la base guarda su SHA-256. */
  async emitirToken(enlaceId: string): Promise<TokenDeEnlace | null> {
    const token = generarTokenOpaco();
    const enlace = await this.enlaces.guardarHashSiVigente(enlaceId, hashDeToken(token), this.reloj.ahora());
    return enlace ? { token, proposito: enlace.proposito, venceEn: enlace.venceEn } : null;
  }
}

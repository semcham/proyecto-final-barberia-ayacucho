import type { EventoDeDominio } from '../../../../shared';
import type { EnlaceDeCuenta, PropositoEnlace } from '../domain/enlace-de-cuenta';

// T042 de 010 · Eventos de M01 para M05 (data-model §6; contracts/eventos-y-avisos.md §1). Payload SIN secretos: ni el
// token, ni la dirección del enlace, ni el correo, ni la contraseña. El tenant lo pone el bus (el de la transacción).

export const TIPOS_DE_EVENTO_DE_CUENTA = ['EnlaceDeCuentaSolicitado', 'ContrasenaCambiada'] as const;

/** Clave de reemplazo: un reenvío reemplaza al evento pendiente anterior en vez de sumar otro aviso. */
export const claveDeReemplazoDeEnlace = (usuarioId: string, proposito: PropositoEnlace): string =>
  `enlace:${usuarioId}:${proposito}`;

export function enlaceDeCuentaSolicitado(enlace: EnlaceDeCuenta): EventoDeDominio {
  return {
    tipo: 'EnlaceDeCuentaSolicitado',
    payload: {
      enlaceId: enlace.id,
      proposito: enlace.proposito,
      usuarioId: enlace.usuarioId,
      venceEn: enlace.venceEn.toISOString(),
    },
  };
}

export function contrasenaCambiada(usuarioId: string, cambiadaEn: Date): EventoDeDominio {
  return { tipo: 'ContrasenaCambiada', payload: { usuarioId, cambiadaEn: cambiadaEn.toISOString() } };
}

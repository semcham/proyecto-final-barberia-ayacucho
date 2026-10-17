import { JoseTokenSigner } from '../../src/modules/acceso-barberias/identidad/infrastructure/jose-token-signer';
import { Configuracion } from '../../src/shared';
import {
  type BarberiaSembrada,
  type ClienteSembrado,
  sembrarBarberia,
  sembrarBarbero,
  sembrarCliente,
  sembrarSesion,
  sembrarSuscripcion,
  sembrarUsuario,
} from './fixtures';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Token de acceso válido para un usuario sembrado (con su sesión ACTIVA en la base). */
export async function tokenPara(
  tenantId: string,
  usuarioId: string,
  rol: 'PROPIETARIO' | 'BARBERO' | 'CLIENTE',
): Promise<string> {
  const { sesionId } = await sembrarSesion({ tenantId, usuarioId });
  const { token } = await new JoseTokenSigner(new Configuracion()).firmar({
    sub: usuarioId,
    tid: tenantId,
    rol,
    sid: sesionId,
  });
  return token;
}

/**
 * Cliente con cuenta y membresía en la barbería (T012) y su token con el `tid` de esa barbería.
 * Con `cuenta`, reutiliza una cuenta de cliente existente (el mismo cliente en otra barbería, ADR-020).
 */
export async function sesionCliente(
  tenantId: string,
  cuenta?: { usuarioId: string },
): Promise<{ cliente: ClienteSembrado; token: string }> {
  const cliente = await sembrarCliente({ tenantId, usuarioId: cuenta?.usuarioId });
  const token = await tokenPara(tenantId, cliente.usuarioId as string, 'CLIENTE');
  return { cliente, token };
}

/** Usuario BARBERO activo vinculado a un barbero del catálogo, con su token (T012). */
export async function sesionBarberoVinculado(
  tenantId: string,
  servicios: readonly string[] = [],
): Promise<{ usuarioId: string; barberoId: string; token: string }> {
  const usuario = await sembrarUsuario({ tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
  const { barberoId } = await sembrarBarbero({ tenantId, usuarioId: usuario.usuarioId, servicios });
  const token = await tokenPara(tenantId, usuario.usuarioId, 'BARBERO');
  return { usuarioId: usuario.usuarioId, barberoId, token };
}

export interface Escenario {
  barberia: BarberiaSembrada;
  barberoActivo: { id: string; correo: string; contrasena: string };
  barberoPendiente: { id: string; correo: string };
  tokenPropietario: string;
  tokenBarbero: string;
}

/**
 * Barbería con su propietario, su suscripción de prueba (como tras un registro real), un barbero activo,
 * uno pendiente y tokens para ambos roles.
 */
export async function crearEscenario(nombre?: string): Promise<Escenario> {
  const barberia = await sembrarBarberia({ nombre });
  await sembrarSuscripcion({ tenantId: barberia.tenantId, trialEndsAt: new Date(Date.now() + 14 * DIA_MS) });
  const activo = await sembrarUsuario({ tenantId: barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
  const pendiente = await sembrarUsuario({
    tenantId: barberia.tenantId,
    rol: 'BARBERO',
    estado: 'PENDIENTE',
    contrasena: null,
  });
  return {
    barberia,
    barberoActivo: { id: activo.usuarioId, correo: activo.correo, contrasena: activo.contrasena as string },
    barberoPendiente: { id: pendiente.usuarioId, correo: pendiente.correo },
    tokenPropietario: await tokenPara(barberia.tenantId, barberia.propietarioId, 'PROPIETARIO'),
    tokenBarbero: await tokenPara(barberia.tenantId, activo.usuarioId, 'BARBERO'),
  };
}

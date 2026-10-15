import { ActualizarUsuario } from '../../../src/modules/acceso-barberias/identidad/application/actualizar-usuario';
import {
  type Actor,
  Autorizacion,
} from '../../../src/modules/acceso-barberias/identidad/application/autorizacion';
import { CrearUsuario } from '../../../src/modules/acceso-barberias/identidad/application/crear-usuario';
import { ListarUsuarios } from '../../../src/modules/acceso-barberias/identidad/application/listar-usuarios';
import { ObtenerUsuario } from '../../../src/modules/acceso-barberias/identidad/application/obtener-usuario';
import { RegenerarActivacion } from '../../../src/modules/acceso-barberias/identidad/application/regenerar-activacion';
import { AccesoDenegado } from '../../../src/modules/acceso-barberias/identidad/domain/errores';
import type { AuditLog } from '../../../src/shared';

// T097 · C2: cada caso de uso protegido exige el permiso en la capa de aplicación (R22, ADR-010), aunque
// no pase por el guard HTTP (p. ej. cuando M04 lo invoque como herramienta de IA).

const TENANT = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const USUARIO = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

/** Dependencia que registra cualquier uso: con un actor BARBERO ninguna debe tocarse. */
function espia(nombre: string, usos: string[]): never {
  return new Proxy(
    {},
    {
      get:
        (_objetivo, propiedad) =>
        (...argumentos: unknown[]) => {
          usos.push(`${nombre}.${String(propiedad)}`);
          // La unidad de trabajo simula continuar sin ejecutar el cuerpo transaccional.
          if (nombre === 'uow') return Promise.resolve('continuó');
          void argumentos;
          return Promise.resolve(undefined);
        },
    },
  ) as never;
}

function crearCasosDeUso(usos: string[]) {
  const auditoriaDeAutorizacion = {
    registrar: async () => undefined,
    registrarEnTransaccionPropia: async () => undefined,
  } as unknown as AuditLog;
  const autorizacion = new Autorizacion(auditoriaDeAutorizacion);
  const d = (nombre: string) => espia(nombre, usos);
  return {
    CrearUsuario: (actor: Actor) =>
      new CrearUsuario(
        autorizacion,
        d('uow'),
        d('usuarios'),
        d('suscripciones'),
        d('enlace'),
        d('auditoria'),
      ).ejecutar(actor, { nombre: 'Nuevo Barbero', correo: 'nuevo@prueba.pe', rol: 'BARBERO' }),
    ListarUsuarios: (actor: Actor) =>
      new ListarUsuarios(autorizacion, d('uow'), d('usuarios')).ejecutar(actor, { pagina: 1, tamano: 20 }),
    ObtenerUsuario: (actor: Actor) =>
      new ObtenerUsuario(autorizacion, d('uow'), d('usuarios')).ejecutar(actor, USUARIO),
    ActualizarUsuario: (actor: Actor) =>
      new ActualizarUsuario(
        autorizacion,
        d('uow'),
        d('usuarios'),
        d('sesiones'),
        d('activaciones'),
        d('auditoria'),
        d('reloj'),
      ).ejecutar(actor, USUARIO, 'DESACTIVADA'),
    RegenerarActivacion: (actor: Actor) =>
      new RegenerarActivacion(
        autorizacion,
        d('uow'),
        d('usuarios'),
        d('activaciones'),
        d('enlace'),
        d('auditoria'),
        d('reloj'),
      ).ejecutar(actor, USUARIO),
  };
}

const actor = (rol: 'PROPIETARIO' | 'BARBERO'): Actor => ({
  usuarioId: USUARIO,
  tenantId: TENANT,
  rol,
  sesionId: 's1',
});
const CASOS = [
  'CrearUsuario',
  'ListarUsuarios',
  'ObtenerUsuario',
  'ActualizarUsuario',
  'RegenerarActivacion',
] as const;

describe('Permisos en los casos de uso de usuarios (capa de aplicación)', () => {
  it.each(CASOS)('%s con un actor BARBERO lanza AccesoDenegado sin tocar repositorios', async (caso) => {
    const usos: string[] = [];
    await expect(crearCasosDeUso(usos)[caso](actor('BARBERO'))).rejects.toBeInstanceOf(AccesoDenegado);
    expect(usos).toEqual([]);
  });

  it.each(CASOS)('%s con un actor PROPIETARIO continúa hasta la unidad de trabajo', async (caso) => {
    const usos: string[] = [];
    await expect(crearCasosDeUso(usos)[caso](actor('PROPIETARIO'))).resolves.toBeDefined();
    expect(usos).toContain('uow.ejecutar');
  });
});

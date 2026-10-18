import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { BarberiasApi } from '../../api-publica';
import { type DatosUnion, UnirseABarberia } from '../../clientes/application/unirse-a-barberia';
import { AccesoSuspendido, CredencialesInvalidas, UnirseRequiereConsentimiento } from '../domain/errores';
import { type Actor, Autorizacion } from './autorizacion';
import { EmitirSesion } from './emitir-sesion';
import { SesionRepository } from './ports/sesion-repository';
import { UsuarioRepository } from './ports/usuario-repository';
import type { SesionIniciada } from './sesion-iniciada';

/**
 * T088 · El cliente cambia su sesión a otra barbería (ADR-020; constitución 1.2.0, selección de membresía
 * por enlace). Con sesión vigente: resuelve la barbería destino por su `slug`, busca con RLS la membresía
 * CLIENTE del mismo usuario (o lo une si acepta la política), emite una sesión nueva en el destino y
 * después cierra la actual. Un token nunca tiene dos barberías.
 */
@Injectable()
export class CambiarBarberia {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly barberias: BarberiasApi,
    private readonly usuarios: UsuarioRepository,
    private readonly sesiones: SesionRepository,
    private readonly unirse: UnirseABarberia,
    private readonly emitirSesion: EmitirSesion,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: Actor, slug: string, union?: DatosUnion): Promise<SesionIniciada> {
    await this.autorizacion.exigir(actor, 'CAMBIAR_BARBERIA');
    const destino = await this.barberias.resolverSlugPublico(slug);

    const resultado = await this.uow.ejecutar(destino, async () => {
      let membresia = await this.usuarios.membresiaEnContexto(actor.usuarioId);
      if (!membresia) {
        if (union?.aceptaPoliticaDatos !== true) throw new UnirseRequiereConsentimiento();
        // El actor es CLIENTE (lo exige la autorización): no es personal.
        await this.unirse.ejecutar(actor.usuarioId, this.unirse.validar(false, union));
        membresia = await this.usuarios.membresiaEnContexto(actor.usuarioId);
        if (!membresia) throw new Error('La membresía recién creada no es visible');
      }
      if (!membresia.estaActiva() || membresia.rol.codigo !== 'CLIENTE') throw new AccesoSuspendido();
      const usuario = await this.usuarios.perfil(actor.usuarioId);
      if (!usuario) throw new CredencialesInvalidas();
      const sesion = await this.emitirSesion.ejecutar(actor.usuarioId, 'CLIENTE');
      await this.auditoria.registrar({
        accion: 'BARBERIA_CAMBIADA',
        actorId: actor.usuarioId,
        recurso: `barberia:${destino.valor}`,
        resultado: 'PERMITIDO',
      });
      return { sesion, usuario };
    });

    // Después de abrir la nueva, se cierra la sesión actual en su barbería (transacción con el tenant del token).
    await this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const actual = await this.sesiones.obtener(actor.sesionId);
      if (!actual) return;
      actual.cerrar(this.reloj.ahora());
      await this.sesiones.guardar(actual);
    });
    return resultado;
  }
}

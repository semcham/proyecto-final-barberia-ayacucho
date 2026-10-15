import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { NoAutenticado } from '../domain/errores';
import { SesionRepository } from './ports/sesion-repository';
import { TokenSigner } from './ports/token-signer';
import { UsuarioRepository } from './ports/usuario-repository';
import type { SesionIniciada } from './sesion-iniciada';
import { generarTokenOpaco, hashDeToken } from './tokens-opacos';

/**
 * Renueva el token de acceso con el token de renovación de la cookie y rota ese token (R08, FR-008).
 * Si llega un token ya rotado, se trata como robo: la sesión completa se revoca y queda auditado.
 * Operación pública: el token de renovación es la credencial.
 */
@Injectable()
export class RenovarSesion {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly sesiones: SesionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly firmador: TokenSigner,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(tokenRenovacion: string): Promise<SesionIniciada> {
    const hashRecibido = hashDeToken(tokenRenovacion);
    // ADR-015: el tenant aún no se conoce; se resuelve por el hash del token.
    const encontrada = await this.uow.ejecutarSinTenant(() => this.sesiones.buscarPorHash(hashRecibido));
    if (!encontrada) throw new NoAutenticado();

    // Se devuelve null (y no se lanza) para que la transacción confirme la revocación y la auditoría.
    const resultado = await this.uow.ejecutar(TenantId.de(encontrada.tenantId), async () => {
      const ahora = this.reloj.ahora();

      if (encontrada.esTokenAnterior) {
        const sesion = await this.sesiones.obtener(encontrada.sesionId);
        if (sesion && sesion.estado === 'ACTIVA') {
          sesion.revocar(ahora);
          await this.sesiones.guardar(sesion);
          await this.auditoria.registrar({
            accion: 'SESION_REUTILIZADA',
            actorId: encontrada.usuarioId,
            recurso: `sesion:${encontrada.sesionId}`,
            resultado: 'DENEGADO',
          });
        }
        return null;
      }

      const estado = await this.sesiones.estadoDeAcceso(encontrada.sesionId, encontrada.usuarioId);
      if (!estado || !estado.sesion.estaVigente(ahora) || !estado.membresiaActiva || !estado.barberiaActiva) {
        return null;
      }

      const tokenNuevo = generarTokenOpaco();
      const hashVigente = estado.sesion.hashTokenVigente;
      estado.sesion.rotar(hashDeToken(tokenNuevo), ahora);
      // Si otra renovación concurrente ya rotó este token, esta pierde.
      if (!(await this.sesiones.guardarRotacion(estado.sesion, hashVigente))) return null;

      const usuario = await this.usuarios.perfil(encontrada.usuarioId);
      if (!usuario) return null;
      const acceso = await this.firmador.firmar({
        sub: encontrada.usuarioId,
        tid: encontrada.tenantId,
        rol: estado.rolMembresia,
        sid: encontrada.sesionId,
      });
      return {
        sesion: {
          tokenAcceso: acceso.token,
          expiraEn: acceso.expiraEnSegundos,
          tokenRenovacion: tokenNuevo,
          sesionId: encontrada.sesionId,
        },
        usuario,
      };
    });

    if (!resultado) throw new NoAutenticado();
    return resultado;
  }
}

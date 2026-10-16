import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, Configuracion, TenantId, UnitOfWork } from '../../../../shared';
import { NoAutenticado } from '../domain/errores';
import type { Sesion } from '../domain/sesion';
import { SesionRepository } from './ports/sesion-repository';
import { TokenSigner } from './ports/token-signer';
import { UsuarioRepository } from './ports/usuario-repository';
import type { SesionIniciada } from './sesion-iniciada';
import { generarTokenOpaco, hashDeToken } from './tokens-opacos';

/**
 * Renueva el token de acceso con el token de renovación de la cookie y rota ese token (R08, FR-008).
 * Período de gracia (FR-008a, R23): el token anterior se acepta una sola vez durante unos segundos tras la
 * rotación (respuesta perdida, recarga doble). Fuera de la ventana, por segunda vez, o si aparece el token
 * que la gracia dejó sin efecto, se trata como robo: la sesión completa se revoca y queda auditado.
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
    private readonly configuracion: Configuracion,
  ) {}

  async ejecutar(tokenRenovacion: string): Promise<SesionIniciada> {
    const hashRecibido = hashDeToken(tokenRenovacion);
    // ADR-015: el tenant aún no se conoce; se resuelve por el hash del token.
    const encontrada = await this.uow.ejecutarSinTenant(() => this.sesiones.buscarPorHash(hashRecibido));
    if (!encontrada) throw new NoAutenticado();

    // Se devuelve null (y no se lanza) para que la transacción confirme la revocación y la auditoría.
    const resultado = await this.uow.ejecutar(TenantId.de(encontrada.tenantId), async () => {
      // La fila de la sesión queda bloqueada hasta el fin de la transacción: dos renovaciones con el mismo
      // token se atienden una tras otra y la decisión se toma sobre el estado ya confirmado.
      const estado = await this.sesiones.bloquearParaRenovar(encontrada.sesionId, encontrada.usuarioId);
      if (!estado) return null;
      const { sesion } = estado;
      const ahora = this.reloj.ahora();
      const graciaMs = this.configuracion.sesion.graciaRenovacionSegundos * 1000;

      const clase = sesion.clasificarToken(hashRecibido, ahora, graciaMs);
      if (clase === 'REUTILIZADO') {
        await this.revocarPorReutilizacion(sesion, ahora);
        return null;
      }
      if (clase === 'DESCONOCIDO') return null;
      if (!sesion.estaVigente(ahora) || !estado.membresiaActiva || !estado.barberiaActiva) return null;

      const tokenNuevo = generarTokenOpaco();
      if (clase === 'GRACIA') {
        sesion.rotarEnGracia(hashDeToken(tokenNuevo), ahora);
      } else {
        sesion.rotar(hashDeToken(tokenNuevo), ahora);
      }
      await this.sesiones.guardar(sesion);
      if (clase === 'GRACIA') {
        await this.auditoria.registrar({
          accion: 'SESION_RENOVADA_EN_GRACIA',
          actorId: encontrada.usuarioId,
          recurso: `sesion:${encontrada.sesionId}`,
          resultado: 'PERMITIDO',
        });
      }

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

  /** Posible robo del token de renovación: revoca la sesión completa (idempotente) y lo audita una vez. */
  private async revocarPorReutilizacion(sesion: Sesion, ahora: Date): Promise<void> {
    if (sesion.estado !== 'ACTIVA') return;
    sesion.revocar(ahora);
    await this.sesiones.guardar(sesion);
    await this.auditoria.registrar({
      accion: 'SESION_REUTILIZADA',
      actorId: sesion.usuarioId,
      recurso: `sesion:${sesion.id}`,
      resultado: 'DENEGADO',
    });
  }
}

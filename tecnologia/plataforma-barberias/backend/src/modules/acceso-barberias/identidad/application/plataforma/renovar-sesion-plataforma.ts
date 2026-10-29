import { Injectable } from '@nestjs/common';
import { Clock, UnitOfWork } from '../../../../../shared';
import { NoAutenticado } from '../../domain/errores';
import { AccesoPlataformaRepository, AdminsPlataforma } from '../ports/plataforma';
import { TokenSigner } from '../ports/token-signer';
import { generarTokenOpaco, hashDeToken } from '../tokens-opacos';
import type { SesionPlataformaEmitida } from './verificar-segundo-factor';

/**
 * T068 · Renovación de la sesión del administrador con la cookie de plataforma (R07). Rota el token de
 * renovación en cada uso y nunca pasa la vida máxima de 8 horas desde el ingreso (no se extiende).
 *
 * Sin período de gracia (el de 001 existe por las pestañas de una barbería): si llega el token que ya se
 * rotó, se trata como robo y la sesión completa se revoca. Una cuenta desactivada no renueva.
 */
@Injectable()
export class RenovarSesionPlataforma {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly acceso: AccesoPlataformaRepository,
    private readonly admins: AdminsPlataforma,
    private readonly firmador: TokenSigner,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(tokenRenovacion: string): Promise<SesionPlataformaEmitida> {
    const hash = hashDeToken(tokenRenovacion);
    const tokenNuevo = generarTokenOpaco();
    // La revocación se confirma aunque la respuesta sea 401: la transacción devuelve null en vez de lanzar.
    const sesion = await this.uow.ejecutarSinTenant(async () => {
      const ahora = this.reloj.ahora();
      const encontrada = await this.acceso.bloquearSesionPorHash(hash);
      if (!encontrada || encontrada.estado !== 'ACTIVA') return null;
      if (encontrada.coincide === 'ANTERIOR') {
        await this.acceso.terminarSesion(encontrada.id, encontrada.adminId, 'REVOCADA', ahora);
        return null;
      }
      if (encontrada.expiraEn.getTime() <= ahora.getTime()) {
        await this.acceso.terminarSesion(encontrada.id, encontrada.adminId, 'CERRADA', ahora);
        return null;
      }
      await this.acceso.rotarSesion(encontrada.id, hashDeToken(tokenNuevo), hash, ahora);
      return encontrada;
    });
    if (!sesion) throw new NoAutenticado();

    const admin = await this.admins.porId(sesion.adminId);
    if (!admin?.activo) {
      await this.uow.ejecutarSinTenant(() =>
        this.acceso.terminarSesion(sesion.id, sesion.adminId, 'REVOCADA', this.reloj.ahora()),
      );
      throw new NoAutenticado();
    }

    const acceso = await this.firmador.firmarPlataforma({ sub: sesion.adminId, sid: sesion.id });
    return {
      tokenAcceso: acceso.token,
      expiraEn: new Date(this.reloj.ahora().getTime() + acceso.expiraEnSegundos * 1000),
      tokenRenovacion: tokenNuevo,
      sesionExpiraEn: sesion.expiraEn,
    };
  }
}

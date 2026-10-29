import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock, UnitOfWork } from '../../../../../shared';
import { CredencialesPlataformaInvalidas } from '../../domain/errores';
import { PasswordHasher } from '../ports/password-hasher';
import { AccesoPlataformaRepository, AdminsPlataforma, AuditoriaAccesoPlataforma } from '../ports/plataforma';
import { IntentosAdmin } from './intentos-admin';

/** Vida del desafío del segundo factor (R07; CHECK platform_challenge_vida). */
export const VIDA_DESAFIO_MS = 5 * 60 * 1000;

export interface DesafioEmitido {
  desafio: string;
  expiraEn: Date;
}

/**
 * T068 · Primer paso del ingreso del administrador (R07): correo y contraseña → desafío de 5 minutos para el
 * segundo factor. Operación pública.
 *
 * Igual que el inicio de sesión de 001: el hash se verifica con el mismo costo exista o no la cuenta (tiempo
 * constante), el mismo 401 para cualquier fallo y los fallos cuentan para el bloqueo de 5 en 15 minutos. La
 * contraseña correcta todavía no abre nada: sin el segundo factor no hay sesión.
 */
@Injectable()
export class IngresarAdmin {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly admins: AdminsPlataforma,
    private readonly acceso: AccesoPlataformaRepository,
    private readonly auditoria: AuditoriaAccesoPlataforma,
    private readonly intentos: IntentosAdmin,
    private readonly hasher: PasswordHasher,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(correoIngresado: string, contrasena: string): Promise<DesafioEmitido> {
    const correo = correoIngresado.trim().toLowerCase();
    await this.intentos.exigirNoBloqueado(correo);

    const admin = await this.admins.porCorreo(correo);
    const valida = admin
      ? await this.hasher.verificar(admin.hashContrasena, contrasena)
      : await this.hasher.verificarFicticio(contrasena);
    // Una cuenta desactivada recibe el mismo 401, después de verificar la contraseña: no revela su estado.
    if (!admin || !valida || !admin.activo) {
      await this.intentos.registrarFallo(correo);
      await this.uow.ejecutarSinTenant(() =>
        this.auditoria.registrar({
          accion: 'ADMIN_INGRESO_FALLIDO',
          adminId: admin?.id ?? null,
          resultado: 'DENEGADO',
        }),
      );
      throw new CredencialesPlataformaInvalidas();
    }

    const ahora = this.reloj.ahora();
    const desafio = {
      id: randomUUID(),
      adminId: admin.id,
      creadoEn: ahora,
      expiraEn: new Date(ahora.getTime() + VIDA_DESAFIO_MS),
    };
    await this.uow.ejecutarSinTenant(() => this.acceso.crearDesafio(desafio));
    return { desafio: desafio.id, expiraEn: desafio.expiraEn };
  }
}

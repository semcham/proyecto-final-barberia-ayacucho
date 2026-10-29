import { Injectable } from '@nestjs/common';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import {
  type AdminPlataforma,
  AdminsPlataforma,
  SesionesPlataformaVigentes,
} from '../../application/ports/plataforma';

/**
 * T068 · El administrador se lee con el rol de solo lectura de la plataforma (ADR-031): el rol de la
 * aplicación no tiene ningún permiso sobre platform_admin (C3), así que una inyección en cualquier consulta
 * de barbería no puede leer sus secretos.
 */
@Injectable()
export class AdminsPlataformaLectura extends AdminsPlataforma {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  porCorreo(correo: string): Promise<AdminPlataforma | null> {
    return this.buscar('email', correo);
  }

  porId(id: string): Promise<AdminPlataforma | null> {
    return this.buscar('id', id);
  }

  private buscar(columna: 'email' | 'id', valor: string): Promise<AdminPlataforma | null> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const fila = await trx
        .selectFrom('platform_admin')
        .select(['id', 'email', 'password_hash', 'totp_secret_enc', 'recovery_codes_hash', 'status'])
        .where(columna, '=', valor)
        .executeTakeFirst();
      if (!fila) return null;
      return {
        id: fila.id,
        correo: fila.email,
        hashContrasena: fila.password_hash,
        secretoCifrado: fila.totp_secret_enc,
        hashesRecuperacion: fila.recovery_codes_hash,
        activo: fila.status === 'ACTIVA',
      };
    });
  }
}

/** Vigencia de la sesión del token de plataforma: una sola consulta, sesión y cuenta a la vez. */
@Injectable()
export class SesionesPlataformaLectura extends SesionesPlataformaVigentes {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  vigente(sesionId: string, adminId: string, ahora: Date): Promise<boolean> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const fila = await trx
        .selectFrom('platform_session as s')
        .innerJoin('platform_admin as a', 'a.id', 's.admin_id')
        .select('s.id')
        .where('s.id', '=', sesionId)
        .where('s.admin_id', '=', adminId)
        .where('s.status', '=', 'ACTIVA')
        .where('s.expires_at', '>', ahora)
        .where('a.status', '=', 'ACTIVA')
        .executeTakeFirst();
      return fila !== undefined;
    });
  }
}

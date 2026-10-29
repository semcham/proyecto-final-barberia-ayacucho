import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock, UnitOfWork } from '../../../../../shared';
import { CredencialesPlataformaInvalidas, ValorInvalido } from '../../domain/errores';
import {
  AccesoPlataformaRepository,
  type AdminPlataforma,
  AdminsPlataforma,
  AuditoriaAccesoPlataforma,
  CodigoRecuperacionYaUsado,
} from '../ports/plataforma';
import { SegundoFactor } from '../ports/segundo-factor';
import { TokenSigner } from '../ports/token-signer';
import { generarTokenOpaco, hashDeToken } from '../tokens-opacos';
import { IntentosAdmin } from './intentos-admin';

/** Vida máxima de la sesión del administrador (R07; CHECK platform_session_vida_maxima). */
export const VIDA_SESION_PLATAFORMA_MS = 8 * 60 * 60 * 1000;

export interface SesionPlataformaEmitida {
  tokenAcceso: string;
  expiraEn: Date;
  tokenRenovacion: string;
  /** Fin de la vida máxima de la sesión: la cookie de renovación no dura más. */
  sesionExpiraEn: Date;
}

export interface CodigoPresentado {
  codigo?: string;
  codigoRecuperacion?: string;
}

/**
 * T068 · Segundo paso del ingreso del administrador (R07): el desafío y un código TOTP, o uno de sus 10
 * códigos de recuperación, abren la sesión de plataforma. Operación pública: el desafío es la credencial.
 *
 * Un código no sirve dos veces, tampoco entre réplicas: el paso tiene que ser mayor que el último con el que
 * entró (`platform_session.totp_step`), y `UNIQUE (admin_id, totp_step)` deja una sola sesión si dos ingresos
 * llegan a la vez con el mismo código. Cada código de recuperación sirve una vez, garantizado por
 * `UNIQUE (admin_id, used_recovery_index)`. Los fallos cuentan para el bloqueo de 5 en 15 minutos.
 */
@Injectable()
export class VerificarSegundoFactor {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly admins: AdminsPlataforma,
    private readonly acceso: AccesoPlataformaRepository,
    private readonly auditoria: AuditoriaAccesoPlataforma,
    private readonly intentos: IntentosAdmin,
    private readonly segundoFactor: SegundoFactor,
    private readonly firmador: TokenSigner,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(desafioId: string, presentado: CodigoPresentado): Promise<SesionPlataformaEmitida> {
    const conCodigo = presentado.codigo !== undefined;
    if (conCodigo === (presentado.codigoRecuperacion !== undefined)) {
      throw new ValorInvalido('codigo', 'envia_codigo_o_codigoRecuperacion');
    }

    const ahora = this.reloj.ahora();
    const desafio = await this.uow.ejecutarSinTenant(() => this.acceso.desafio(desafioId));
    // Un desafío inexistente no tiene administrador al que contarle el fallo: el límite general lo frena.
    if (!desafio) throw new CredencialesPlataformaInvalidas();
    const admin = await this.admins.porId(desafio.adminId);
    if (!admin) throw new CredencialesPlataformaInvalidas();
    await this.intentos.exigirNoBloqueado(admin.correo);

    if (desafio.usadoEn !== null || desafio.expiraEn.getTime() <= ahora.getTime() || !admin.activo) {
      return this.rechazar(admin);
    }

    const sesion = conCodigo
      ? await this.conCodigo(admin, desafioId, presentado.codigo as string, ahora)
      : await this.conRecuperacion(admin, desafioId, presentado.codigoRecuperacion as string, ahora);
    if (!sesion) return this.rechazar(admin);

    await this.intentos.borrarFallos(admin.correo);
    return sesion;
  }

  private async conCodigo(
    admin: AdminPlataforma,
    desafioId: string,
    codigo: string,
    ahora: Date,
  ): Promise<SesionPlataformaEmitida | null> {
    const secreto = this.segundoFactor.descifrar(admin.secretoCifrado, admin.id);
    const ultimoPaso = await this.uow.ejecutarSinTenant(() => this.acceso.ultimoPaso(admin.id));
    const paso = this.segundoFactor.verificarCodigo(secreto, codigo, ahora, ultimoPaso);
    secreto.fill(0);
    if (paso === null) return null;
    return this.abrirSesion(admin, desafioId, ahora, { paso, indiceRecuperacion: null });
  }

  private async conRecuperacion(
    admin: AdminPlataforma,
    desafioId: string,
    codigo: string,
    ahora: Date,
  ): Promise<SesionPlataformaEmitida | null> {
    const usados = await this.uow.ejecutarSinTenant(() => this.acceso.indicesRecuperacionUsados(admin.id));
    const indice = await this.segundoFactor.verificarCodigoRecuperacion(
      codigo,
      admin.hashesRecuperacion,
      usados,
    );
    if (indice === null) return null;
    try {
      const sesion = await this.abrirSesion(admin, desafioId, ahora, {
        paso: null,
        indiceRecuperacion: indice,
      });
      if (sesion) {
        await this.uow.ejecutarSinTenant(() =>
          this.auditoria.registrar({
            accion: 'ADMIN_CODIGO_RECUPERACION_USADO',
            adminId: admin.id,
            resultado: 'PERMITIDO',
          }),
        );
      }
      return sesion;
    } catch (error) {
      // Dos ingresos simultáneos con el mismo código de recuperación: la base deja pasar uno solo.
      if (error instanceof CodigoRecuperacionYaUsado) return null;
      throw error;
    }
  }

  /**
   * En una sola transacción: usa el desafío (condicional), abre la sesión y registra el ingreso. Si otro
   * ingreso ya usó el desafío o el mismo paso TOTP, no queda nada escrito.
   */
  private async abrirSesion(
    admin: AdminPlataforma,
    desafioId: string,
    ahora: Date,
    uso: { paso: number | null; indiceRecuperacion: number | null },
  ): Promise<SesionPlataformaEmitida | null> {
    const sesionId = randomUUID();
    const tokenRenovacion = generarTokenOpaco();
    const sesionExpiraEn = new Date(ahora.getTime() + VIDA_SESION_PLATAFORMA_MS);
    const abierta = await this.uow
      .ejecutarSinTenant(async () => {
        if (!(await this.acceso.usarDesafio(desafioId, ahora, uso.indiceRecuperacion))) throw new SinSesion();
        const creada = await this.acceso.crearSesion({
          id: sesionId,
          adminId: admin.id,
          hashRenovacion: hashDeToken(tokenRenovacion),
          paso: uso.paso,
          creadaEn: ahora,
          expiraEn: sesionExpiraEn,
        });
        // Se lanza para deshacer el uso del desafío: no se confirma nada.
        if (!creada) throw new SinSesion();
        await this.auditoria.registrar({
          accion: 'ADMIN_INGRESO',
          adminId: admin.id,
          resultado: 'PERMITIDO',
        });
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof SinSesion) return false;
        throw error;
      });
    if (!abierta) return null;

    const acceso = await this.firmador.firmarPlataforma({ sub: admin.id, sid: sesionId });
    return {
      tokenAcceso: acceso.token,
      expiraEn: new Date(ahora.getTime() + acceso.expiraEnSegundos * 1000),
      tokenRenovacion,
      sesionExpiraEn,
    };
  }

  /** Fallo del segundo factor: cuenta para el bloqueo, queda auditado y responde el mismo 401. */
  private async rechazar(admin: AdminPlataforma): Promise<never> {
    await this.intentos.registrarFallo(admin.correo);
    await this.uow.ejecutarSinTenant(() =>
      this.auditoria.registrar({
        accion: 'ADMIN_SEGUNDO_FACTOR_FALLIDO',
        adminId: admin.id,
        resultado: 'DENEGADO',
      }),
    );
    throw new CredencialesPlataformaInvalidas();
  }
}

/** Señal interna: la transacción del ingreso se deshace sin abrir sesión. */
class SinSesion extends Error {}

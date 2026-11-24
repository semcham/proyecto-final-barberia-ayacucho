import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AuditLog,
  BusDeEventos,
  Clock,
  Configuracion,
  TenantContext,
  TenantId,
  UnitOfWork,
} from '../../../../shared';
import { Contrasena } from '../domain/contrasena';
import { Correo } from '../domain/correo';
import {
  ContrasenaNuevaNoValida,
  DemasiadosIntentos,
  EnlaceNoValido,
  ValorInvalido,
} from '../domain/errores';
import { evaluarLimiteDeEnlace, VENTANA_LIMITE_ENLACES_MS } from '../domain/limite-enlaces';
import { contrasenaCambiada } from './eventos-de-cuenta';
import {
  EstadoDeCuentas,
  FuncionesDeCuenta,
  IntentosEnlaceDeCuentaRepository,
} from './ports/enlace-de-cuenta-repository';
import { PasswordHasher } from './ports/password-hasher';
import { conTiempoMinimo } from './tiempo-minimo';
import { hashDeToken } from './tokens-opacos';

const IP_DESCONOCIDA = '0.0.0.0';
/** Forma de los tokens que emite `generarTokenOpaco` (base64url); otra forma es un enlace mal formado. */
const FORMA_DEL_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

const reglasIncumplidas = (error: unknown): Record<string, unknown>[] | null =>
  error instanceof ValorInvalido ? error.detalles : null;

/**
 * T077 de 010 · Elegir la contraseña nueva con el enlace, sin sesión (US2; FR-021 a FR-023; research R04, R12 y R15).
 *
 * 1. El hash Argon2id se calcula FUERA de la transacción y antes de saber si el enlace sirve (así cuesta lo mismo).
 * 2. En una transacción, `auth_restablecer_contrasena` valida y consume el enlace, fija la contraseña, la marca como
 *    verificada (ENLACE), anula sus otros enlaces de recuperación y cierra TODAS sus sesiones, en todas sus barberías.
 * 3. Con la barbería del enlace (ADR-015) se comprueban las reglas con el correo de la cuenta: si no las cumple, se
 *    revierte todo (el enlace sigue sirviendo) y se responde 422. Si las cumple, se audita y se publica
 *    `ContrasenaCambiada` (el correo de aviso).
 *
 * Hacia fuera, un enlace usado, vencido, anulado, desconocido o mal formado responde el mismo 410 (R15: solo se audita
 * el que pertenece a una cuenta; el otro queda como USO_FALLIDO por origen, con su límite).
 */
@Injectable()
export class RestablecerContrasena {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly funciones: FuncionesDeCuenta,
    private readonly intentos: IntentosEnlaceDeCuentaRepository,
    private readonly cuentas: EstadoDeCuentas,
    private readonly hasher: PasswordHasher,
    private readonly bus: BusDeEventos,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
    private readonly tenantContext: TenantContext,
    private readonly configuracion: Configuracion,
  ) {}

  async ejecutar(token: string, contrasenaTexto: string): Promise<void> {
    return conTiempoMinimo(this.configuracion.cuentas.respuestaMinimaMs, async () => {
      const ip = this.tenantContext.datosSolicitud().ip ?? IP_DESCONOCIDA;
      // Las reglas que no dependen del correo se miden ya, pero solo se informan con un enlace vigente (contrato).
      let incumplidas: Record<string, unknown>[] | null = null;
      try {
        Contrasena.crear(contrasenaTexto);
      } catch (error) {
        incumplidas = reglasIncumplidas(error);
        if (!incumplidas) throw error;
      }
      // Si no las cumple, el hash es de un marcador al azar (que sí las cumple) y la transacción se revierte siempre:
      // sirve solo para saber si el enlace es vigente (422) o no (410), con el mismo costo.
      const hash = await this.hasher.hash(
        incumplidas
          ? Contrasena.crear(randomBytes(24).toString('base64url'))
          : Contrasena.crear(contrasenaTexto),
      );

      const aplicado = await this.uow.ejecutarSinTenant(async (): Promise<boolean> => {
        const ahora = this.reloj.ahora();
        const recientes = await this.intentos.recientes(
          'USO_FALLIDO',
          null,
          ip,
          new Date(ahora.getTime() - VENTANA_LIMITE_ENLACES_MS),
        );
        const decision = evaluarLimiteDeEnlace('USO_FALLIDO', recientes, ahora);
        if (!decision.permitido) throw new DemasiadosIntentos(decision.reintentarEnSegundos);

        const consumo = FORMA_DEL_TOKEN.test(token)
          ? await this.funciones.restablecerContrasena(hashDeToken(token), hash)
          : null;
        if (!consumo) {
          await this.intentos.registrar('USO_FALLIDO', null, ip, ahora);
          return false;
        }
        await this.uow.fijarTenant(TenantId.de(consumo.tenantId));
        if (consumo.resultado === 'RECHAZADO') {
          await this.auditoria.registrar({
            accion: 'ENLACE_DE_CUENTA_RECHAZADO',
            actorId: consumo.usuarioId,
            recurso: `cuenta:${consumo.usuarioId};RECUPERAR_CONTRASENA`,
            resultado: 'DENEGADO',
          });
          return false;
        }

        // Con el correo de la cuenta: si la contraseña no cumple, se revierte todo (la excepción deshace la
        // transacción) y el enlace sigue sirviendo hasta su vencimiento.
        const cuenta = await this.cuentas.correoYVerificacion(consumo.usuarioId);
        if (!cuenta) throw new Error('La cuenta del enlace no es visible en su barbería');
        if (incumplidas) throw new ContrasenaNuevaNoValida(incumplidas);
        try {
          Contrasena.crear(contrasenaTexto, Correo.crear(cuenta.correo));
        } catch (error) {
          const deCorreo = reglasIncumplidas(error);
          if (deCorreo) throw new ContrasenaNuevaNoValida(deCorreo);
          throw error;
        }

        await this.auditoria.registrar({
          accion: 'CONTRASENA_RESTABLECIDA',
          actorId: consumo.usuarioId,
          recurso: `cuenta:${consumo.usuarioId};RECUPERAR_CONTRASENA`,
          resultado: 'PERMITIDO',
        });
        await this.bus.publicar(contrasenaCambiada(consumo.usuarioId, ahora));
        return true;
      });
      // Fuera de la transacción: el rechazo y el uso fallido ya quedaron guardados.
      if (!aplicado) throw new EnlaceNoValido();
    });
  }
}

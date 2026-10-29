import { Injectable } from '@nestjs/common';
import { Clock, TenantContext, UnitOfWork } from '../../../../../shared';
import { DemasiadosIntentos } from '../../domain/errores';
import { PoliticaIntentosPlataforma, VENTANA_PLATAFORMA_MS } from '../../domain/politica-intentos-plataforma';
import { IntentosRepository } from '../ports/intentos-repository';
import { hashDeToken } from '../tokens-opacos';

const IP_DESCONOCIDA = '0.0.0.0';

/**
 * Intentos fallidos del ingreso del administrador en `login_attempt` (PostgreSQL, principio VIII), compartidos
 * por las réplicas. La clave es el SHA-256 de "plataforma:" + correo, separada de la del inicio de sesión de
 * las barberías: bloquear una no bloquea la otra.
 *
 * Una contraseña correcta NO borra los fallos: solo el ingreso completo (con el segundo factor) lo hace. Si
 * no, quien conoce la contraseña podría probar códigos sin límite volviendo a empezar.
 */
@Injectable()
export class IntentosAdmin {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly intentos: IntentosRepository,
    private readonly reloj: Clock,
    private readonly tenantContext: TenantContext,
  ) {}

  /** Lanza DemasiadosIntentos (429) si el par correo + IP está bloqueado. */
  async exigirNoBloqueado(correo: string): Promise<void> {
    const ahora = this.reloj.ahora();
    const fallos = await this.uow.ejecutarSinTenant(() =>
      this.intentos.fallosDesde(
        this.clave(correo),
        this.ip(),
        new Date(ahora.getTime() - VENTANA_PLATAFORMA_MS),
      ),
    );
    const evaluacion = PoliticaIntentosPlataforma.evaluar(fallos, ahora);
    if (evaluacion.bloqueado) throw new DemasiadosIntentos(evaluacion.reintentarEnSegundos);
  }

  registrarFallo(correo: string): Promise<void> {
    return this.uow.ejecutarSinTenant(() =>
      this.intentos.registrarFallo(this.clave(correo), this.ip(), this.reloj.ahora()),
    );
  }

  borrarFallos(correo: string): Promise<void> {
    return this.uow.ejecutarSinTenant(() => this.intentos.borrarFallos(this.clave(correo), this.ip()));
  }

  private clave(correo: string): string {
    return hashDeToken(`plataforma:${correo}`);
  }

  private ip(): string {
    return this.tenantContext.datosSolicitud().ip ?? IP_DESCONOCIDA;
  }
}

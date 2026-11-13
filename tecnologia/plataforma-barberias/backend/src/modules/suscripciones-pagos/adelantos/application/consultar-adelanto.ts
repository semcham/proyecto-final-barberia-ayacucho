import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import type { ResumenDeAdelanto } from '../../adelantos-api';
import {
  type ActorDeBarberia,
  AutorizacionSuscripciones,
} from '../../suscripciones/application/autorizacion';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import { Adelanto } from '../domain/adelanto';
import { type AdelantoGuardado, AdelantoRepository } from './ports/adelanto-repository';
import { type ArchivoAdelanto, ArchivosAdelanto } from './ports/archivos-adelanto';
import { aResumen } from './vista-adelanto';

/**
 * T031 de 008 · El adelanto de una cita, su QR y su captura (FR-008, FR-011; contracts/rbac.md): el propietario
 * cualquiera de su barbería; el cliente solo el de su cita (otro cliente → 404, igual que una cita que no existe o
 * de otra barbería, PR09). El QR, al cliente solo mientras tiene que pagar o su pago está por revisar. Los archivos
 * se leen con el tenant fijado y RLS: nunca hay una URL pública.
 */
@Injectable()
export class ConsultarAdelanto {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly adelantos: AdelantoRepository,
    private readonly archivos: ArchivosAdelanto,
  ) {}

  async ver(actor: ActorDeBarberia, citaId: string): Promise<ResumenDeAdelanto> {
    await this.autorizacion.exigir(actor, 'VER_ADELANTO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const adelanto = await this.delActor(actor, citaId);
      const pagos = await this.adelantos.ultimosPagos([adelanto.id]);
      return aResumen(adelanto, pagos.get(adelanto.id) ?? null);
    });
  }

  async qr(actor: ActorDeBarberia, citaId: string): Promise<ArchivoAdelanto> {
    await this.autorizacion.exigir(actor, 'VER_ADELANTO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const adelanto = await this.delActor(actor, citaId);
      if (actor.rol === 'CLIENTE' && !Adelanto.estaPendiente(adelanto.estado)) throw new NoEncontrado();
      const archivo = await this.archivos.leer(adelanto.qrArchivoId);
      if (!archivo) throw new NoEncontrado();
      return archivo;
    });
  }

  /** La captura del último registro de pago (el vigente o, si se rechazó, ese). */
  async captura(actor: ActorDeBarberia, citaId: string): Promise<ArchivoAdelanto> {
    await this.autorizacion.exigir(actor, 'VER_ADELANTO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const adelanto = await this.delActor(actor, citaId);
      const pago = (await this.adelantos.ultimosPagos([adelanto.id])).get(adelanto.id);
      const archivo = pago?.archivoId ? await this.archivos.leer(pago.archivoId) : null;
      if (!archivo) throw new NoEncontrado();
      return archivo;
    });
  }

  /** El adelanto de la cita si el actor puede verlo; si no, 404 sin revelar si existe. */
  private async delActor(actor: ActorDeBarberia, citaId: string): Promise<AdelantoGuardado> {
    const adelanto = await this.adelantos.deCita(citaId);
    if (!adelanto) throw new NoEncontrado();
    if (actor.rol === 'CLIENTE' && adelanto.usuarioClienteId !== actor.usuarioId) throw new NoEncontrado();
    return adelanto;
  }
}

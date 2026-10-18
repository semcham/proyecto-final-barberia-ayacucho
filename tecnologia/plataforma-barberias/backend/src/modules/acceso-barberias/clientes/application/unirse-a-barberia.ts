import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Configuracion, TenantContext } from '../../../../shared';
import { UsuarioRepository } from '../../identidad/application/ports/usuario-repository';
import { Correo } from '../../identidad/domain/correo';
import { CuentaDePersonal, ValorInvalido } from '../../identidad/domain/errores';
import { Membresia } from '../../identidad/domain/membresia';
import { NombrePersona } from '../../identidad/domain/nombre-persona';
import { Consentimiento } from '../domain/consentimiento';
import { PerfilCliente, Telefono } from '../domain/perfil-cliente';
import { ConsentimientoRepository } from './ports/consentimiento-repository';
import { PerfilClienteRepository } from './ports/perfil-cliente-repository';

/** Lo que el cliente envía para unirse a una barbería nueva (aceptación y teléfono, HU06). */
export interface DatosUnion {
  aceptaPoliticaDatos?: boolean;
  versionPoliticaDatos?: string;
  telefono?: string;
}

export interface UnionValidada {
  consentimiento: Consentimiento;
  telefono: Telefono;
}

/**
 * T086 · Una cuenta de cliente se une a otra barbería (ADR-020; constitución 1.2.0, selección de
 * membresía por enlace). Crea, en la barbería del contexto (la transacción del llamador), la membresía
 * CLIENTE, el perfil con el nombre y el correo de la cuenta y el consentimiento, y lo audita. Lo usan el
 * ingreso con enlace y el cambio de barbería, siempre después de comprobar la identidad.
 */
@Injectable()
export class UnirseABarberia {
  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly perfiles: PerfilClienteRepository,
    private readonly consentimientos: ConsentimientoRepository,
    private readonly auditoria: AuditLog,
    private readonly configuracion: Configuracion,
    private readonly tenantContext: TenantContext,
  ) {}

  /** Reglas de la unión: una cuenta del personal no se une como cliente; aceptación vigente y teléfono. */
  validar(esPersonal: boolean, datos: DatosUnion): UnionValidada {
    if (esPersonal) throw new CuentaDePersonal();
    const consentimiento = Consentimiento.enLinea(
      datos.aceptaPoliticaDatos,
      datos.versionPoliticaDatos ?? '',
      this.configuracion.versionPoliticaDatos,
    );
    if (!datos.telefono) throw new ValorInvalido('telefono', 'requerido');
    return { consentimiento, telefono: Telefono.crear(datos.telefono) };
  }

  /** Debe ejecutarse dentro del UnitOfWork de la barbería destino. */
  async ejecutar(usuarioId: string, union: UnionValidada): Promise<void> {
    const tenantId = this.tenantContext.actual().valor;
    await this.usuarios.crearMembresia(Membresia.crearCliente(uuidv7(), tenantId, usuarioId));
    // Con la membresía creada, RLS ya deja ver la cuenta en esta barbería (ADR-015).
    const cuenta = await this.usuarios.perfil(usuarioId);
    if (!cuenta) throw new Error('La cuenta recién unida no es visible en su barbería');
    const perfil = PerfilCliente.enLinea({
      id: uuidv7(),
      tenantId,
      usuarioId,
      nombre: NombrePersona.crear(cuenta.nombre),
      correo: Correo.crear(cuenta.correo),
      telefono: union.telefono,
    });
    await this.perfiles.crear(perfil);
    await this.consentimientos.registrar(
      perfil.id,
      union.consentimiento,
      this.tenantContext.datosSolicitud().ip ?? null,
    );
    await this.auditoria.registrar({
      accion: 'CLIENTE_UNIDO',
      actorId: usuarioId,
      recurso: `cliente:${perfil.id}`,
      resultado: 'PERMITIDO',
    });
  }
}

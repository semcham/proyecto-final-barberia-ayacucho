import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ActorActual } from '../../../../shared';
import { ActualizarUsuario } from '../application/actualizar-usuario';
import type { Actor } from '../application/autorizacion';
import { CrearUsuario } from '../application/crear-usuario';
import type { EnlaceActivacion } from '../application/enlace-activacion';
import { ListarUsuarios } from '../application/listar-usuarios';
import { ObtenerUsuario } from '../application/obtener-usuario';
import type { UsuarioDetalle } from '../application/ports/usuario-repository';
import { RegenerarActivacion } from '../application/regenerar-activacion';
import { Operacion } from './operacion.decorator';
import { ActualizarUsuarioDto, CrearUsuarioDto, ListarUsuariosQuery } from './usuarios.dto';

function aUsuario(usuario: UsuarioDetalle) {
  return { ...usuario, creadoEn: usuario.creadoEn.toISOString() };
}

function aEnlace(enlace: EnlaceActivacion) {
  return { enlace: enlace.enlace, venceEn: enlace.venceEn.toISOString() };
}

/**
 * Usuarios del personal de la barbería (RF06, HU04). Solo el PROPIETARIO: el @Operacion es la primera
 * barrera y cada caso de uso vuelve a exigir el permiso (R22). El tenant sale siempre del token.
 */
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly listarUsuarios: ListarUsuarios,
    private readonly obtenerUsuario: ObtenerUsuario,
    private readonly crearUsuario: CrearUsuario,
    private readonly actualizarUsuario: ActualizarUsuario,
    private readonly regenerarActivacion: RegenerarActivacion,
  ) {}

  @Get()
  @Operacion('LISTAR_USUARIOS')
  async listar(@ActorActual() actor: Actor, @Query() consulta: ListarUsuariosQuery) {
    const pagina = await this.listarUsuarios.ejecutar(actor, {
      pagina: consulta.pagina,
      tamano: consulta.tamano,
      rol: consulta.rol,
      estado: consulta.estado,
    });
    return { ...pagina, datos: pagina.datos.map(aUsuario) };
  }

  @Post()
  @HttpCode(201)
  @Operacion('CREAR_USUARIO')
  async crear(@ActorActual() actor: Actor, @Body() dto: CrearUsuarioDto) {
    const { usuario, activacion } = await this.crearUsuario.ejecutar(actor, dto);
    return { usuario: aUsuario(usuario), activacion: aEnlace(activacion) };
  }

  @Get(':id')
  @Operacion('VER_USUARIO')
  async obtener(@ActorActual() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return aUsuario(await this.obtenerUsuario.ejecutar(actor, id));
  }

  @Patch(':id')
  @Operacion('ACTUALIZAR_USUARIO')
  async actualizar(
    @ActorActual() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarUsuarioDto,
  ) {
    return aUsuario(await this.actualizarUsuario.ejecutar(actor, id, dto.estado));
  }

  @Post(':id/activacion')
  @HttpCode(201)
  @Operacion('REGENERAR_ACTIVACION')
  async regenerar(@ActorActual() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return aEnlace(await this.regenerarActivacion.ejecutar(actor, id));
  }
}

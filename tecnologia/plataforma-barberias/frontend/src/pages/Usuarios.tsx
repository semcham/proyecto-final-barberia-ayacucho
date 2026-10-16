import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, llamarApi } from '../api/client';
import type { components } from '../api/schema';
import { useSesion } from '../auth/SesionProvider';
import { EncabezadoPagina } from '../components/app/EncabezadoPagina';
import { Icono } from '../components/Icono';
import { iniciales } from '../components/iniciales';
import {
  Alerta,
  Boton,
  BotonIcono,
  Campo,
  Esqueleto,
  EstadoVacio,
  EtiquetaEstado,
  Menu,
  MenuContenido,
  MenuDisparador,
  MenuItem,
  MenuSeparador,
  ModalConfirmacion,
  type TonoEtiqueta,
  useAvisos,
} from '../components/ui';
import { DialogoEnlace } from './DialogoEnlace';
import estilos from './Usuarios.module.css';

type Usuario = components['schemas']['Usuario'];
type PaginaUsuarios = components['schemas']['PaginaUsuarios'];
type UsuarioCreado = components['schemas']['UsuarioCreadoResponse'];
type EnlaceActivacion = components['schemas']['EnlaceActivacion'];
type FiltroEstado = '' | Usuario['estado'];
type TipoAccion = 'desactivar' | 'reactivar' | 'regenerar';

const TAMANO_PAGINA = 20;

const ETIQUETA_ESTADO: Record<Usuario['estado'], string> = {
  PENDIENTE: 'Pendiente de activar',
  ACTIVA: 'Activo',
  DESACTIVADA: 'Desactivado',
};

const TONO_ESTADO: Record<Usuario['estado'], TonoEtiqueta> = {
  PENDIENTE: 'aviso',
  ACTIVA: 'exito',
  DESACTIVADA: 'neutro',
};

const esquemaNuevo = z.object({
  nombre: z.string().trim().min(2, 'Ingresa el nombre (al menos 2 caracteres).').max(120),
  correo: z.string().trim().max(254).email('Ingresa un correo válido.'),
});
type FormularioNuevo = z.infer<typeof esquemaNuevo>;

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No pudimos conectar con el servidor. Intenta de nuevo.';
  if (error.codigo === 'SUSCRIPCION_NO_PERMITE') {
    const maximo = error.detalles.find((detalle) => detalle.motivo === 'LIMITE_USUARIOS')?.maximo;
    return maximo
      ? `Tu plan permite hasta ${maximo} usuarios, contándote a ti. Desactiva a alguien o cambia de plan.`
      : error.message;
  }
  return error.message;
}

/** Texto sin tildes y en minúsculas, para buscar "Huamán" escribiendo "huaman". */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Textos del modal de confirmación de cada acción por fila. */
function textosAccion(tipo: TipoAccion, nombre: string) {
  switch (tipo) {
    case 'desactivar':
      return {
        titulo: `¿Desactivar a ${nombre}?`,
        descripcion:
          'Ya no podrá ingresar y se cerrarán sus sesiones abiertas. Podrás reactivar su cuenta cuando quieras.',
        confirmar: 'Sí, desactivar',
        variante: 'peligro' as const,
      };
    case 'reactivar':
      return {
        titulo: `¿Reactivar a ${nombre}?`,
        descripcion:
          'Podrá volver a ingresar con su correo y su contraseña. Su cuenta vuelve a contar para el límite de tu plan.',
        confirmar: 'Reactivar',
        variante: 'primario' as const,
      };
    case 'regenerar':
      return {
        titulo: `¿Generar un nuevo enlace para ${nombre}?`,
        descripcion: 'El enlace anterior dejará de funcionar. Entrégale el nuevo para que active su cuenta.',
        confirmar: 'Generar enlace',
        variante: 'primario' as const,
      };
  }
}

/** Usuarios del personal de la barbería (HU04, RF06). Solo para el propietario. */
export default function Usuarios() {
  const { usuario: yo } = useSesion();
  const avisar = useAvisos();
  const clienteConsultas = useQueryClient();
  const [estado, setEstado] = useState<FiltroEstado>('');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [enlace, setEnlace] = useState<EnlaceActivacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<{ tipo: TipoAccion; usuario: Usuario } | null>(null);
  // Botón de acciones de cada fila, para devolverle el foco al cerrar el modal de confirmación.
  const disparadores = useRef(new Map<string, HTMLButtonElement>());
  const focoAccion = useRef<HTMLElement | null>(null);

  const abrirAccion = (tipo: TipoAccion, usuario: Usuario) => {
    focoAccion.current = disparadores.current.get(usuario.id) ?? null;
    setAccion({ tipo, usuario });
  };

  const consulta = useQuery({
    queryKey: ['usuarios', estado, pagina],
    queryFn: () =>
      llamarApi<PaginaUsuarios>(
        `/usuarios?pagina=${pagina}&tamano=${TAMANO_PAGINA}${estado ? `&estado=${estado}` : ''}`,
      ),
  });

  const recargar = () => clienteConsultas.invalidateQueries({ queryKey: ['usuarios'] });

  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors },
  } = useForm<FormularioNuevo>({ resolver: zodResolver(esquemaNuevo) });

  const crear = useMutation({
    mutationFn: (datos: FormularioNuevo) =>
      llamarApi<UsuarioCreado>('/usuarios', { metodo: 'POST', cuerpo: { ...datos, rol: 'BARBERO' } }),
    onSuccess: (respuesta) => {
      setError(null);
      setEnlace(respuesta.activacion);
      reset();
      void recargar();
    },
    onError: (causa) => setError(mensajeDeError(causa)),
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, nuevo }: { id: string; nuevo: 'ACTIVA' | 'DESACTIVADA' }) =>
      llamarApi<Usuario>(`/usuarios/${id}`, { metodo: 'PATCH', cuerpo: { estado: nuevo } }),
    onSuccess: () => void recargar(),
  });

  const regenerar = useMutation({
    mutationFn: (id: string) => llamarApi<EnlaceActivacion>(`/usuarios/${id}/activacion`, { metodo: 'POST' }),
  });

  const confirmarAccion = async () => {
    if (!accion) return;
    const { tipo, usuario } = accion;
    try {
      if (tipo === 'regenerar') {
        const nuevo = await regenerar.mutateAsync(usuario.id);
        setAccion(null);
        setEnlace(nuevo);
        return;
      }
      await cambiarEstado.mutateAsync({
        id: usuario.id,
        nuevo: tipo === 'desactivar' ? 'DESACTIVADA' : 'ACTIVA',
      });
      setAccion(null);
      avisar(
        tipo === 'desactivar'
          ? {
              tono: 'exito',
              titulo: `Cuenta de ${usuario.nombre} desactivada`,
              descripcion: 'Ya no puede ingresar a la barbería.',
            }
          : {
              tono: 'exito',
              titulo: `Cuenta de ${usuario.nombre} reactivada`,
              descripcion: 'Ya puede volver a ingresar.',
            },
      );
    } catch (causa) {
      setAccion(null);
      avisar({ tono: 'error', titulo: 'No se pudo completar la acción', descripcion: mensajeDeError(causa) });
    }
  };

  const datos = consulta.data;
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / TAMANO_PAGINA)) : 1;
  const termino = normalizar(busqueda.trim());
  const visibles = (datos?.datos ?? []).filter(
    (u) => !termino || normalizar(u.nombre).includes(termino) || normalizar(u.correo).includes(termino),
  );
  const sinBarberos = !!datos && !estado && !termino && !datos.datos.some((u) => u.rol === 'BARBERO');
  const textos = accion && textosAccion(accion.tipo, accion.usuario.nombre);

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Usuarios' }]}
        antetitulo="Equipo"
        titulo="Usuarios"
        descripcion="Crea cuentas para tus barberos y controla quién puede ingresar a la barbería."
      />

      <div className={estilos.distribucion}>
        <section aria-labelledby="titulo-nuevo" className={`tarjeta ${estilos.nuevo}`}>
          <h2 id="titulo-nuevo">Nuevo barbero</h2>
          <p className={`texto-suave ${estilos.ayudaNuevo}`}>
            Le generaremos un enlace para que cree su propia contraseña.
          </p>
          <form className={estilos.formulario} onSubmit={handleSubmit((d) => crear.mutate(d))} noValidate>
            <Campo
              id="nombre-barbero"
              etiqueta="Nombre"
              icono="usuario"
              autoComplete="off"
              placeholder="Ej.: Luis Huamán"
              registro={register('nombre')}
              error={errors.nombre?.message}
            />
            <Campo
              id="correo-barbero"
              etiqueta="Correo"
              icono="correo"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="Ej.: luis@correo.com"
              registro={register('correo')}
              error={errors.correo?.message}
            />
            {error && <Alerta>{error}</Alerta>}
            <Boton type="submit" bloque icono="mas" cargando={crear.isPending} textoCargando="Creando…">
              Crear barbero
            </Boton>
          </form>
        </section>

        <section aria-labelledby="titulo-equipo" className={estilos.columna}>
          <h2 id="titulo-equipo" className="sr-only">
            Equipo de la barbería
          </h2>
          <div className={estilos.herramientas}>
            <div className={`campo ${estilos.buscar}`}>
              <label htmlFor="buscar-usuario" className="campo__etiqueta">
                Buscar
              </label>
              <div className="campo__control">
                <span className="campo__icono">
                  <Icono nombre="buscar" />
                </span>
                <input
                  id="buscar-usuario"
                  type="search"
                  className="entrada entrada--con-icono"
                  placeholder="Nombre o correo"
                  autoComplete="off"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
              </div>
            </div>
            <div className={`campo ${estilos.filtro}`}>
              <label htmlFor="filtro-estado" className="campo__etiqueta">
                Mostrar
              </label>
              <select
                id="filtro-estado"
                className="entrada"
                value={estado}
                onChange={(e) => {
                  setEstado(e.target.value as FiltroEstado);
                  setPagina(1);
                }}
              >
                <option value="">Todos</option>
                <option value="ACTIVA">Activos</option>
                <option value="PENDIENTE">Pendientes de activar</option>
                <option value="DESACTIVADA">Desactivados</option>
              </select>
            </div>
          </div>

          {datos && (
            <p className={estilos.total} aria-live="polite">
              {termino
                ? `${visibles.length} de ${datos.datos.length} ${datos.datos.length === 1 ? 'persona' : 'personas'}`
                : `${datos.total} ${datos.total === 1 ? 'persona' : 'personas'}`}
            </p>
          )}

          {consulta.isPending && (
            <div className={estilos.lista} aria-busy="true">
              <span className="sr-only">Cargando usuarios…</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className={estilos.usuario} aria-hidden="true">
                  <div className={estilos.persona}>
                    <Esqueleto ancho="2.5rem" alto="2.5rem" redondo />
                    <div className={estilos.esqueletoTextos}>
                      <Esqueleto ancho="9rem" alto="0.9rem" />
                      <Esqueleto ancho="12rem" alto="0.75rem" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {consulta.isError && (
            <EstadoVacio
              icono="alerta"
              titulo="No pudimos cargar a tu equipo"
              descripcion={mensajeDeError(consulta.error)}
              accion={
                <Boton variante="secundario" icono="recargar" onClick={() => void consulta.refetch()}>
                  Reintentar
                </Boton>
              }
            />
          )}

          {datos && visibles.length === 0 && (
            <EstadoVacio
              titulo={termino ? 'Sin resultados' : 'No hay usuarios con este filtro'}
              descripcion={
                termino
                  ? `Nadie coincide con «${busqueda.trim()}». Revisa lo que escribiste o busca por correo.`
                  : 'Prueba con otro estado en «Mostrar».'
              }
            />
          )}

          {datos && visibles.length > 0 && (
            <>
              <div className={estilos.cabeceraLista} aria-hidden="true">
                <span>Persona</span>
                <span>Rol</span>
                <span>Estado</span>
                <span />
              </div>
              <ul className={estilos.lista} aria-label="Usuarios de la barbería">
                {visibles.map((usuario) => {
                  const esPropietario = usuario.rol === 'PROPIETARIO';
                  const soyYo = usuario.id === yo?.id;
                  const clase =
                    usuario.estado === 'DESACTIVADA'
                      ? `${estilos.usuario} ${estilos.inactivo}`
                      : estilos.usuario;
                  return (
                    <li key={usuario.id} className={clase}>
                      <div className={estilos.persona}>
                        <span className={estilos.avatar} aria-hidden="true">
                          {iniciales(usuario.nombre)}
                        </span>
                        <div className={estilos.datos}>
                          <span className={estilos.nombre}>
                            <strong>{usuario.nombre}</strong>
                            {soyYo && <EtiquetaEstado tono="acento">Tú</EtiquetaEstado>}
                          </span>
                          <span className={estilos.correo} title={usuario.correo}>
                            {usuario.correo}
                          </span>
                        </div>
                      </div>
                      <div className={estilos.etiquetas}>
                        <span className={estilos.celdaRol}>
                          <EtiquetaEstado tono="contorno">
                            {esPropietario ? 'Propietario' : 'Barbero'}
                          </EtiquetaEstado>
                        </span>
                        <span className={estilos.celdaEstado}>
                          <EtiquetaEstado tono={TONO_ESTADO[usuario.estado]}>
                            {ETIQUETA_ESTADO[usuario.estado]}
                          </EtiquetaEstado>
                        </span>
                      </div>
                      <div className={estilos.acciones}>
                        {!esPropietario && !soyYo && (
                          <Menu>
                            <MenuDisparador asChild>
                              <BotonIcono
                                ref={(boton) => {
                                  if (boton) disparadores.current.set(usuario.id, boton);
                                  else disparadores.current.delete(usuario.id);
                                }}
                                icono="puntos"
                                etiqueta={`Acciones para ${usuario.nombre}`}
                              />
                            </MenuDisparador>
                            <MenuContenido>
                              {usuario.estado === 'PENDIENTE' && (
                                <MenuItem icono="enlace" onSelect={() => abrirAccion('regenerar', usuario)}>
                                  Nuevo enlace de activación
                                </MenuItem>
                              )}
                              {usuario.estado === 'DESACTIVADA' ? (
                                <MenuItem icono="recargar" onSelect={() => abrirAccion('reactivar', usuario)}>
                                  Reactivar
                                </MenuItem>
                              ) : (
                                <>
                                  {usuario.estado === 'PENDIENTE' && <MenuSeparador />}
                                  <MenuItem
                                    icono="bloquear"
                                    peligro
                                    onSelect={() => abrirAccion('desactivar', usuario)}
                                  >
                                    Desactivar
                                  </MenuItem>
                                </>
                              )}
                            </MenuContenido>
                          </Menu>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {sinBarberos && (
            <EstadoVacio
              icono="usuarios"
              titulo="Aún no tienes barberos"
              descripcion="Crea el primero con el formulario «Nuevo barbero». Le daremos un enlace para que active su cuenta."
            />
          )}

          {paginas > 1 && (
            <nav className={estilos.paginacion} aria-label="Páginas">
              <Boton
                variante="secundario"
                tamano="sm"
                icono="chevronIzquierda"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
              >
                Anterior
              </Boton>
              <span>
                Página {pagina} de {paginas}
              </span>
              <Boton
                variante="secundario"
                tamano="sm"
                iconoFinal="chevronDerecha"
                disabled={pagina >= paginas}
                onClick={() => setPagina((p) => p + 1)}
              >
                Siguiente
              </Boton>
            </nav>
          )}
        </section>
      </div>

      <DialogoEnlace
        enlace={enlace}
        onCerrar={() => setEnlace(null)}
        alCerrarSinOrigen={() => setFocus('nombre')}
      />

      <ModalConfirmacion
        abierto={accion !== null}
        onAbiertoCambia={(abierto) => !abierto && setAccion(null)}
        titulo={textos?.titulo ?? ''}
        descripcion={textos?.descripcion ?? ''}
        textoConfirmar={textos?.confirmar ?? ''}
        variante={textos?.variante ?? 'peligro'}
        cargando={cambiarEstado.isPending || regenerar.isPending}
        onConfirmar={() => void confirmarAccion()}
        focoAlCerrar={focoAccion}
      />
    </>
  );
}

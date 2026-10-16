import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, llamarApi } from '../api/client';
import type { components } from '../api/schema';
import { useSesion } from '../auth/SesionProvider';
import { AlertaError, Campo } from '../components/Campo';
import { Icono } from '../components/Icono';
import { iniciales } from '../components/iniciales';
import estilos from './Usuarios.module.css';

type Usuario = components['schemas']['Usuario'];
type PaginaUsuarios = components['schemas']['PaginaUsuarios'];
type UsuarioCreado = components['schemas']['UsuarioCreadoResponse'];
type EnlaceActivacion = components['schemas']['EnlaceActivacion'];
type FiltroEstado = '' | Usuario['estado'];

const TAMANO_PAGINA = 20;

const ETIQUETA_ESTADO: Record<Usuario['estado'], string> = {
  PENDIENTE: 'Pendiente de activar',
  ACTIVA: 'Activo',
  DESACTIVADA: 'Desactivado',
};

const CLASE_ESTADO: Record<Usuario['estado'], string> = {
  PENDIENTE: 'etiqueta etiqueta--pendiente',
  ACTIVA: 'etiqueta etiqueta--activa',
  DESACTIVADA: 'etiqueta etiqueta--desactivada',
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

function DialogoEnlace({ enlace, onCerrar }: { enlace: EnlaceActivacion; onCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    await navigator.clipboard.writeText(enlace.enlace);
    setCopiado(true);
  };
  return (
    <div role="dialog" aria-labelledby="titulo-enlace" className={`tarjeta ${estilos.dialogo}`}>
      <div className={estilos.dialogoCabecera}>
        <span className={estilos.iconoDialogo}>
          <Icono nombre="enlace" />
        </span>
        <div>
          <h2 id="titulo-enlace">Enlace de activación</h2>
          <p className="texto-suave">
            Entrégaselo al barbero para que cree su contraseña. Sirve una sola vez y vence el{' '}
            {new Date(enlace.venceEn).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })}.
          </p>
        </div>
      </div>
      <div className={estilos.copiar}>
        <input
          readOnly
          className={`entrada ${estilos.enlace}`}
          value={enlace.enlace}
          aria-label="Enlace de activación"
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="boton boton--primario" onClick={copiar}>
          <Icono nombre={copiado ? 'check' : 'copiar'} tamano={18} />
          {copiado ? 'Copiado' : 'Copiar enlace'}
        </button>
      </div>
      <div className={estilos.dialogoPie}>
        <button type="button" className="boton boton--fantasma boton--pequeno" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

/** Usuarios del personal de la barbería (HU04, RF06). Solo para el propietario. */
export default function Usuarios() {
  const { usuario: yo } = useSesion();
  const clienteConsultas = useQueryClient();
  const [estado, setEstado] = useState<FiltroEstado>('');
  const [pagina, setPagina] = useState(1);
  const [enlace, setEnlace] = useState<EnlaceActivacion | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    onSuccess: () => {
      setError(null);
      void recargar();
    },
    onError: (causa) => setError(mensajeDeError(causa)),
  });

  const regenerar = useMutation({
    mutationFn: (id: string) => llamarApi<EnlaceActivacion>(`/usuarios/${id}/activacion`, { metodo: 'POST' }),
    onSuccess: (respuesta) => {
      setError(null);
      setEnlace(respuesta);
    },
    onError: (causa) => setError(mensajeDeError(causa)),
  });

  const desactivar = (usuario: Usuario) => {
    if (window.confirm(`¿Desactivar a ${usuario.nombre}? Ya no podrá ingresar y se cerrarán sus sesiones.`)) {
      cambiarEstado.mutate({ id: usuario.id, nuevo: 'DESACTIVADA' });
    }
  };

  const datos = consulta.data;
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / TAMANO_PAGINA)) : 1;

  return (
    <main className="contenedor">
      <header className={estilos.cabecera}>
        <p className="antetitulo">Equipo</p>
        <h1>Usuarios</h1>
        <p className="texto-suave">
          Crea cuentas para tus barberos y controla quién puede ingresar a la barbería.
        </p>
      </header>

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
              registro={register('correo')}
              error={errors.correo?.message}
            />
            <button
              type="submit"
              className="boton boton--primario boton--bloque"
              disabled={crear.isPending}
              aria-busy={crear.isPending || undefined}
            >
              {crear.isPending ? (
                <span className="girador" aria-hidden="true" />
              ) : (
                <Icono nombre="mas" tamano={18} />
              )}
              {crear.isPending ? 'Creando…' : 'Crear barbero'}
            </button>
          </form>
        </section>

        <div className={estilos.columna}>
          {enlace && <DialogoEnlace enlace={enlace} onCerrar={() => setEnlace(null)} />}

          {error && <AlertaError>{error}</AlertaError>}

          <div className={estilos.herramientas}>
            <div className={estilos.filtro}>
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
            {datos && (
              <p className={estilos.total}>{datos.total === 1 ? '1 persona' : `${datos.total} personas`}</p>
            )}
          </div>

          {consulta.isPending && (
            <p className={estilos.estadoLista} aria-busy="true">
              <span className="girador" aria-hidden="true" />
              Cargando usuarios…
            </p>
          )}
          {consulta.isError && (
            <p className={`mensaje-error ${estilos.estadoLista}`}>
              <Icono nombre="alerta" tamano={16} />
              {mensajeDeError(consulta.error)}
            </p>
          )}

          {datos && datos.datos.length === 0 && (
            <p className={estilos.estadoLista}>No hay usuarios con este filtro.</p>
          )}

          {datos && datos.datos.length > 0 && (
            <ul className={estilos.lista} aria-label="Usuarios de la barbería">
              {datos.datos.map((usuario) => {
                const esPropietario = usuario.rol === 'PROPIETARIO';
                const soyYo = usuario.id === yo?.id;
                const clase =
                  usuario.estado === 'DESACTIVADA'
                    ? `${estilos.usuario} ${estilos.inactivo}`
                    : estilos.usuario;
                return (
                  <li key={usuario.id} className={clase}>
                    <span className={estilos.avatar} aria-hidden="true">
                      {iniciales(usuario.nombre)}
                    </span>
                    <div className={estilos.datos}>
                      <strong>{usuario.nombre}</strong>
                      <span className={estilos.correo}>{usuario.correo}</span>
                      <span className={estilos.etiquetas}>
                        <span className="etiqueta etiqueta--rol">
                          {esPropietario ? 'Propietario' : 'Barbero'}
                        </span>
                        <span className={CLASE_ESTADO[usuario.estado]}>
                          {ETIQUETA_ESTADO[usuario.estado]}
                        </span>
                        {soyYo && <span className="etiqueta etiqueta--rol">Tú</span>}
                      </span>
                    </div>
                    {!esPropietario && !soyYo && (
                      <div className={estilos.acciones}>
                        {usuario.estado === 'PENDIENTE' && (
                          <button
                            type="button"
                            className="boton boton--secundario boton--pequeno"
                            onClick={() => regenerar.mutate(usuario.id)}
                          >
                            <Icono nombre="enlace" tamano={16} />
                            Nuevo enlace
                          </button>
                        )}
                        {usuario.estado === 'DESACTIVADA' ? (
                          <button
                            type="button"
                            className="boton boton--secundario boton--pequeno"
                            onClick={() => cambiarEstado.mutate({ id: usuario.id, nuevo: 'ACTIVA' })}
                          >
                            <Icono nombre="recargar" tamano={16} />
                            Reactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="boton boton--peligro boton--pequeno"
                            onClick={() => desactivar(usuario)}
                          >
                            <Icono nombre="bloquear" tamano={16} />
                            Desactivar
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {paginas > 1 && (
            <nav className={estilos.paginacion} aria-label="Páginas">
              <button
                type="button"
                className="boton boton--secundario boton--pequeno"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
              >
                Anterior
              </button>
              <span>
                Página {pagina} de {paginas}
              </span>
              <button
                type="button"
                className="boton boton--secundario boton--pequeno"
                disabled={pagina >= paginas}
                onClick={() => setPagina((p) => p + 1)}
              >
                Siguiente
              </button>
            </nav>
          )}
        </div>
      </div>
    </main>
  );
}

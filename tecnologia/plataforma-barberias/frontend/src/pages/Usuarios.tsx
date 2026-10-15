import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, llamarApi } from '../api/client';
import type { components } from '../api/schema';
import { useSesion } from '../auth/SesionProvider';
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
    <div role="dialog" aria-labelledby="titulo-enlace" className={estilos.dialogo}>
      <h2 id="titulo-enlace">Enlace de activación</h2>
      <p>
        Entrégaselo al barbero para que cree su contraseña. Sirve una sola vez y vence el{' '}
        {new Date(enlace.venceEn).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })}.
      </p>
      <input
        readOnly
        value={enlace.enlace}
        aria-label="Enlace de activación"
        onFocus={(e) => e.target.select()}
      />
      <div className={estilos.acciones}>
        <button type="button" onClick={copiar}>
          {copiado ? 'Copiado' : 'Copiar enlace'}
        </button>
        <button type="button" className={estilos.secundario} onClick={onCerrar}>
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
      <h1>Usuarios</h1>

      <section aria-labelledby="titulo-nuevo" className={estilos.tarjeta}>
        <h2 id="titulo-nuevo">Nuevo barbero</h2>
        <form className={estilos.formulario} onSubmit={handleSubmit((d) => crear.mutate(d))} noValidate>
          <label htmlFor="nombre-barbero">Nombre</label>
          <input id="nombre-barbero" autoComplete="off" {...register('nombre')} />
          {errors.nombre && <p className="mensaje-error">{errors.nombre.message}</p>}
          <label htmlFor="correo-barbero">Correo</label>
          <input
            id="correo-barbero"
            type="email"
            inputMode="email"
            autoComplete="off"
            {...register('correo')}
          />
          {errors.correo && <p className="mensaje-error">{errors.correo.message}</p>}
          <button type="submit" disabled={crear.isPending}>
            {crear.isPending ? 'Creando…' : 'Crear barbero'}
          </button>
        </form>
      </section>

      {enlace && <DialogoEnlace enlace={enlace} onCerrar={() => setEnlace(null)} />}

      {error && (
        <p role="alert" className="mensaje-error">
          {error}
        </p>
      )}

      <div className={estilos.filtro}>
        <label htmlFor="filtro-estado">Mostrar</label>
        <select
          id="filtro-estado"
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

      {consulta.isPending && <p>Cargando usuarios…</p>}
      {consulta.isError && <p className="mensaje-error">{mensajeDeError(consulta.error)}</p>}

      {datos && (
        <ul className={estilos.lista} aria-label="Usuarios de la barbería">
          {datos.datos.map((usuario) => {
            const esPropietario = usuario.rol === 'PROPIETARIO';
            const soyYo = usuario.id === yo?.id;
            return (
              <li key={usuario.id} className={estilos.usuario}>
                <div>
                  <strong>{usuario.nombre}</strong>
                  <span>{usuario.correo}</span>
                  <span>
                    {esPropietario ? 'Propietario' : 'Barbero'} · {ETIQUETA_ESTADO[usuario.estado]}
                  </span>
                </div>
                {!esPropietario && !soyYo && (
                  <div className={estilos.acciones}>
                    {usuario.estado === 'PENDIENTE' && (
                      <button
                        type="button"
                        className={estilos.secundario}
                        onClick={() => regenerar.mutate(usuario.id)}
                      >
                        Nuevo enlace
                      </button>
                    )}
                    {usuario.estado === 'DESACTIVADA' ? (
                      <button
                        type="button"
                        onClick={() => cambiarEstado.mutate({ id: usuario.id, nuevo: 'ACTIVA' })}
                      >
                        Reactivar
                      </button>
                    ) : (
                      <button type="button" className={estilos.peligro} onClick={() => desactivar(usuario)}>
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
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          <span>
            Página {pagina} de {paginas}
          </span>
          <button type="button" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Siguiente
          </button>
        </nav>
      )}
    </main>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components as c001 } from '../../api/schema';
import type { components } from '../../api/schema-002';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { type CitaAfectada, citasEnConflicto, ModalConflictos } from '../../components/app/ModalConflictos';
import { Alerta, Boton, Campo, EstadoVacio, EtiquetaEstado, Tarjeta, useAvisos } from '../../components/ui';
import { Cargando } from './Cargando';
import { mensajeDeError, useZonaBarberia } from './datos-barberia';
import estilos from './Panel.module.css';

type Barbero = components['schemas']['Barbero'];
type Servicio = components['schemas']['Servicio'];
type PaginaUsuarios = c001['schemas']['PaginaUsuarios'];

const esquema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Ingresa el nombre (al menos 2 caracteres).')
    .max(80, 'Máximo 80 caracteres.'),
  // Con una sola casilla, react-hook-form puede entregar el valor suelto (o false): se normaliza a lista.
  servicioIds: z.preprocess(
    (valor) => (Array.isArray(valor) ? valor : typeof valor === 'string' ? [valor] : []),
    z.array(z.string()),
  ),
  usuarioId: z.string(),
});
type Formulario = z.infer<typeof esquema>;
const VACIO: Formulario = { nombre: '', servicioIds: [], usuarioId: '' };

/** Mensaje de un error al crear o editar un barbero; el límite del plan con su máximo. */
function mensajeBarbero(error: unknown): string {
  if (error instanceof ApiError && error.codigo === 'SUSCRIPCION_NO_PERMITE') {
    const maximo = error.detalles.find((d) => d.motivo === 'LIMITE_BARBEROS')?.maximo;
    if (maximo) {
      return `Tu plan permite hasta ${maximo} barberos activos. Desactiva a alguno o cambia de plan.`;
    }
  }
  return mensajeDeError(error);
}

/** Barberos de la barbería (HU12, RF08): servicios que ofrece, vínculo con un usuario y estado. */
export default function Barberos() {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const zona = useZonaBarberia();
  const [editando, setEditando] = useState<Barbero | null>(null);
  const [desactivando, setDesactivando] = useState<{ barbero: Barbero; citas: CitaAfectada[] } | null>(null);

  const barberos = useQuery({
    queryKey: clavesConsulta.barberos,
    queryFn: () => llamarApi<Barbero[]>('/barberos'),
  });
  const servicios = useQuery({
    queryKey: clavesConsulta.servicios,
    queryFn: () => llamarApi<Servicio[]>('/servicios'),
  });
  const personal = useQuery({
    queryKey: clavesConsulta.personal,
    queryFn: () => llamarApi<PaginaUsuarios>('/usuarios?estado=ACTIVA&tamano=100'),
  });
  const recargar = () => consultas.invalidateQueries({ queryKey: clavesConsulta.barberos });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema), defaultValues: VACIO });

  const guardar = useMutation({
    mutationFn: (datos: Formulario) => {
      const cuerpo = {
        nombre: datos.nombre,
        servicioIds: datos.servicioIds,
        usuarioId: datos.usuarioId || null,
      };
      return editando
        ? llamarApi<Barbero>(`/barberos/${editando.id}`, { metodo: 'PATCH', cuerpo })
        : llamarApi<Barbero>('/barberos', { metodo: 'POST', cuerpo });
    },
    onSuccess: () => {
      avisar({ tono: 'exito', titulo: editando ? 'Barbero actualizado' : 'Barbero agregado' });
      setEditando(null);
      reset(VACIO);
      void recargar();
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: ({
      barbero,
      activo,
      confirmar,
    }: {
      barbero: Barbero;
      activo: boolean;
      confirmar?: boolean;
    }) =>
      llamarApi<Barbero>(`/barberos/${barbero.id}`, {
        metodo: 'PATCH',
        cuerpo: confirmar ? { activo, confirmarConflictos: true } : { activo },
      }),
    onSuccess: (barbero) => {
      setDesactivando(null);
      avisar({ tono: 'exito', titulo: barbero.activo ? 'Barbero reactivado' : 'Barbero desactivado' });
      void recargar();
    },
    onError: (error, { barbero }) => {
      const citas = citasEnConflicto(error);
      if (citas) setDesactivando({ barbero, citas });
      else {
        setDesactivando(null);
        avisar({
          tono: 'error',
          titulo: 'No se pudo cambiar el barbero',
          descripcion: mensajeBarbero(error),
        });
      }
    },
  });

  const editar = (barbero: Barbero) => {
    setEditando(barbero);
    reset({ nombre: barbero.nombre, servicioIds: barbero.servicioIds, usuarioId: barbero.usuarioId ?? '' });
  };

  const nombreServicio = new Map((servicios.data ?? []).map((s) => [s.id, s.nombre]));
  const personas = (personal.data?.datos ?? []).filter((u) => u.estado === 'ACTIVA');
  const nombrePersona = new Map(personas.map((u) => [u.id, u.nombre]));
  // Un usuario se vincula a un solo barbero: se ofrecen los libres (y el del barbero que se edita).
  const vinculados = new Set(
    (barberos.data ?? []).filter((b) => b.usuarioId && b.id !== editando?.id).map((b) => b.usuarioId),
  );
  const titulo = editando ? 'Editar barbero' : 'Nuevo barbero';

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Barberos' }]}
        titulo="Barberos"
        descripcion="Quién atiende y qué servicios ofrece. Su nombre visible aparece en tu catálogo."
      />
      <div className={estilos.distribucion}>
        <Tarjeta titulo={titulo} icono="usuario">
          <form
            aria-label={titulo}
            className={estilos.formulario}
            onSubmit={handleSubmit((datos) => guardar.mutate(datos))}
            noValidate
          >
            <Campo
              id="nombre-barbero"
              etiqueta="Nombre visible"
              registro={register('nombre')}
              error={errors.nombre?.message}
            />
            <fieldset className={estilos.casillas}>
              <legend>Servicios que ofrece</legend>
              {(servicios.data ?? []).length === 0 && (
                <p className={estilos.aviso}>Primero agrega servicios en la pantalla Servicios.</p>
              )}
              {(servicios.data ?? []).map((s) => (
                <label key={s.id} className="casilla">
                  <input type="checkbox" value={s.id} {...register('servicioIds')} />
                  <span>{s.activo ? s.nombre : `${s.nombre} (inactivo)`}</span>
                </label>
              ))}
            </fieldset>
            <div className="campo">
              <label htmlFor="usuario-vinculado" className="campo__etiqueta">
                Usuario vinculado
              </label>
              <select id="usuario-vinculado" className="entrada" {...register('usuarioId')}>
                <option value="">Sin vincular</option>
                {personas
                  .filter((u) => !vinculados.has(u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
              </select>
              <p className="campo__ayuda">Así esa persona podrá ver su agenda y editar su disponibilidad.</p>
            </div>
            {guardar.isError && <Alerta>{mensajeBarbero(guardar.error)}</Alerta>}
            <div className={estilos.acciones}>
              <Boton type="submit" cargando={guardar.isPending} textoCargando="Guardando…">
                {editando ? 'Guardar cambios' : 'Agregar barbero'}
              </Boton>
              {editando && (
                <Boton
                  type="button"
                  variante="secundario"
                  onClick={() => {
                    setEditando(null);
                    reset(VACIO);
                  }}
                >
                  Cancelar
                </Boton>
              )}
            </div>
          </form>
        </Tarjeta>

        <section aria-label="Lista de barberos">
          {barberos.isPending ? (
            <Cargando />
          ) : barberos.isError ? (
            <Alerta>{mensajeDeError(barberos.error)}</Alerta>
          ) : barberos.data.length === 0 ? (
            <EstadoVacio
              icono="usuario"
              titulo="Aún no tienes barberos"
              descripcion="Agrega el primero con el formulario."
            />
          ) : (
            <ul className={estilos.lista}>
              {barberos.data.map((barbero) => (
                <li key={barbero.id} className={estilos.elemento}>
                  <div className={estilos.elementoTextos}>
                    <span className={estilos.elementoNombre}>{barbero.nombre}</span>
                    <span className={estilos.elementoDetalle}>
                      {barbero.servicioIds
                        .map((id) => nombreServicio.get(id))
                        .filter(Boolean)
                        .join(', ') || 'Sin servicios'}
                      {barbero.usuarioId &&
                        ` · Usuario: ${nombrePersona.get(barbero.usuarioId) ?? 'vinculado'}`}
                    </span>
                  </div>
                  <div className={estilos.acciones}>
                    <EtiquetaEstado tono={barbero.activo ? 'exito' : 'neutro'}>
                      {barbero.activo ? 'Activo' : 'Inactivo'}
                    </EtiquetaEstado>
                    <Boton type="button" variante="secundario" tamano="sm" onClick={() => editar(barbero)}>
                      Editar
                    </Boton>
                    <Boton
                      type="button"
                      variante={barbero.activo ? 'fantasma' : 'secundario'}
                      tamano="sm"
                      onClick={() => cambiarEstado.mutate({ barbero, activo: !barbero.activo })}
                    >
                      {barbero.activo ? 'Desactivar' : 'Reactivar'}
                    </Boton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ModalConflictos
        citas={desactivando?.citas ?? null}
        zona={zona}
        futuras
        titulo={`¿Desactivar a ${desactivando?.barbero.nombre ?? 'este barbero'}?`}
        textoConfirmar="Desactivar de todos modos"
        cargando={cambiarEstado.isPending}
        onConfirmar={() =>
          desactivando &&
          cambiarEstado.mutate({ barbero: desactivando.barbero, activo: false, confirmar: true })
        }
        onCancelar={() => setDesactivando(null)}
      />
    </>
  );
}

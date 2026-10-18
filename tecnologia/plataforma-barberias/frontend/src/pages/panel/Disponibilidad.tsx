import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { useSesion } from '../../auth/SesionProvider';
import { EditorSemana, type Tramo, validarSemana } from '../../components/app/EditorSemana';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { type CitaAfectada, citasEnConflicto, ModalConflictos } from '../../components/app/ModalConflictos';
import { Alerta, Boton, Campo, EstadoVacio, Tarjeta, useAvisos } from '../../components/ui';
import { fechaDeBarberia, horaDeBarberia, isoEnZona } from '../../hora-barberia';
import { Cargando } from './Cargando';
import { mensajeDeError, useZonaBarberia } from './datos-barberia';
import estilos from './Panel.module.css';

type Barbero = components['schemas']['Barbero'];
type HorarioSemanal = components['schemas']['HorarioSemanal'];
type Bloqueo = components['schemas']['Bloqueo'];

/**
 * Disponibilidad semanal y bloqueos de cada barbero (HU13, RF09). El propietario elige el barbero; el barbero
 * solo ve el que está vinculado a su usuario. Las horas son las de la barbería.
 */
export default function Disponibilidad() {
  const { usuario } = useSesion();
  const zona = useZonaBarberia();
  const barberos = useQuery({
    queryKey: clavesConsulta.barberos,
    queryFn: () => llamarApi<Barbero[]>('/barberos'),
  });
  const [elegido, setElegido] = useState('');

  const esPropietario = usuario?.rol === 'PROPIETARIO';
  const opciones = (barberos.data ?? []).filter((b) => b.activo);
  const barbero = esPropietario
    ? (opciones.find((b) => b.id === elegido) ?? opciones[0])
    : (barberos.data ?? []).find((b) => b.usuarioId === usuario?.id);

  let contenido;
  if (barberos.isPending) contenido = <Cargando />;
  else if (barberos.isError) contenido = <Alerta>{mensajeDeError(barberos.error)}</Alerta>;
  else if (!barbero) {
    contenido = esPropietario ? (
      <EstadoVacio
        icono="usuario"
        titulo="Aún no tienes barberos activos"
        descripcion="Agrégalos en la pantalla Barberos."
      />
    ) : (
      <EstadoVacio
        icono="usuario"
        titulo="Tu usuario no está vinculado a un barbero"
        descripcion="Pide al propietario que te vincule en la pantalla Barberos."
      />
    );
  } else {
    contenido = (
      <>
        {esPropietario && (
          <div className="campo">
            <label htmlFor="barbero" className="campo__etiqueta">
              Barbero
            </label>
            <select
              id="barbero"
              className="entrada"
              value={barbero.id}
              onChange={(evento) => setElegido(evento.target.value)}
            >
              {opciones.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Con `key`, cambiar de barbero monta formularios nuevos con sus propios datos. */}
        <Semana key={`semana-${barbero.id}`} barbero={barbero} zona={zona} />
        <Bloqueos key={`bloqueos-${barbero.id}`} barbero={barbero} zona={zona} />
      </>
    );
  }

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Disponibilidad' }]}
        titulo="Disponibilidad"
        descripcion="Los días y horas en que cada barbero atiende, y sus ausencias. Siempre dentro del horario de la barbería."
      />
      <div className={estilos.secciones}>{contenido}</div>
    </>
  );
}

function Semana({ barbero, zona }: { barbero: Barbero; zona: string }) {
  const disponibilidad = useQuery({
    queryKey: clavesConsulta.disponibilidad(barbero.id),
    queryFn: () => llamarApi<HorarioSemanal>(`/barberos/${barbero.id}/disponibilidad`),
  });
  return (
    <Tarjeta titulo={`Semana de ${barbero.nombre}`} icono="reloj">
      {disponibilidad.data ? (
        <FormularioSemana barbero={barbero} inicial={disponibilidad.data.tramos} zona={zona} />
      ) : disponibilidad.isError ? (
        <Alerta>{mensajeDeError(disponibilidad.error)}</Alerta>
      ) : (
        <Cargando />
      )}
    </Tarjeta>
  );
}

function FormularioSemana({ barbero, inicial, zona }: { barbero: Barbero; inicial: Tramo[]; zona: string }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const [tramos, setTramos] = useState<Tramo[]>(inicial);
  const [errores, setErrores] = useState<string[]>([]);
  const [conflictos, setConflictos] = useState<CitaAfectada[] | null>(null);

  const guardar = useMutation({
    mutationFn: (confirmarConflictos: boolean) =>
      llamarApi<HorarioSemanal>(`/barberos/${barbero.id}/disponibilidad`, {
        metodo: 'PUT',
        cuerpo: confirmarConflictos ? { tramos, confirmarConflictos } : { tramos },
      }),
    onSuccess: (guardada) => {
      setConflictos(null);
      consultas.setQueryData(clavesConsulta.disponibilidad(barbero.id), guardada);
      avisar({ tono: 'exito', titulo: 'Disponibilidad guardada' });
    },
    onError: (error) => setConflictos(citasEnConflicto(error)),
  });

  const enviar = () => {
    const problemas = validarSemana(tramos);
    setErrores(problemas);
    if (problemas.length === 0) guardar.mutate(false);
  };

  const fueraDelHorario =
    guardar.error instanceof ApiError && guardar.error.codigo === 'FUERA_DEL_HORARIO_DE_ATENCION';

  return (
    <div className={estilos.formulario}>
      <EditorSemana tramos={tramos} onCambio={setTramos} />
      {errores.length > 0 && <Alerta>{errores.join(' ')}</Alerta>}
      {guardar.isError && !conflictos && (
        <Alerta>
          {fueraDelHorario
            ? 'Un tramo queda fuera del horario de atención de la barbería. Ajústalo o amplía el horario en la pantalla Barbería.'
            : mensajeDeError(guardar.error)}
        </Alerta>
      )}
      <div className={estilos.acciones}>
        <Boton
          type="button"
          onClick={enviar}
          cargando={guardar.isPending && !conflictos}
          textoCargando="Guardando…"
        >
          Guardar disponibilidad
        </Boton>
      </div>
      <ModalConflictos
        citas={conflictos}
        zona={zona}
        titulo="La nueva disponibilidad deja citas fuera"
        textoConfirmar="Guardar de todos modos"
        cargando={guardar.isPending}
        onConfirmar={() => guardar.mutate(true)}
        onCancelar={() => setConflictos(null)}
      />
    </div>
  );
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const esquemaBloqueo = z
  .object({
    fechaInicio: z.string().regex(FECHA, 'Elige la fecha de inicio.'),
    horaInicio: z.string().regex(HORA, 'Elige la hora de inicio.'),
    fechaFin: z.string().regex(FECHA, 'Elige la fecha de fin.'),
    horaFin: z.string().regex(HORA, 'Elige la hora de fin.'),
    motivo: z.string().trim().max(200, 'Máximo 200 caracteres.'),
  })
  .refine((b) => `${b.fechaFin}T${b.horaFin}` > `${b.fechaInicio}T${b.horaInicio}`, {
    message: 'El fin debe ser posterior al inicio.',
    path: ['horaFin'],
  });
type FormularioBloqueo = z.infer<typeof esquemaBloqueo>;
type CuerpoBloqueo = { inicio: string; fin: string; motivo: string | null };

function Bloqueos({ barbero, zona }: { barbero: Barbero; zona: string }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const [pendiente, setPendiente] = useState<{ cuerpo: CuerpoBloqueo; citas: CitaAfectada[] } | null>(null);
  const lista = useQuery({
    queryKey: clavesConsulta.bloqueos(barbero.id),
    queryFn: () => llamarApi<Bloqueo[]>(`/barberos/${barbero.id}/bloqueos`),
  });
  const recargar = () => consultas.invalidateQueries({ queryKey: clavesConsulta.bloqueos(barbero.id) });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormularioBloqueo>({
    resolver: zodResolver(esquemaBloqueo),
    defaultValues: { fechaInicio: '', horaInicio: '', fechaFin: '', horaFin: '', motivo: '' },
  });

  const crear = useMutation({
    mutationFn: ({ cuerpo, confirmar }: { cuerpo: CuerpoBloqueo; confirmar: boolean }) =>
      llamarApi<Bloqueo>(`/barberos/${barbero.id}/bloqueos`, {
        metodo: 'POST',
        cuerpo: confirmar ? { ...cuerpo, confirmarConflictos: true } : cuerpo,
      }),
    onSuccess: () => {
      setPendiente(null);
      reset();
      avisar({ tono: 'exito', titulo: 'Bloqueo agregado' });
      void recargar();
    },
    onError: (error, { cuerpo }) => {
      const citas = citasEnConflicto(error);
      setPendiente(citas ? { cuerpo, citas } : null);
    },
  });

  const eliminar = useMutation({
    mutationFn: (id: string) =>
      llamarApi<void>(`/barberos/${barbero.id}/bloqueos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      avisar({ tono: 'exito', titulo: 'Bloqueo eliminado' });
      void recargar();
    },
    onError: (error) =>
      avisar({ tono: 'error', titulo: 'No se pudo eliminar', descripcion: mensajeDeError(error) }),
  });

  const enviar = (datos: FormularioBloqueo) =>
    crear.mutate({
      confirmar: false,
      cuerpo: {
        inicio: isoEnZona(datos.fechaInicio, datos.horaInicio, zona),
        fin: isoEnZona(datos.fechaFin, datos.horaFin, zona),
        motivo: datos.motivo === '' ? null : datos.motivo,
      },
    });

  return (
    <Tarjeta
      titulo="Bloqueos"
      icono="bloquear"
      descripcion="Ausencias puntuales: un trámite, una cita médica, vacaciones."
    >
      <div className={estilos.distribucion}>
        <form
          aria-label="Nuevo bloqueo"
          className={estilos.formulario}
          onSubmit={handleSubmit(enviar)}
          noValidate
        >
          <div className={estilos.fila}>
            <Campo
              id="fecha-inicio"
              etiqueta="Fecha de inicio"
              type="date"
              registro={register('fechaInicio')}
              error={errors.fechaInicio?.message}
            />
            <Campo
              id="hora-inicio"
              etiqueta="Hora de inicio"
              type="time"
              registro={register('horaInicio')}
              error={errors.horaInicio?.message}
            />
          </div>
          <div className={estilos.fila}>
            <Campo
              id="fecha-fin"
              etiqueta="Fecha de fin"
              type="date"
              registro={register('fechaFin')}
              error={errors.fechaFin?.message}
            />
            <Campo
              id="hora-fin"
              etiqueta="Hora de fin"
              type="time"
              registro={register('horaFin')}
              error={errors.horaFin?.message}
            />
          </div>
          <Campo
            id="motivo"
            etiqueta="Motivo (opcional)"
            registro={register('motivo')}
            error={errors.motivo?.message}
            ayuda="Solo lo ve tu equipo."
          />
          {crear.isError && !pendiente && <Alerta>{mensajeDeError(crear.error)}</Alerta>}
          <div className={estilos.acciones}>
            <Boton type="submit" cargando={crear.isPending && !pendiente} textoCargando="Guardando…">
              Agregar bloqueo
            </Boton>
          </div>
        </form>
        <section aria-label="Bloqueos próximos">
          {lista.isPending ? (
            <Cargando />
          ) : lista.isError ? (
            <Alerta>{mensajeDeError(lista.error)}</Alerta>
          ) : lista.data.length === 0 ? (
            <EstadoVacio icono="calendario" titulo="Sin bloqueos próximos" />
          ) : (
            <ul className={estilos.lista}>
              {lista.data.map((b) => (
                <li key={b.id} className={estilos.elemento}>
                  <div className={estilos.elementoTextos}>
                    <span className={estilos.elementoNombre}>
                      {fechaDeBarberia(b.inicio, zona)}, {horaDeBarberia(b.inicio, zona)} a{' '}
                      {fechaDeBarberia(b.fin, zona) === fechaDeBarberia(b.inicio, zona)
                        ? horaDeBarberia(b.fin, zona)
                        : `${fechaDeBarberia(b.fin, zona)}, ${horaDeBarberia(b.fin, zona)}`}
                    </span>
                    {b.motivo && <span className={estilos.elementoDetalle}>{b.motivo}</span>}
                  </div>
                  <Boton type="button" variante="fantasma" tamano="sm" onClick={() => eliminar.mutate(b.id)}>
                    Eliminar
                  </Boton>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ModalConflictos
        citas={pendiente?.citas ?? null}
        zona={zona}
        titulo="El bloqueo choca con citas"
        textoConfirmar="Bloquear de todos modos"
        cargando={crear.isPending}
        onConfirmar={() => pendiente && crear.mutate({ cuerpo: pendiente.cuerpo, confirmar: true })}
        onCancelar={() => setPendiente(null)}
      />
    </Tarjeta>
  );
}

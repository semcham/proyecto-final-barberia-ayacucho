import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { EditorSemana, type Tramo, validarSemana } from '../../components/app/EditorSemana';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { type CitaAfectada, citasEnConflicto, ModalConflictos } from '../../components/app/ModalConflictos';
import { Alerta, Boton, Campo, Tarjeta, useAvisos } from '../../components/ui';
import { Cargando } from './Cargando';
import { type BarberiaConfig, mensajeDeError, useBarberia } from './datos-barberia';
import estilos from './Panel.module.css';

type HorarioSemanal = components['schemas']['HorarioSemanal'];

const opcional = (maximo: number, mensaje: string) => z.string().trim().max(maximo, mensaje);

const esquema = z.object({
  nombre: z.string().trim().min(2, 'Ingresa el nombre (al menos 2 caracteres).').max(120),
  slug: z
    .string()
    .trim()
    .min(3, 'El enlace debe tener entre 3 y 60 caracteres.')
    .max(60, 'El enlace debe tener entre 3 y 60 caracteres.')
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'Usa solo minúsculas, números y guiones (sin guion al inicio ni al final).',
    ),
  direccion: opcional(200, 'La dirección no puede pasar de 200 caracteres.'),
  telefono: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\+?[0-9 ]{6,20}$/.test(v),
      'Ingresa un teléfono válido (de 6 a 20 dígitos).',
    ),
  descripcion: opcional(500, 'La descripción no puede pasar de 500 caracteres.'),
  antelacion: z.coerce
    .number({ invalid_type_error: 'Ingresa los minutos.' })
    .int('Ingresa minutos enteros.')
    .min(0, 'Entre 0 y 4320 minutos (3 días).')
    .max(4320, 'Entre 0 y 4320 minutos (3 días).'),
});
type Formulario = z.infer<typeof esquema>;

const aFormulario = (c: BarberiaConfig): Formulario => ({
  nombre: c.nombre,
  slug: c.slug,
  direccion: c.direccion ?? '',
  telefono: c.telefono ?? '',
  descripcion: c.descripcion ?? '',
  antelacion: c.antelacionCancelacionMinutos,
});

/** Solo los campos que cambiaron, como los espera PATCH /barberia (un texto vacío quita el dato: null). */
function cambiosDe(c: BarberiaConfig, f: Formulario) {
  const nulo = (v: string) => (v === '' ? null : v);
  const cambios: Record<string, unknown> = {};
  if (f.nombre !== c.nombre) cambios.nombre = f.nombre;
  if (f.slug !== c.slug) cambios.slug = f.slug;
  if (nulo(f.direccion) !== c.direccion) cambios.direccion = nulo(f.direccion);
  if (nulo(f.telefono) !== c.telefono) cambios.telefono = nulo(f.telefono);
  if (nulo(f.descripcion) !== c.descripcion) cambios.descripcion = nulo(f.descripcion);
  if (f.antelacion !== c.antelacionCancelacionMinutos) cambios.antelacionCancelacionMinutos = f.antelacion;
  return cambios;
}

/** Datos, enlace público, antelación de cancelación y horario de atención (HU03, RF03). Solo el propietario. */
export default function Barberia() {
  const barberia = useBarberia();
  const horario = useQuery({
    queryKey: clavesConsulta.horarioAtencion,
    queryFn: () => llamarApi<HorarioSemanal>('/barberia/horario'),
  });

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Barbería' }]}
        titulo="Barbería"
        descripcion="Los datos que ven tus clientes, tu enlace para reservar y tu horario de atención."
      />
      <div className={estilos.secciones}>
        <Tarjeta titulo="Datos y enlace" icono="tienda">
          {barberia.data ? (
            <FormularioDatos config={barberia.data} />
          ) : barberia.isError ? (
            <Alerta>{mensajeDeError(barberia.error)}</Alerta>
          ) : (
            <Cargando />
          )}
        </Tarjeta>
        <Tarjeta titulo="Horario de atención" icono="reloj">
          {horario.data && barberia.data ? (
            <FormularioHorario inicial={horario.data.tramos} zona={barberia.data.zonaHoraria} />
          ) : horario.isError ? (
            <Alerta>{mensajeDeError(horario.error)}</Alerta>
          ) : (
            <Cargando />
          )}
        </Tarjeta>
      </div>
    </>
  );
}

function FormularioDatos({ config }: { config: BarberiaConfig }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const {
    register,
    handleSubmit,
    control,
    setError,
    reset,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema), defaultValues: aFormulario(config) });
  const slug = useWatch({ control, name: 'slug' });
  const enlace = `${window.location.origin}/b/${config.slug}`;

  const guardar = useMutation({
    mutationFn: (cambios: Record<string, unknown>) =>
      llamarApi<BarberiaConfig>('/barberia', { metodo: 'PATCH', cuerpo: cambios }),
    onSuccess: (nueva) => {
      consultas.setQueryData(clavesConsulta.barberia, nueva);
      reset(aFormulario(nueva));
      avisar({ tono: 'exito', titulo: 'Datos guardados' });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.codigo === 'ENLACE_NO_DISPONIBLE') {
        setError('slug', { message: 'Ese enlace no está disponible. Elige otro.' });
      }
    },
  });

  const enviar = (datos: Formulario) => {
    const cambios = cambiosDe(config, datos);
    if (Object.keys(cambios).length === 0) {
      avisar({ tono: 'info', titulo: 'No hay cambios que guardar' });
      return;
    }
    guardar.mutate(cambios);
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(enlace);
      avisar({ tono: 'exito', titulo: 'Enlace copiado' });
    } catch {
      avisar({ tono: 'error', titulo: 'No se pudo copiar', descripcion: enlace });
    }
  };

  const errorGeneral =
    guardar.isError &&
    !(guardar.error instanceof ApiError && guardar.error.codigo === 'ENLACE_NO_DISPONIBLE');

  return (
    <form className={estilos.formulario} onSubmit={handleSubmit(enviar)} noValidate>
      <p className={estilos.enlace}>
        <span>Tu enlace para reservar:</span>
        <code>{enlace}</code>
        <Boton type="button" variante="secundario" tamano="sm" icono="copiar" onClick={copiar}>
          Copiar enlace
        </Boton>
      </p>
      <div className={estilos.fila}>
        <Campo
          id="nombre"
          etiqueta="Nombre comercial"
          icono="tienda"
          registro={register('nombre')}
          error={errors.nombre?.message}
        />
        <Campo
          id="slug"
          etiqueta="Enlace"
          icono="enlace"
          autoComplete="off"
          registro={register('slug')}
          error={errors.slug?.message}
          ayuda={
            slug.trim() !== config.slug
              ? 'Al guardar, el enlace anterior dejará de funcionar. Comparte el nuevo con tus clientes.'
              : 'Entre 3 y 60 caracteres: minúsculas, números y guiones.'
          }
        />
      </div>
      <div className={estilos.fila}>
        <Campo
          id="direccion"
          etiqueta="Dirección"
          registro={register('direccion')}
          error={errors.direccion?.message}
        />
        <Campo
          id="telefono"
          etiqueta="Teléfono"
          icono="celular"
          type="tel"
          inputMode="tel"
          registro={register('telefono')}
          error={errors.telefono?.message}
        />
      </div>
      <Campo
        id="descripcion"
        etiqueta="Descripción"
        registro={register('descripcion')}
        error={errors.descripcion?.message}
      />
      <Campo
        id="antelacion"
        etiqueta="Antelación mínima para cancelar (minutos)"
        type="number"
        inputMode="numeric"
        registro={register('antelacion')}
        error={errors.antelacion?.message}
        ayuda="Si un cliente cancela con menos tiempo, la cita queda marcada como cancelación tardía."
      />
      {errorGeneral && <Alerta>{mensajeDeError(guardar.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton type="submit" cargando={guardar.isPending} textoCargando="Guardando…">
          Guardar datos
        </Boton>
      </div>
    </form>
  );
}

function FormularioHorario({ inicial, zona }: { inicial: Tramo[]; zona: string }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const [tramos, setTramos] = useState<Tramo[]>(inicial);
  const [errores, setErrores] = useState<string[]>([]);
  const [conflictos, setConflictos] = useState<CitaAfectada[] | null>(null);

  const guardar = useMutation({
    mutationFn: (confirmarConflictos: boolean) =>
      llamarApi<HorarioSemanal>('/barberia/horario', {
        metodo: 'PUT',
        cuerpo: confirmarConflictos ? { tramos, confirmarConflictos } : { tramos },
      }),
    onSuccess: (guardado) => {
      setConflictos(null);
      consultas.setQueryData(clavesConsulta.horarioAtencion, guardado);
      avisar({ tono: 'exito', titulo: 'Horario guardado' });
    },
    onError: (error) => setConflictos(citasEnConflicto(error)),
  });

  const enviar = () => {
    const problemas = validarSemana(tramos);
    setErrores(problemas);
    if (problemas.length === 0) guardar.mutate(false);
  };

  return (
    <div className={estilos.formulario}>
      <p className={estilos.aviso}>
        Los días sin tramos quedan cerrados. Si cierras a mediodía, agrega dos tramos (mañana y tarde).
      </p>
      <EditorSemana tramos={tramos} onCambio={setTramos} />
      {errores.length > 0 && <Alerta>{errores.join(' ')}</Alerta>}
      {guardar.isError && !conflictos && <Alerta>{mensajeDeError(guardar.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton
          type="button"
          onClick={enviar}
          cargando={guardar.isPending && !conflictos}
          textoCargando="Guardando…"
        >
          Guardar horario
        </Boton>
      </div>
      <ModalConflictos
        citas={conflictos}
        zona={zona}
        titulo="El nuevo horario deja citas fuera"
        textoConfirmar="Guardar de todos modos"
        cargando={guardar.isPending}
        onConfirmar={() => guardar.mutate(true)}
        onCancelar={() => setConflictos(null)}
      />
    </div>
  );
}

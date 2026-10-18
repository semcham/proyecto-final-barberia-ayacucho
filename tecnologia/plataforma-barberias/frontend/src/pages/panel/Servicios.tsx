import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { clavesConsulta } from '../../api/claves';
import { llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { type CitaAfectada, citasEnConflicto, ModalConflictos } from '../../components/app/ModalConflictos';
import { Alerta, Boton, Campo, EstadoVacio, EtiquetaEstado, Tarjeta, useAvisos } from '../../components/ui';
import { Cargando } from './Cargando';
import { mensajeDeError, useZonaBarberia } from './datos-barberia';
import estilos from './Panel.module.css';

type Servicio = components['schemas']['Servicio'];

const esquema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Ingresa el nombre (al menos 2 caracteres).')
    .max(80, 'Máximo 80 caracteres.'),
  precio: z
    .string()
    .trim()
    .regex(/^[0-9]{1,5}(\.[0-9]{1,2})?$/, 'Ingresa el precio en soles, por ejemplo 25 o 25.50.'),
  duracion: z.coerce
    .number({ invalid_type_error: 'Ingresa los minutos.' })
    .int('Ingresa minutos enteros.')
    .min(5, 'Entre 5 y 480 minutos.')
    .max(480, 'Entre 5 y 480 minutos.')
    .refine((v) => v % 5 === 0, 'Usa múltiplos de 5 minutos.'),
  descripcion: z.string().trim().max(300, 'Máximo 300 caracteres.'),
});
type Formulario = z.infer<typeof esquema>;

const VACIO: Formulario = { nombre: '', precio: '', duracion: 30, descripcion: '' };

/** Servicios de la barbería (HU11, RF07): alta, edición y desactivación. Solo el propietario. */
export default function Servicios() {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const zona = useZonaBarberia();
  const [editando, setEditando] = useState<Servicio | null>(null);
  const [desactivando, setDesactivando] = useState<{ servicio: Servicio; citas: CitaAfectada[] } | null>(
    null,
  );

  const lista = useQuery({
    queryKey: clavesConsulta.servicios,
    queryFn: () => llamarApi<Servicio[]>('/servicios'),
  });
  const recargar = () => consultas.invalidateQueries({ queryKey: clavesConsulta.servicios });

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
        precio: datos.precio,
        duracionMinutos: datos.duracion,
        descripcion: datos.descripcion === '' ? null : datos.descripcion,
      };
      return editando
        ? llamarApi<Servicio>(`/servicios/${editando.id}`, { metodo: 'PATCH', cuerpo })
        : llamarApi<Servicio>('/servicios', { metodo: 'POST', cuerpo });
    },
    onSuccess: () => {
      avisar({ tono: 'exito', titulo: editando ? 'Servicio actualizado' : 'Servicio agregado' });
      setEditando(null);
      reset(VACIO);
      void recargar();
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: ({
      servicio,
      activo,
      confirmar,
    }: {
      servicio: Servicio;
      activo: boolean;
      confirmar?: boolean;
    }) =>
      llamarApi<Servicio>(`/servicios/${servicio.id}`, {
        metodo: 'PATCH',
        cuerpo: confirmar ? { activo, confirmarConflictos: true } : { activo },
      }),
    onSuccess: (servicio) => {
      setDesactivando(null);
      avisar({ tono: 'exito', titulo: servicio.activo ? 'Servicio activado' : 'Servicio desactivado' });
      void recargar();
    },
    onError: (error, { servicio }) => {
      const citas = citasEnConflicto(error);
      if (citas) setDesactivando({ servicio, citas });
      else {
        setDesactivando(null);
        avisar({
          tono: 'error',
          titulo: 'No se pudo cambiar el servicio',
          descripcion: mensajeDeError(error),
        });
      }
    },
  });

  const editar = (servicio: Servicio) => {
    setEditando(servicio);
    reset({
      nombre: servicio.nombre,
      precio: servicio.precio,
      duracion: servicio.duracionMinutos,
      descripcion: servicio.descripcion ?? '',
    });
  };

  const titulo = editando ? 'Editar servicio' : 'Nuevo servicio';

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Servicios' }]}
        titulo="Servicios"
        descripcion="Lo que ofreces, con su precio y su duración. Las citas ya reservadas conservan sus datos."
      />
      <div className={estilos.distribucion}>
        <Tarjeta titulo={titulo} icono="tijeras">
          <form
            aria-label={titulo}
            className={estilos.formulario}
            onSubmit={handleSubmit((datos) => guardar.mutate(datos))}
            noValidate
          >
            <Campo
              id="nombre-servicio"
              etiqueta="Nombre"
              registro={register('nombre')}
              error={errors.nombre?.message}
            />
            <div className={estilos.fila}>
              <Campo
                id="precio"
                etiqueta="Precio (S/)"
                inputMode="decimal"
                placeholder="25.00"
                registro={register('precio')}
                error={errors.precio?.message}
              />
              <Campo
                id="duracion"
                etiqueta="Duración (minutos)"
                type="number"
                inputMode="numeric"
                registro={register('duracion')}
                error={errors.duracion?.message}
              />
            </div>
            <Campo
              id="descripcion-servicio"
              etiqueta="Descripción (opcional)"
              registro={register('descripcion')}
              error={errors.descripcion?.message}
            />
            {guardar.isError && <Alerta>{mensajeDeError(guardar.error)}</Alerta>}
            <div className={estilos.acciones}>
              <Boton type="submit" cargando={guardar.isPending} textoCargando="Guardando…">
                {editando ? 'Guardar cambios' : 'Agregar servicio'}
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

        <section aria-label="Lista de servicios">
          {lista.isPending ? (
            <Cargando />
          ) : lista.isError ? (
            <Alerta>{mensajeDeError(lista.error)}</Alerta>
          ) : lista.data.length === 0 ? (
            <EstadoVacio
              icono="tijeras"
              titulo="Aún no tienes servicios"
              descripcion="Agrega el primero con el formulario."
            />
          ) : (
            <ul className={estilos.lista}>
              {lista.data.map((servicio) => (
                <li key={servicio.id} className={estilos.elemento}>
                  <div className={estilos.elementoTextos}>
                    <span className={estilos.elementoNombre}>{servicio.nombre}</span>
                    <span className={estilos.elementoDetalle}>
                      S/ {servicio.precio} · {servicio.duracionMinutos} min
                    </span>
                  </div>
                  <div className={estilos.acciones}>
                    <EtiquetaEstado tono={servicio.activo ? 'exito' : 'neutro'}>
                      {servicio.activo ? 'Activo' : 'Inactivo'}
                    </EtiquetaEstado>
                    <Boton type="button" variante="secundario" tamano="sm" onClick={() => editar(servicio)}>
                      Editar
                    </Boton>
                    <Boton
                      type="button"
                      variante={servicio.activo ? 'fantasma' : 'secundario'}
                      tamano="sm"
                      onClick={() => cambiarEstado.mutate({ servicio, activo: !servicio.activo })}
                    >
                      {servicio.activo ? 'Desactivar' : 'Activar'}
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
        titulo={`¿Desactivar ${desactivando?.servicio.nombre ?? 'el servicio'}?`}
        textoConfirmar="Desactivar de todos modos"
        cargando={cambiarEstado.isPending}
        onConfirmar={() =>
          desactivando &&
          cambiarEstado.mutate({ servicio: desactivando.servicio, activo: false, confirmar: true })
        }
        onCancelar={() => setDesactivando(null)}
      />
    </>
  );
}

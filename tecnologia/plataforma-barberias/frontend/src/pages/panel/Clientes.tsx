import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Icono } from '../../components/Icono';
import { Alerta, Boton, Campo, EstadoVacio, EtiquetaEstado, Tarjeta, useAvisos } from '../../components/ui';
import { VERSION_POLITICA_DATOS } from '../../legal';
import { Cargando } from './Cargando';
import { mensajeDeError } from './datos-barberia';
import estilos from './Panel.module.css';

export type ClienteResumen = components['schemas']['ClienteResumen'];

const esquema = z.object({
  nombre: z.string().trim().min(2, 'Ingresa el nombre (al menos 2 caracteres).').max(120),
  telefono: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{6,20}$/, 'Ingresa un teléfono válido (de 6 a 20 dígitos).'),
  correo: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || z.string().email().safeParse(v).success,
      'Ingresa un correo válido o déjalo vacío.',
    ),
  consentimiento: z.literal(true, {
    errorMap: () => ({ message: 'Confirma que la persona aceptó el tratamiento de sus datos.' }),
  }),
});
type Formulario = z.infer<typeof esquema>;

/**
 * Alta de un cliente presencial sin cuenta (FR-035): nombre, teléfono, correo opcional y la casilla del
 * consentimiento verbal con el texto de la política. La usan Clientes y la cita presencial de la Agenda.
 */
export function FormularioClientePresencial({
  onRegistrado,
}: {
  onRegistrado?: (cliente: ClienteResumen) => void;
}) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema) });

  const registrar = useMutation({
    mutationFn: (datos: Formulario) =>
      llamarApi<ClienteResumen>('/clientes', {
        metodo: 'POST',
        cuerpo: {
          nombre: datos.nombre,
          telefono: datos.telefono,
          correo: datos.correo === '' ? null : datos.correo,
          consentimientoVerbal: true,
          versionPoliticaDatos: VERSION_POLITICA_DATOS,
        },
      }),
    onSuccess: (cliente) => {
      reset();
      void consultas.invalidateQueries({ queryKey: ['clientes'] });
      avisar({ tono: 'exito', titulo: 'Cliente registrado', descripcion: cliente.nombre });
      onRegistrado?.(cliente);
    },
  });

  return (
    <form
      aria-label="Nuevo cliente presencial"
      className={estilos.formulario}
      onSubmit={handleSubmit((datos) => registrar.mutate(datos))}
      noValidate
    >
      <Campo
        id="cliente-nombre"
        etiqueta="Nombre"
        registro={register('nombre')}
        error={errors.nombre?.message}
      />
      <div className={estilos.fila}>
        <Campo
          id="cliente-telefono"
          etiqueta="Teléfono"
          type="tel"
          inputMode="tel"
          registro={register('telefono')}
          error={errors.telefono?.message}
        />
        <Campo
          id="cliente-correo"
          etiqueta="Correo (opcional)"
          type="email"
          inputMode="email"
          registro={register('correo')}
          error={errors.correo?.message}
        />
      </div>
      <fieldset className={estilos.casillas}>
        <legend className="sr-only">Consentimiento</legend>
        <p className={estilos.aviso}>
          Antes de registrar, explica a la persona la política de tratamiento de datos de la barbería (versión{' '}
          {VERSION_POLITICA_DATOS}): sus datos se usan solo para gestionar sus citas.
        </p>
        <label className="casilla">
          <input
            id="consentimiento-verbal"
            type="checkbox"
            aria-invalid={errors.consentimiento ? true : undefined}
            aria-describedby={errors.consentimiento ? 'consentimiento-error' : undefined}
            {...register('consentimiento')}
          />
          <span>La persona aceptó verbalmente el tratamiento de sus datos</span>
        </label>
        {errors.consentimiento && (
          <p id="consentimiento-error" className="mensaje-error">
            <Icono nombre="alerta" tamano={16} />
            {errors.consentimiento.message}
          </p>
        )}
      </fieldset>
      {registrar.isError && <Alerta>{mensajeDeError(registrar.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton type="submit" cargando={registrar.isPending} textoCargando="Registrando…">
          Registrar cliente
        </Boton>
      </div>
    </form>
  );
}

/** Búsqueda de clientes de la barbería por nombre o teléfono (desde 2 caracteres, hasta 20 resultados). */
export function BuscadorClientes({
  etiqueta,
  onElegir,
}: {
  etiqueta: string;
  /** Con esta función, cada resultado tiene un botón "Elegir". */
  onElegir?: (cliente: ClienteResumen) => void;
}) {
  const [texto, setTexto] = useState('');
  const buscar = texto.trim();
  const resultados = useQuery({
    queryKey: ['clientes', buscar],
    queryFn: () => llamarApi<ClienteResumen[]>(`/clientes?buscar=${encodeURIComponent(buscar)}`),
    enabled: buscar.length >= 2,
  });

  return (
    <div className={estilos.formulario}>
      <div className="campo">
        <label htmlFor="buscar-cliente" className="campo__etiqueta">
          {etiqueta}
        </label>
        <input
          id="buscar-cliente"
          type="search"
          className="entrada"
          autoComplete="off"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
        />
      </div>
      {buscar.length < 2 ? (
        <p className={estilos.aviso}>Escribe al menos 2 letras del nombre o dígitos del teléfono.</p>
      ) : resultados.isPending ? (
        <Cargando />
      ) : resultados.isError ? (
        <Alerta>{mensajeDeError(resultados.error)}</Alerta>
      ) : resultados.data.length === 0 ? (
        <EstadoVacio
          icono="buscar"
          titulo="Sin coincidencias"
          descripcion="Revisa lo escrito o registra al cliente."
        />
      ) : (
        <ul className={estilos.lista}>
          {resultados.data.map((cliente) => (
            <li key={cliente.id} className={estilos.elemento}>
              <div className={estilos.elementoTextos}>
                <span className={estilos.elementoNombre}>{cliente.nombre}</span>
                <span className={estilos.elementoDetalle}>{cliente.telefono}</span>
              </div>
              <div className={estilos.acciones}>
                <EtiquetaEstado tono={cliente.origen === 'PRESENCIAL' ? 'contorno' : 'acento'}>
                  {cliente.origen === 'PRESENCIAL' ? 'Presencial' : 'Con cuenta'}
                </EtiquetaEstado>
                {onElegir && (
                  <Boton
                    type="button"
                    variante="secundario"
                    tamano="sm"
                    aria-label={`Elegir a ${cliente.nombre}`}
                    onClick={() => onElegir(cliente)}
                  >
                    Elegir
                  </Boton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Clientes de la barbería (HU15, FR-035): búsqueda y alta del cliente presencial. Solo el propietario. */
export default function Clientes() {
  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Clientes' }]}
        titulo="Clientes"
        descripcion="Quienes reservan en línea y quienes registras en el local, para darles una cita presencial."
      />
      <div className={estilos.distribucion}>
        <Tarjeta titulo="Nuevo cliente presencial" icono="usuario">
          <FormularioClientePresencial />
        </Tarjeta>
        <Tarjeta titulo="Buscar clientes" icono="buscar">
          <BuscadorClientes etiqueta="Buscar por nombre o teléfono" />
        </Tarjeta>
      </div>
    </>
  );
}

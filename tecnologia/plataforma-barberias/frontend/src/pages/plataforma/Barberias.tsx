import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { apiBarberiasPlataforma, type BarberiaPlataforma } from '../../api/plataforma';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import {
  Alerta,
  Boton,
  Campo,
  EstadoVacio,
  EtiquetaEstado,
  ModalConfirmacion,
  Tarjeta,
  useAvisos,
} from '../../components/ui';
import type { TonoEtiqueta } from '../../components/ui/EtiquetaEstado';
import estilos from '../panel/Panel.module.css';

// T099 · Barberías del administrador de la plataforma (US5; FR-034 a FR-038): listado con búsqueda (sin datos de
// negocio: ni citas, ni clientes, ni usuarios), suspender y reactivar la barbería o su suscripción con motivo y
// confirmación, y activar un plan a mano con el motivo y la referencia del pago externo. Cada acción queda en la
// auditoría de la barbería con el administrador como actor.

const CLAVE = ['plataforma', 'barberias'] as const;
const TAMANO_PAGINA = 20;
const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const dia = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' });

const SUSCRIPCION: Record<BarberiaPlataforma['estadoSuscripcion'], { texto: string; tono: TonoEtiqueta }> = {
  TRIAL: { texto: 'En prueba', tono: 'acento' },
  ACTIVE: { texto: 'Activa', tono: 'exito' },
  PAST_DUE: { texto: 'En gracia', tono: 'aviso' },
  EXPIRED: { texto: 'Vencida', tono: 'error' },
  CANCELLED: { texto: 'Cancelada', tono: 'neutro' },
  SUSPENDED: { texto: 'Suspendida', tono: 'error' },
  SIN_SUSCRIPCION: { texto: 'Sin suscripción', tono: 'neutro' },
};

const motivo = z
  .string()
  .trim()
  .min(5, 'Escribe el motivo (de 5 a 300 caracteres).')
  .max(300, 'Máximo 300 caracteres.');
const esquemaMotivo = z.object({ motivo });
const esquemaActivacion = z.object({
  planId: z.string().min(1, 'Elige el plan.'),
  motivo,
  referenciaExterna: z
    .string()
    .trim()
    .min(3, 'Escribe la referencia del pago (de 3 a 80 caracteres).')
    .max(80, 'Máximo 80 caracteres.'),
});
type DatosMotivo = z.infer<typeof esquemaMotivo>;
type DatosActivacion = z.infer<typeof esquemaActivacion>;

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No pudimos conectar con el servidor. Intenta de nuevo.';
  return error.message;
}

type Accion = 'suspender-barberia' | 'suspender-suscripcion' | 'activar' | null;

/** Qué hace cada suspensión, para el formulario y la confirmación. */
const SUSPENSIONES = {
  'suspender-barberia': {
    etiqueta: 'Motivo de la suspensión de la barbería',
    titulo: (nombre: string) => `¿Suspender la barbería ${nombre}?`,
    descripcion:
      'Sus usuarios no podrán iniciar sesión y su enlace dirá "barbería no disponible". No se borra nada: al reactivarla, todo vuelve.',
    confirmar: 'Suspender barbería',
    hecho: 'Se suspendió la barbería',
  },
  'suspender-suscripcion': {
    etiqueta: 'Motivo de la suspensión de la suscripción',
    titulo: (nombre: string) => `¿Suspender la suscripción de ${nombre}?`,
    descripcion:
      'La barbería dejará de aceptar reservas nuevas y el propietario verá el motivo. Sus fechas siguen corriendo: los días suspendidos no se devuelven.',
    confirmar: 'Suspender suscripción',
    hecho: 'Se suspendió la suscripción',
  },
} as const;

function FormularioSuspension({
  barberia,
  tipo,
  alTerminar,
}: {
  barberia: BarberiaPlataforma;
  tipo: keyof typeof SUSPENSIONES;
  alTerminar: () => void;
}) {
  const textos = SUSPENSIONES[tipo];
  const avisar = useAvisos();
  const formulario = useForm<DatosMotivo>({ resolver: zodResolver(esquemaMotivo) });
  const [porConfirmar, setPorConfirmar] = useState<DatosMotivo | null>(null);
  const suspender = useMutation({
    mutationFn: ({ motivo: texto }: DatosMotivo) =>
      tipo === 'suspender-barberia'
        ? apiBarberiasPlataforma.suspender(barberia.id, texto)
        : apiBarberiasPlataforma.suspenderSuscripcion(barberia.id, texto),
    onSuccess: () => {
      avisar({ tono: 'exito', titulo: textos.hecho });
      alTerminar();
    },
    onSettled: () => setPorConfirmar(null),
  });
  return (
    <form
      className={estilos.formulario}
      aria-label={textos.confirmar}
      noValidate
      onSubmit={formulario.handleSubmit(setPorConfirmar)}
    >
      <Campo
        id={`${tipo}-${barberia.id}`}
        etiqueta={textos.etiqueta}
        ayuda="Queda en la auditoría de la barbería."
        registro={formulario.register('motivo')}
        error={formulario.formState.errors.motivo?.message}
      />
      {suspender.isError && <Alerta>{mensajeDeError(suspender.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton type="submit" variante="peligro">
          {textos.confirmar}
        </Boton>
      </div>
      <ModalConfirmacion
        abierto={porConfirmar !== null}
        onAbiertoCambia={(abierto) => !abierto && setPorConfirmar(null)}
        titulo={textos.titulo(barberia.nombre)}
        descripcion={textos.descripcion}
        textoConfirmar={textos.confirmar}
        cargando={suspender.isPending}
        onConfirmar={() => porConfirmar && suspender.mutate(porConfirmar)}
      />
    </form>
  );
}

function FormularioActivacion({
  barberia,
  alTerminar,
}: {
  barberia: BarberiaPlataforma;
  alTerminar: () => void;
}) {
  const avisar = useAvisos();
  const planes = useQuery({ queryKey: ['plataforma', 'planes'], queryFn: apiBarberiasPlataforma.planes });
  const formulario = useForm<DatosActivacion>({
    resolver: zodResolver(esquemaActivacion),
    defaultValues: { planId: '' },
  });
  const [porConfirmar, setPorConfirmar] = useState<DatosActivacion | null>(null);
  const activar = useMutation({
    mutationFn: (datos: DatosActivacion) => apiBarberiasPlataforma.activar(barberia.id, datos),
    onSuccess: (pago) => {
      const periodo =
        pago.periodo?.iniciaEn && pago.periodo.terminaEn
          ? `Período del ${dia.format(new Date(pago.periodo.iniciaEn))} al ${dia.format(new Date(pago.periodo.terminaEn))}.`
          : undefined;
      avisar({ tono: 'exito', titulo: 'Plan activado a mano', descripcion: periodo });
      alTerminar();
    },
    onSettled: () => setPorConfirmar(null),
  });
  const elegido = planes.data?.find((p) => p.id === porConfirmar?.planId);
  const errores = formulario.formState.errors;

  return (
    <form
      className={estilos.formulario}
      aria-label="Activar un plan a mano"
      noValidate
      onSubmit={formulario.handleSubmit(setPorConfirmar)}
    >
      <div className="campo">
        <label htmlFor={`plan-${barberia.id}`} className="campo__etiqueta">
          Plan
        </label>
        <select
          id={`plan-${barberia.id}`}
          className="entrada"
          aria-invalid={errores.planId ? true : undefined}
          aria-describedby={errores.planId ? `plan-${barberia.id}-error` : undefined}
          disabled={!planes.data}
          {...formulario.register('planId')}
        >
          <option value="">{planes.data ? 'Elige el plan' : 'Cargando los planes…'}</option>
          {planes.data?.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.nombre} · {soles.format(plan.precioCentimos / 100)} al mes
            </option>
          ))}
        </select>
        {errores.planId && (
          <p id={`plan-${barberia.id}-error`} className="mensaje-error">
            {errores.planId.message}
          </p>
        )}
      </div>
      {planes.isError && <Alerta>{mensajeDeError(planes.error)}</Alerta>}
      <Campo
        id={`motivo-activacion-${barberia.id}`}
        etiqueta="Motivo"
        ayuda="Por qué se activa a mano (por ejemplo, la pasarela no procesó el pago). El propietario lo ve en su historial."
        registro={formulario.register('motivo')}
        error={errores.motivo?.message}
      />
      <Campo
        id={`referencia-${barberia.id}`}
        etiqueta="Referencia del pago externo"
        ayuda="Número de depósito, recibo u operación del pago hecho fuera de la plataforma."
        registro={formulario.register('referenciaExterna')}
        error={errores.referenciaExterna?.message}
      />
      {activar.isError && <Alerta>{mensajeDeError(activar.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton type="submit">Activar plan</Boton>
      </div>
      <ModalConfirmacion
        abierto={porConfirmar !== null}
        onAbiertoCambia={(abierto) => !abierto && setPorConfirmar(null)}
        variante="primario"
        titulo={`¿Activar el plan ${elegido?.nombre ?? ''} para ${barberia.nombre}?`}
        descripcion={`Se registra un pago "activación manual" de ${
          elegido ? soles.format(elegido.precioCentimos / 100) : 'el precio del plan'
        } y se abre el período que corresponde, como con cualquier pago.`}
        textoConfirmar="Activar plan"
        cargando={activar.isPending}
        onConfirmar={() => porConfirmar && activar.mutate(porConfirmar)}
      />
    </form>
  );
}

function Fila({ barberia, alCambiar }: { barberia: BarberiaPlataforma; alCambiar: () => void }) {
  const avisar = useAvisos();
  const [accion, setAccion] = useState<Accion>(null);
  const [reactivando, setReactivando] = useState<'barberia' | 'suscripcion' | null>(null);
  const suspendida = barberia.estadoBarberia === 'SUSPENDIDA';
  const suscripcionSuspendida = barberia.estadoSuscripcion === 'SUSPENDED';
  const suscripcion = SUSCRIPCION[barberia.estadoSuscripcion];

  const reactivar = useMutation({
    mutationFn: (que: 'barberia' | 'suscripcion') =>
      que === 'barberia'
        ? apiBarberiasPlataforma.reactivar(barberia.id)
        : apiBarberiasPlataforma.reactivarSuscripcion(barberia.id),
    onSuccess: (_, que) => {
      avisar({
        tono: 'exito',
        titulo: que === 'barberia' ? 'Se reactivó la barbería' : 'Se reactivó la suscripción',
      });
      alCambiar();
    },
    onSettled: () => setReactivando(null),
  });
  const terminar = () => {
    setAccion(null);
    alCambiar();
  };
  const alternar = (siguiente: Exclude<Accion, null>) =>
    setAccion((actual) => (actual === siguiente ? null : siguiente));

  const detalle = [
    `/${barberia.slug}`,
    barberia.plan ? `plan ${barberia.plan}` : null,
    barberia.finCobertura ? `cubierta hasta el ${dia.format(new Date(barberia.finCobertura))}` : null,
  ].filter(Boolean);

  return (
    <li>
      <Tarjeta
        titulo={barberia.nombre}
        descripcion={detalle.join(' · ')}
        icono="tienda"
        acciones={
          <>
            <EtiquetaEstado tono={suspendida ? 'error' : 'exito'}>
              {suspendida ? 'Barbería suspendida' : 'Barbería activa'}
            </EtiquetaEstado>
            <EtiquetaEstado tono={suscripcion.tono}>Suscripción: {suscripcion.texto}</EtiquetaEstado>
          </>
        }
      >
        <div className={estilos.acciones}>
          {suspendida ? (
            <Boton variante="secundario" onClick={() => setReactivando('barberia')}>
              Reactivar barbería
            </Boton>
          ) : (
            <Boton
              variante="secundario"
              aria-expanded={accion === 'suspender-barberia'}
              onClick={() => alternar('suspender-barberia')}
            >
              Suspender barbería
            </Boton>
          )}
          {suscripcionSuspendida ? (
            <Boton variante="secundario" onClick={() => setReactivando('suscripcion')}>
              Reactivar suscripción
            </Boton>
          ) : (
            barberia.estadoSuscripcion !== 'SIN_SUSCRIPCION' &&
            barberia.estadoSuscripcion !== 'CANCELLED' && (
              <Boton
                variante="secundario"
                aria-expanded={accion === 'suspender-suscripcion'}
                onClick={() => alternar('suspender-suscripcion')}
              >
                Suspender suscripción
              </Boton>
            )
          )}
          {barberia.estadoSuscripcion !== 'SIN_SUSCRIPCION' && (
            <Boton
              variante="secundario"
              aria-expanded={accion === 'activar'}
              onClick={() => alternar('activar')}
            >
              Activar plan a mano
            </Boton>
          )}
        </div>
        {reactivar.isError && <Alerta>{mensajeDeError(reactivar.error)}</Alerta>}
        {(accion === 'suspender-barberia' || accion === 'suspender-suscripcion') && (
          <FormularioSuspension key={accion} barberia={barberia} tipo={accion} alTerminar={terminar} />
        )}
        {accion === 'activar' && <FormularioActivacion barberia={barberia} alTerminar={terminar} />}
        <ModalConfirmacion
          abierto={reactivando !== null}
          onAbiertoCambia={(abierto) => !abierto && setReactivando(null)}
          variante="primario"
          titulo={
            reactivando === 'barberia'
              ? `¿Reactivar la barbería ${barberia.nombre}?`
              : `¿Reactivar la suscripción de ${barberia.nombre}?`
          }
          descripcion={
            reactivando === 'barberia'
              ? 'Sus usuarios vuelven a iniciar sesión y su enlace vuelve a funcionar. Su suscripción queda en el estado que le corresponde por sus fechas.'
              : 'Queda en el estado que le corresponde por sus fechas (en prueba, activa, en gracia o vencida). Los días suspendidos no se devuelven.'
          }
          textoConfirmar="Reactivar"
          cargando={reactivar.isPending}
          onConfirmar={() => reactivando && reactivar.mutate(reactivando)}
        />
      </Tarjeta>
    </li>
  );
}

/** /plataforma/barberias · Barberías con su estado y su suscripción. */
export default function BarberiasPlataforma() {
  const consultas = useQueryClient();
  const [texto, setTexto] = useState('');
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const lista = useQuery({
    queryKey: [...CLAVE, buscar, pagina],
    queryFn: () => apiBarberiasPlataforma.lista(buscar, pagina),
    placeholderData: keepPreviousData,
  });
  const recargar = () => void consultas.invalidateQueries({ queryKey: CLAVE });
  const paginas = Math.max(1, Math.ceil((lista.data?.total ?? 0) / TAMANO_PAGINA));

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    setBuscar(texto.trim());
    setPagina(1);
  };
  const limpiarBusqueda = () => {
    setTexto('');
    setBuscar('');
    setPagina(1);
  };

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Plataforma', a: '/plataforma' }, { etiqueta: 'Barberías' }]}
        antetitulo="Administración"
        titulo="Barberías"
        descripcion="Estado de cada barbería y de su suscripción. Desde aquí no se ven citas, clientes, catálogo ni usuarios."
      />
      <div className={estilos.secciones}>
        <form role="search" aria-label="Buscar barberías" className={estilos.busqueda} onSubmit={enviar}>
          <div className="campo">
            <label htmlFor="buscar-barberias" className="campo__etiqueta">
              Buscar por nombre o enlace
            </label>
            <input
              id="buscar-barberias"
              type="search"
              className="entrada"
              maxLength={80}
              autoComplete="off"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
          <Boton type="submit" variante="secundario" icono="buscar">
            Buscar
          </Boton>
        </form>
        {lista.isError ? (
          <Alerta>{mensajeDeError(lista.error)}</Alerta>
        ) : !lista.data ? (
          <p aria-busy="true">Cargando las barberías…</p>
        ) : lista.data.barberias.length === 0 ? (
          <EstadoVacio
            icono="tienda"
            titulo={buscar ? 'Ninguna barbería coincide' : 'Aún no hay barberías'}
            descripcion={buscar ? 'Prueba con otra parte del nombre o del enlace.' : undefined}
            accion={
              buscar && (
                <Boton type="button" variante="secundario" onClick={limpiarBusqueda}>
                  Ver todas las barberías
                </Boton>
              )
            }
          />
        ) : (
          <>
            <ul className={estilos.lista} aria-label="Barberías">
              {lista.data.barberias.map((barberia) => (
                <Fila key={barberia.id} barberia={barberia} alCambiar={recargar} />
              ))}
            </ul>
            {paginas > 1 && (
              <nav aria-label="Páginas" className={estilos.acciones}>
                <Boton variante="secundario" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  Anterior
                </Boton>
                <span>
                  Página {pagina} de {paginas}
                </span>
                <Boton
                  variante="secundario"
                  disabled={pagina >= paginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Siguiente
                </Boton>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}

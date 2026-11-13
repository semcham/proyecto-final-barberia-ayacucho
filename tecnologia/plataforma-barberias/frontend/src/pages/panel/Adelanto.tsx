import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  apiAdelanto,
  type CambiarConfiguracionAdelanto,
  clavesAdelanto,
  type ConfiguracionAdelanto,
} from '../../api/adelanto';
import { ApiError } from '../../api/client';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Alerta, Boton, Campo, CampoArchivo, Tarjeta, useAvisos } from '../../components/ui';
import estilosAdelanto from './Adelanto.module.css';
import { Cargando } from './Cargando';
import { mensajeDeError } from './datos-barberia';
import estilos from './Panel.module.css';

// T018 de 008 · Configuración del adelanto de reserva (US1; FR-001 a FR-004). Solo el propietario: tipo (monto fijo
// en soles o porcentaje del precio), valor, plazo para pagar y el QR de Yape o Plin de la barbería, que se sube con
// vista previa y se muestra con una URL `blob:` local (el servidor no tiene URL pública del QR). Los cambios valen
// para las reservas nuevas.

const MAXIMO_QR = 1024 * 1024;
const TIPOS_QR = ['image/png', 'image/jpeg'];
const SIN_QR = 'Sube el QR de Yape o Plin de tu barbería antes de activar el adelanto.';
const ERROR_MONTO = 'El monto debe estar entre S/ 1.00 y S/ 500.00.';
const ERROR_PORCENTAJE = 'El porcentaje debe estar entre 1 y 100.';
const ERROR_PLAZO = 'El plazo debe estar entre 10 y 1440 minutos (24 horas).';

/** Soles escritos por el propietario ("12.50" o "12,50") → céntimos enteros; null si no es un monto. */
function aCentimos(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(limpio)) return null;
  return Math.round(Number(limpio) * 100);
}

const entero = (texto: string): number | null =>
  /^\d{1,5}$/.test(texto.trim()) ? Number(texto.trim()) : null;

const esquema = z
  .object({
    activo: z.boolean(),
    tipo: z.enum(['', 'FIJO', 'PORCENTAJE']),
    monto: z.string(),
    porcentaje: z.string(),
    plazo: z.string(),
  })
  .superRefine((f, ctx) => {
    const problema = (path: keyof typeof f, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (f.activo && f.tipo === '') problema('tipo', 'Elige el tipo de adelanto.');
    if (f.tipo === 'FIJO' && (f.activo || f.monto.trim() !== '')) {
      const centimos = aCentimos(f.monto);
      if (centimos === null || centimos < 100 || centimos > 50_000) problema('monto', ERROR_MONTO);
    }
    if (f.tipo === 'PORCENTAJE' && (f.activo || f.porcentaje.trim() !== '')) {
      const valor = entero(f.porcentaje);
      if (valor === null || valor < 1 || valor > 100) problema('porcentaje', ERROR_PORCENTAJE);
    }
    if (f.activo || f.plazo.trim() !== '') {
      const valor = entero(f.plazo);
      if (valor === null || valor < 10 || valor > 1440) problema('plazo', ERROR_PLAZO);
    }
  });
type Formulario = z.infer<typeof esquema>;

const aFormulario = (c: ConfiguracionAdelanto): Formulario => ({
  activo: c.activo,
  tipo: c.tipo ?? '',
  monto: c.montoCentimos !== undefined ? (c.montoCentimos / 100).toFixed(2) : '',
  porcentaje: c.porcentaje !== undefined ? String(c.porcentaje) : '',
  plazo: String(c.plazoMinutos ?? 30),
});

/** El cuerpo de PUT /barberia/adelanto: solo el valor del tipo elegido. */
function aCambio(f: Formulario): CambiarConfiguracionAdelanto {
  const cambio: CambiarConfiguracionAdelanto = { activo: f.activo };
  if (f.tipo !== '') cambio.tipo = f.tipo;
  if (f.tipo === 'FIJO' && f.monto.trim() !== '') cambio.montoCentimos = aCentimos(f.monto) as number;
  if (f.tipo === 'PORCENTAJE' && f.porcentaje.trim() !== '')
    cambio.porcentaje = entero(f.porcentaje) as number;
  if (f.plazo.trim() !== '') cambio.plazoMinutos = entero(f.plazo) as number;
  return cambio;
}

export default function Adelanto() {
  const configuracion = useQuery({
    queryKey: clavesAdelanto.configuracion,
    queryFn: apiAdelanto.configuracion,
  });

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Adelanto' }]}
        titulo="Adelanto de reserva"
        descripcion="Pide a tus clientes un adelanto por Yape o Plin al reservar. El dinero llega directo a tu barbería: tú compruebas el pago en tu aplicación y confirmas la cita."
      />
      {configuracion.data ? (
        <div className={estilos.secciones}>
          <Tarjeta titulo="QR de Yape o Plin" icono="celular">
            <SeccionQr tieneQr={configuracion.data.tieneQr} />
          </Tarjeta>
          <Tarjeta titulo="Adelanto" icono="dinero">
            <FormularioAdelanto config={configuracion.data} />
          </Tarjeta>
        </div>
      ) : configuracion.isError ? (
        <Alerta>{mensajeDeError(configuracion.error)}</Alerta>
      ) : (
        <Cargando texto="Cargando la configuración del adelanto…" />
      )}
    </>
  );
}

/** URL `blob:` local de un archivo, revocada al cambiar de archivo o al cerrar la pantalla. */
function useUrlLocal(archivo: Blob | null | undefined): string | null {
  const url = useMemo(() => (archivo ? URL.createObjectURL(archivo) : null), [archivo]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

const esquemaQr = z.object({
  archivo: z
    .custom<FileList>()
    .refine((lista) => lista?.length === 1, 'Elige la imagen del QR.')
    .refine((lista) => !lista?.[0] || lista[0].size <= MAXIMO_QR, 'La imagen pesa más de 1 MB.')
    .refine(
      (lista) => !lista?.[0] || TIPOS_QR.includes(lista[0].type),
      'El QR debe ser una imagen JPG o PNG.',
    ),
});
type FormularioQr = z.infer<typeof esquemaQr>;

/** Un error del servidor al subir el QR, en palabras del propietario. */
function mensajeDeQr(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.estado === 413 || error.detalles[0]?.problema === 'demasiado_grande') {
      return 'La imagen pesa más de 1 MB.';
    }
    if (error.codigo === 'VALIDACION') return 'El QR debe ser una imagen JPG o PNG.';
  }
  return mensajeDeError(error);
}

function SeccionQr({ tieneQr }: { tieneQr: boolean }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const guardado = useQuery({ queryKey: clavesAdelanto.qr, queryFn: apiAdelanto.qr, enabled: tieneQr });
  const urlGuardado = useUrlLocal(tieneQr ? guardado.data : null);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormularioQr>({ resolver: zodResolver(esquemaQr) });
  const elegido = useWatch({ control, name: 'archivo' });
  const urlElegido = useUrlLocal(elegido?.[0] ?? null);

  const subir = useMutation({
    mutationFn: (datos: FormularioQr) => apiAdelanto.subirQr(datos.archivo[0]),
    onSuccess: (nueva) => {
      reset();
      consultas.setQueryData(clavesAdelanto.configuracion, nueva);
      void consultas.invalidateQueries({ queryKey: clavesAdelanto.qr });
      avisar({ tono: 'exito', titulo: 'QR guardado' });
    },
  });

  return (
    <form
      className={estilos.formulario}
      aria-label="QR de Yape o Plin"
      noValidate
      onSubmit={handleSubmit((datos) => subir.mutate(datos))}
    >
      <div className={estilosAdelanto.qrs}>
        {tieneQr ? (
          urlGuardado ? (
            <figure className={estilosAdelanto.qr}>
              <img src={urlGuardado} alt="QR de Yape o Plin de tu barbería" />
              <figcaption>QR actual: tus clientes lo ven al pagar el adelanto.</figcaption>
            </figure>
          ) : guardado.isError ? (
            <Alerta>{mensajeDeError(guardado.error)}</Alerta>
          ) : (
            <Cargando texto="Cargando el QR…" />
          )
        ) : (
          <p className={estilos.aviso}>Todavía no subiste el QR de tu barbería.</p>
        )}
        {urlElegido && (
          <figure className={estilosAdelanto.qr}>
            <img src={urlElegido} alt="Vista previa del QR elegido" />
            <figcaption>Vista previa: así lo verán tus clientes.</figcaption>
          </figure>
        )}
      </div>
      <CampoArchivo
        id="qr"
        etiqueta="Imagen del QR"
        accept=".png,.jpg,.jpeg,image/png,image/jpeg"
        ayuda="Descárgalo de tu aplicación de Yape o Plin. Imagen JPG o PNG de hasta 1 MB. Solo la ven tus clientes con una reserva por pagar."
        registro={register('archivo')}
        error={errors.archivo?.message as string | undefined}
      />
      {subir.isError && <Alerta>{mensajeDeQr(subir.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton type="submit" icono="subir" cargando={subir.isPending} textoCargando="Subiendo…">
          {tieneQr ? 'Reemplazar QR' : 'Subir QR'}
        </Boton>
      </div>
    </form>
  );
}

function FormularioAdelanto({ config }: { config: ConfiguracionAdelanto }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const [sinQr, setSinQr] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema), defaultValues: aFormulario(config) });
  const tipo = useWatch({ control, name: 'tipo' });

  const guardar = useMutation({
    mutationFn: apiAdelanto.cambiar,
    onSuccess: (nueva) => {
      consultas.setQueryData(clavesAdelanto.configuracion, nueva);
      reset(aFormulario(nueva));
      avisar({ tono: 'exito', titulo: 'Adelanto guardado' });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.codigo === 'QR_REQUERIDO') setSinQr(true);
    },
  });

  const enviar = (datos: Formulario) => {
    setSinQr(false);
    guardar.reset();
    if (datos.activo && !config.tieneQr) {
      setSinQr(true);
      return;
    }
    guardar.mutate(aCambio(datos));
  };

  const errorDelServidor =
    guardar.isError && !(guardar.error instanceof ApiError && guardar.error.codigo === 'QR_REQUERIDO');

  return (
    <form
      className={estilos.formulario}
      aria-label="Configuración del adelanto"
      noValidate
      onSubmit={handleSubmit(enviar)}
    >
      <label className="casilla">
        <input type="checkbox" {...register('activo')} />
        <span>Pedir adelanto en las reservas</span>
      </label>
      <p className={estilos.aviso}>
        Las reservas que hacen tus clientes quedan pendientes hasta que confirmes el pago. Las que registras
        tú, no piden adelanto. Los cambios valen para las reservas nuevas.
      </p>

      <fieldset className={estilosAdelanto.grupo} aria-describedby={errors.tipo ? 'tipo-error' : undefined}>
        <legend>Tipo de adelanto</legend>
        <div className={estilosAdelanto.opciones}>
          <label className={`casilla ${estilosAdelanto.opcion}`}>
            <input type="radio" value="FIJO" {...register('tipo')} />
            <span>Monto fijo</span>
          </label>
          <label className={`casilla ${estilosAdelanto.opcion}`}>
            <input type="radio" value="PORCENTAJE" {...register('tipo')} />
            <span>Porcentaje del precio</span>
          </label>
        </div>
        {errors.tipo && (
          <p id="tipo-error" className="mensaje-error">
            {errors.tipo.message}
          </p>
        )}
      </fieldset>

      <div className={estilos.fila}>
        {tipo === 'FIJO' && (
          <Campo
            id="monto"
            etiqueta="Monto (S/)"
            inputMode="decimal"
            autoComplete="off"
            registro={register('monto')}
            error={errors.monto?.message}
            ayuda="Entre S/ 1.00 y S/ 500.00. Nunca se pide más que el precio del servicio."
          />
        )}
        {tipo === 'PORCENTAJE' && (
          <Campo
            id="porcentaje"
            etiqueta="Porcentaje (%)"
            type="number"
            inputMode="numeric"
            registro={register('porcentaje')}
            error={errors.porcentaje?.message}
            ayuda="Del precio del servicio, entre 1 y 100."
          />
        )}
        <Campo
          id="plazo"
          etiqueta="Plazo para pagar (minutos)"
          type="number"
          inputMode="numeric"
          registro={register('plazo')}
          error={errors.plazo?.message}
          ayuda="Entre 10 minutos y 24 horas (1440). Si no paga a tiempo, la reserva se cancela y el horario queda libre."
        />
      </div>

      {sinQr && <Alerta>{SIN_QR}</Alerta>}
      {errorDelServidor && <Alerta>{mensajeDeError(guardar.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton type="submit" cargando={guardar.isPending} textoCargando="Guardando…">
          Guardar
        </Boton>
      </div>
    </form>
  );
}

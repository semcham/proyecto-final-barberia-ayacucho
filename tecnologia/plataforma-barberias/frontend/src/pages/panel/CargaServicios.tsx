import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ClipboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cargarServicios,
  erroresDeCarga,
  type FilaServicioEnvio,
  MAX_FILAS_LOTE,
  type ProblemaDeFila,
  type RevisionDeCarga,
  revisarServicios,
  textoCortoDelProblema,
} from '../../api/carga-lote';
import { clavesConsulta } from '../../api/claves';
import { ApiError } from '../../api/client';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Icono } from '../../components/Icono';
import { Alerta, Boton, ModalConfirmacion, useAvisos } from '../../components/ui';
import { ResumenRevision } from './carga/ResumenRevision';
import { type ColumnaCarga, idDeCampo, type MarcaDeCampo, TablaCarga } from './carga/TablaCarga';
import { duracionDeCelda, precioDeCelda, serviciosDePegado } from './carga/pegado-de-hoja';
import { SERVICIOS_TIPICOS } from './carga/servicios-tipicos';
import estilos from './CargaServicios.module.css';
import { mensajeDeError } from './datos-barberia';

/** Una fila de la tabla: todo como texto, tal como lo escribe el propietario. */
interface FilaServicio {
  clave: string;
  nombre: string;
  duracion: string;
  precio: string;
  descripcion: string;
}

const PREFIJO = 'carga-servicio';
const FILAS_INICIALES = 3;

let contador = 0;
const nuevaClave = () => `f${++contador}`;
const filaVacia = (): FilaServicio => ({
  clave: nuevaClave(),
  nombre: '',
  duracion: '',
  precio: '',
  descripcion: '',
});
const estaVacia = (f: FilaServicio) =>
  [f.nombre, f.duracion, f.precio, f.descripcion].every((v) => v.trim() === '');

const COLUMNAS: ColumnaCarga<FilaServicio>[] = [
  { campo: 'nombre', etiqueta: 'Nombre', placeholder: 'Ej.: Corte clásico', ancho: 2.2 },
  {
    campo: 'duracion',
    etiqueta: 'Duración',
    // Sin placeholder numérico: un "30" gris se confunde con un valor ya escrito.
    inputMode: 'numeric',
    sufijo: 'min',
    ancho: 1,
  },
  {
    campo: 'precio',
    etiqueta: 'Precio',
    // Sin placeholder: con los típicos, un "25.00" gris haría creer que el precio ya está puesto.
    inputMode: 'decimal',
    prefijo: 'S/',
    ancho: 1.1,
  },
  {
    campo: 'descripcion',
    etiqueta: 'Descripción (opcional)',
    placeholder: 'Ej.: Incluye lavado',
    ancho: 2.4,
  },
];

/** Nombre de la columna de la tabla para un campo de la API. */
const CAMPO_DE_COLUMNA: Record<string, keyof FilaServicio> = {
  nombre: 'nombre',
  duracionMinutos: 'duracion',
  precio: 'precio',
  descripcion: 'descripcion',
};
const ETIQUETA_DE_COLUMNA: Record<string, string> = {
  nombre: 'Nombre',
  duracion: 'Duración',
  precio: 'Precio',
  descripcion: 'Descripción',
};

function aEnvio(f: FilaServicio): FilaServicioEnvio {
  // Lo escrito a mano se ordena igual que lo pegado ("30 min", "S/ 25,50"); lo que no se entiende lo marca la revisión.
  const duracion = duracionDeCelda(f.duracion);
  const numero = duracion === '' ? null : Number(duracion);
  return {
    nombre: f.nombre,
    duracionMinutos: numero !== null && Number.isFinite(numero) ? numero : null,
    precio: precioDeCelda(f.precio.trim()),
    descripcion: f.descripcion.trim() === '' ? null : f.descripcion,
  };
}

/**
 * 011 (US1) · Agregar varios servicios a la vez: tabla editable, pegado desde una hoja de cálculo y servicios típicos
 * (sin precio). "Revisar" pide la vista previa al servidor (mismas reglas que crear uno solo); "Guardar" crea todos o
 * ninguno, con una Idempotency-Key que se repite en los reintentos.
 */
export default function CargaServicios() {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const navegar = useNavigate();
  const idResumen = useId();
  const resumen = useRef<HTMLDivElement>(null);
  const [filas, setFilas] = useState<FilaServicio[]>(() =>
    Array.from({ length: FILAS_INICIALES }, filaVacia),
  );
  const [revision, setRevision] = useState<RevisionDeCarga | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pegando, setPegando] = useState(false);
  const [textoPegado, setTextoPegado] = useState('');
  const [saliendo, setSaliendo] = useState(false);
  // Campo que recibe el foco tras el próximo render (fila nueva, típicos o pegado).
  const focoPendiente = useRef<string | null>(null);
  // La clave nace con una revisión sin errores y se repite en los reintentos; cambiar la tabla la descarta.
  const clave = useRef<string | null>(null);

  const conDatos = filas.filter((f) => !estaVacia(f));
  const hayCambios = conDatos.length > 0;

  useEffect(() => {
    if (!focoPendiente.current) return;
    document.getElementById(focoPendiente.current)?.focus();
    focoPendiente.current = null;
  });

  // Al recargar o cerrar la pestaña con filas escritas, el navegador pregunta antes de perderlas.
  useEffect(() => {
    if (!hayCambios) return;
    const avisarSalida = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisarSalida);
    return () => window.removeEventListener('beforeunload', avisarSalida);
  }, [hayCambios]);

  /** Cualquier cambio en la tabla descarta la revisión anterior (y su clave). */
  const cambiarFilas = (siguiente: (actuales: FilaServicio[]) => FilaServicio[]) => {
    setFilas(siguiente);
    setRevision(null);
    clave.current = null;
  };

  const revisar = useMutation({
    mutationFn: () => revisarServicios(filas.map(aEnvio)),
    onSuccess: (resultado) => {
      setRevision(resultado);
      clave.current = resultado.errores.length === 0 ? crypto.randomUUID() : null;
      requestAnimationFrame(() => resumen.current?.focus());
    },
  });

  const guardar = useMutation({
    mutationFn: () => cargarServicios(filas.map(aEnvio), clave.current ?? crypto.randomUUID()),
    onSuccess: (r) => {
      avisar({
        tono: 'exito',
        titulo: r.creados === 1 ? 'Se creó 1 servicio' : `Se crearon ${r.creados} servicios`,
        descripcion: 'Ya aparecen en tu catálogo y en tu página de reservas.',
      });
      void consultas.invalidateQueries({ queryKey: clavesConsulta.servicios });
      navegar('/app/servicios');
    },
    onError: (error) => {
      const errores = erroresDeCarga(error);
      if (errores) {
        setRevision({ filas: conDatos.length, errores, advertencias: [] });
        clave.current = null;
        requestAnimationFrame(() => resumen.current?.focus());
      } else if (error instanceof ApiError && error.codigo === 'NOMBRE_DUPLICADO') {
        // Otra carga ganó un nombre entre la revisión y el guardado: se vuelve a revisar para marcar la fila.
        revisar.mutate();
      }
    },
  });

  const marcas = useMemo(() => {
    const mapa = new Map<string, MarcaDeCampo[]>();
    const agregar = (p: ProblemaDeFila, tono: MarcaDeCampo['tono']) => {
      if (p.fila === null) return;
      const clave = `${p.fila - 1}:${CAMPO_DE_COLUMNA[p.campo] ?? p.campo}`;
      mapa.set(clave, [...(mapa.get(clave) ?? []), { tono, texto: textoCortoDelProblema(p) }]);
    };
    revision?.errores.forEach((p) => agregar(p, 'error'));
    revision?.advertencias.forEach((p) => agregar(p, 'aviso'));
    return mapa;
  }, [revision]);

  const listo = revision !== null && revision.errores.length === 0;

  const agregarFila = () => {
    if (filas.length >= MAX_FILAS_LOTE) return;
    const nueva = filaVacia();
    cambiarFilas((actuales) => [...actuales, nueva]);
    focoPendiente.current = idDeCampo(PREFIJO, filas.length, 'nombre');
  };

  /** Reemplaza las filas vacías por las nuevas (al final de las que tienen datos), sin pasar de 50. */
  const insertar = (nuevas: Omit<FilaServicio, 'clave'>[], fuera = 0) => {
    const conservadas = filas.filter((f) => !estaVacia(f));
    const caben = nuevas.slice(0, MAX_FILAS_LOTE - conservadas.length);
    const quedaronFuera = fuera + nuevas.length - caben.length;
    cambiarFilas(() => [...conservadas, ...caben.map((f) => ({ ...f, clave: nuevaClave() }))]);
    setAviso(
      quedaronFuera > 0
        ? `Se agregaron ${caben.length} filas; ${quedaronFuera} quedaron fuera por el límite de ${MAX_FILAS_LOTE}.`
        : null,
    );
    return { desde: conservadas.length, agregadas: caben.length };
  };

  const agregarTipicos = () => {
    const presentes = new Set(filas.map((f) => f.nombre.trim().toLowerCase()));
    const faltan = SERVICIOS_TIPICOS.filter((t) => !presentes.has(t.nombre.toLowerCase()));
    if (faltan.length === 0) {
      setAviso('Los servicios típicos ya están en la tabla.');
      return;
    }
    const { desde, agregadas } = insertar(
      faltan.map((t) => ({
        nombre: t.nombre,
        duracion: String(t.duracionMinutos),
        precio: '',
        descripcion: '',
      })),
    );
    if (agregadas > 0) focoPendiente.current = idDeCampo(PREFIJO, desde, 'precio');
  };

  const agregarPegado = (texto: string) => {
    const libres = MAX_FILAS_LOTE - filas.filter((f) => !estaVacia(f)).length;
    const { filas: pegadas, fuera } = serviciosDePegado(texto, libres);
    if (pegadas.length === 0 && fuera === 0) return false;
    const { desde, agregadas } = insertar(pegadas, fuera);
    if (agregadas > 0) focoPendiente.current = idDeCampo(PREFIJO, desde, 'nombre');
    return true;
  };

  /** Pegar varias celdas sobre la tabla las reparte en filas (pegar una sola palabra sigue siendo normal). */
  const alPegarEnTabla = (e: ClipboardEvent<HTMLDivElement>) => {
    const texto = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(texto.trim())) return;
    e.preventDefault();
    agregarPegado(texto);
  };

  const irAlCampo = (p: ProblemaDeFila) => {
    if (p.fila === null) return;
    document.getElementById(idDeCampo(PREFIJO, p.fila - 1, CAMPO_DE_COLUMNA[p.campo] ?? p.campo))?.focus();
  };

  const salir = () => (hayCambios ? setSaliendo(true) : navegar('/app/servicios'));

  return (
    <>
      <EncabezadoPagina
        migas={[
          { etiqueta: 'Inicio', a: '/app' },
          { etiqueta: 'Servicios', a: '/app/servicios' },
          { etiqueta: 'Agregar varios' },
        ]}
        titulo="Agregar varios servicios"
        descripcion="Escribe o pega desde Excel o Google Sheets: nombre, duración en minutos y precio en soles. Revisa y guarda todos de una vez."
      />

      <div className={estilos.pagina}>
        <div className={estilos.barra}>
          <div className={estilos.herramientas}>
            <Boton
              type="button"
              variante="secundario"
              icono="mas"
              onClick={agregarFila}
              disabled={filas.length >= MAX_FILAS_LOTE}
            >
              Agregar fila
            </Boton>
            <Boton type="button" variante="secundario" icono="tijeras" onClick={agregarTipicos}>
              Agregar servicios típicos
            </Boton>
            <Boton
              type="button"
              variante="secundario"
              icono="copiar"
              aria-expanded={pegando}
              aria-controls="pegar-desde-hoja"
              onClick={() => setPegando((v) => !v)}
            >
              Pegar desde una hoja
            </Boton>
          </div>
          <p className={estilos.contador} aria-live="polite">
            <strong>{conDatos.length}</strong> de {MAX_FILAS_LOTE} filas
          </p>
        </div>

        {pegando && (
          <section id="pegar-desde-hoja" className={estilos.pegado} aria-labelledby="titulo-pegado">
            <h2 id="titulo-pegado" className={estilos.subtitulo}>
              Pegar desde una hoja de cálculo
            </h2>
            <p className={estilos.ayuda}>
              Copia las columnas <strong>Nombre</strong>, <strong>Duración</strong> y <strong>Precio</strong>{' '}
              (y, si quieres, Descripción) y pégalas aquí. También puedes pegarlas directo sobre la tabla.
            </p>
            <label htmlFor="texto-pegado" className="sr-only">
              Filas copiadas de la hoja de cálculo
            </label>
            <textarea
              id="texto-pegado"
              className={`entrada ${estilos.areaPegado}`}
              rows={4}
              value={textoPegado}
              placeholder={'Corte\t30\t25\nBarba\t20\t15'}
              onChange={(e) => setTextoPegado(e.target.value)}
            />
            <div className={estilos.acciones}>
              <Boton
                type="button"
                icono="check"
                disabled={textoPegado.trim() === ''}
                onClick={() => {
                  if (agregarPegado(textoPegado)) {
                    setTextoPegado('');
                    setPegando(false);
                  }
                }}
              >
                Agregar a la tabla
              </Boton>
              <Boton type="button" variante="fantasma" onClick={() => setPegando(false)}>
                Cerrar
              </Boton>
            </div>
          </section>
        )}

        {aviso && (
          <p className={estilos.aviso} role="status">
            <Icono nombre="info" tamano={16} />
            {aviso}
          </p>
        )}

        {revision && (
          <ResumenRevision
            id={idResumen}
            ref={resumen}
            revision={revision}
            tipo="SERVICIOS"
            sustantivo={{ uno: 'servicio', varios: 'servicios' }}
            etiquetaDeCampo={(campo) => ETIQUETA_DE_COLUMNA[CAMPO_DE_COLUMNA[campo] ?? campo] ?? campo}
            alIrA={irAlCampo}
          />
        )}

        <div onPaste={alPegarEnTabla}>
          <TablaCarga
            prefijo={PREFIJO}
            titulo="Servicios por agregar"
            filas={filas}
            columnas={COLUMNAS}
            marcas={marcas}
            alCambiar={(indice, campo, valor) =>
              cambiarFilas((actuales) =>
                actuales.map((f, i) => (i === indice ? { ...f, [campo]: valor } : f)),
              )
            }
            alQuitar={(indice) =>
              cambiarFilas((actuales) => {
                const resto = actuales.filter((_, i) => i !== indice);
                return resto.length > 0 ? resto : [filaVacia()];
              })
            }
          />
        </div>

        {revisar.isError && <Alerta>{mensajeDeError(revisar.error)}</Alerta>}
        {guardar.isError && !erroresDeCarga(guardar.error) && (
          <div className={estilos.errorGuardado}>
            <Alerta>No se guardó ningún servicio. {mensajeDeError(guardar.error)}</Alerta>
            {listo && (
              <Boton type="button" variante="secundario" icono="recargar" onClick={() => guardar.mutate()}>
                Intentar de nuevo
              </Boton>
            )}
          </div>
        )}

        <div className={estilos.pie}>
          <Boton type="button" variante="fantasma" onClick={salir}>
            Cancelar
          </Boton>
          <div className={estilos.pieAcciones}>
            <Boton
              type="button"
              variante={listo ? 'secundario' : 'primario'}
              icono="buscar"
              cargando={revisar.isPending}
              textoCargando="Revisando…"
              disabled={!hayCambios}
              onClick={() => revisar.mutate()}
            >
              Revisar
            </Boton>
            <Boton
              type="button"
              icono="check"
              cargando={guardar.isPending}
              textoCargando="Guardando…"
              disabled={!listo}
              aria-describedby={revision ? idResumen : undefined}
              onClick={() => guardar.mutate()}
            >
              {listo
                ? revision.filas === 1
                  ? 'Guardar 1 servicio'
                  : `Guardar ${revision.filas} servicios`
                : 'Guardar'}
            </Boton>
          </div>
        </div>
      </div>

      <ModalConfirmacion
        abierto={saliendo}
        onAbiertoCambia={setSaliendo}
        titulo="¿Salir sin guardar?"
        descripcion="Perderás las filas que escribiste. Ningún servicio se ha guardado todavía."
        textoConfirmar="Salir sin guardar"
        textoCancelar="Seguir editando"
        onConfirmar={() => navegar('/app/servicios')}
      />
    </>
  );
}

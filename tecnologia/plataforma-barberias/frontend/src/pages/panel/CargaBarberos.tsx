import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ClipboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  cargarBarberos,
  cupoSuperado,
  erroresDeCarga,
  type FilaBarberoEnvio,
  MAX_FILAS_LOTE,
  type ProblemaDeFila,
  type RevisionDeBarberos,
  revisarBarberos,
  textoCortoDelProblema,
  textoSuperaCupo,
} from '../../api/carga-lote';
import { clavesConsulta } from '../../api/claves';
import { llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { apiSuscripcion } from '../../api/suscripcion';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Icono } from '../../components/Icono';
import { Alerta, Boton, ModalConfirmacion, useAvisos } from '../../components/ui';
import { nombresDePegado } from './carga/pegado-de-hoja';
import { ResumenRevision } from './carga/ResumenRevision';
import { type ColumnaCarga, idDeCampo, type MarcaDeCampo, TablaCarga } from './carga/TablaCarga';
import estilos from './CargaServicios.module.css';
import propios from './CargaBarberos.module.css';
import { mensajeDeError } from './datos-barberia';

type Servicio = components['schemas']['Servicio'];
type Barbero = components['schemas']['Barbero'];

/** Una fila de la tabla: el nombre visible y los servicios que ofrece. */
interface FilaBarbero {
  clave: string;
  nombre: string;
  servicioIds: string[];
}

const PREFIJO = 'carga-barbero';
const FILAS_INICIALES = 3;

let contador = 0;
const nuevaClave = () => `b${++contador}`;
const filaVacia = (): FilaBarbero => ({ clave: nuevaClave(), nombre: '', servicioIds: [] });
const estaVacia = (f: FilaBarbero) => f.nombre.trim() === '' && f.servicioIds.length === 0;
const aEnvio = (f: FilaBarbero): FilaBarberoEnvio => ({ nombre: f.nombre, servicioIds: f.servicioIds });

const ETIQUETAS: Record<string, string> = { nombre: 'Nombre', servicioIds: 'Servicios' };

/**
 * 011 (US2) · Agregar varios barberos a la vez: nombre visible y servicios que ofrece (entre los activos). Se crean como
 * perfiles activos sin cuenta de usuario, dentro del cupo del plan. Un nombre repetido es solo un aviso.
 */
export default function CargaBarberos() {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const navegar = useNavigate();
  const idResumen = useId();
  const resumen = useRef<HTMLDivElement>(null);
  const [filas, setFilas] = useState<FilaBarbero[]>(() => Array.from({ length: FILAS_INICIALES }, filaVacia));
  const [revision, setRevision] = useState<RevisionDeBarberos | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pegando, setPegando] = useState(false);
  const [textoPegado, setTextoPegado] = useState('');
  const [saliendo, setSaliendo] = useState(false);
  const focoPendiente = useRef<string | null>(null);
  const clave = useRef<string | null>(null);

  // Lecturas que ya existen: servicios (para elegir), barberos activos y el máximo del plan (para el cupo).
  const servicios = useQuery({
    queryKey: clavesConsulta.servicios,
    queryFn: () => llamarApi<Servicio[]>('/servicios'),
  });
  const barberos = useQuery({
    queryKey: clavesConsulta.barberos,
    queryFn: () => llamarApi<Barbero[]>('/barberos'),
  });
  const suscripcion = useQuery({ queryKey: ['suscripcion'], queryFn: apiSuscripcion.suscripcion });

  const activos = useMemo(() => (servicios.data ?? []).filter((s) => s.activo), [servicios.data]);
  const maximo = suscripcion.data?.limites.maxBarberos ?? null;
  const activosHoy = barberos.data?.filter((b) => b.activo).length ?? null;
  const disponibles = maximo !== null && activosHoy !== null ? Math.max(0, maximo - activosHoy) : null;

  const conDatos = filas.filter((f) => !estaVacia(f));
  const hayCambios = conDatos.length > 0;

  useEffect(() => {
    if (!focoPendiente.current) return;
    document.getElementById(focoPendiente.current)?.focus();
    focoPendiente.current = null;
  });

  useEffect(() => {
    if (!hayCambios) return;
    const avisarSalida = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisarSalida);
    return () => window.removeEventListener('beforeunload', avisarSalida);
  }, [hayCambios]);

  const cambiarFilas = (siguiente: (actuales: FilaBarbero[]) => FilaBarbero[]) => {
    setFilas(siguiente);
    setRevision(null);
    clave.current = null;
  };

  const enfocarResumen = () => requestAnimationFrame(() => resumen.current?.focus());

  const revisar = useMutation({
    mutationFn: () => revisarBarberos(filas.map(aEnvio)),
    onSuccess: (resultado) => {
      setRevision(resultado);
      clave.current = resultado.errores.length === 0 ? crypto.randomUUID() : null;
      enfocarResumen();
    },
  });

  const guardar = useMutation({
    mutationFn: () => cargarBarberos(filas.map(aEnvio), clave.current ?? crypto.randomUUID()),
    onSuccess: (r) => {
      avisar({
        tono: 'exito',
        titulo: r.creados === 1 ? 'Se creó 1 barbero' : `Se crearon ${r.creados} barberos`,
        descripcion: 'Ya aparecen en tu catálogo. Define su disponibilidad para que reciban reservas.',
      });
      void consultas.invalidateQueries({ queryKey: clavesConsulta.barberos });
      navegar('/app/barberos');
    },
    onError: (error) => {
      const errores = erroresDeCarga(error);
      const cupo = cupoSuperado(error);
      if (errores || cupo) {
        // El servidor tiene la última palabra (otra carga pudo ocupar el cupo o desactivar un servicio): se vuelve a
        // revisar para mostrar los datos al día.
        clave.current = null;
        void consultas.invalidateQueries({ queryKey: clavesConsulta.barberos });
        revisar.mutate();
      }
    },
  });

  const marcas = useMemo(() => {
    const mapa = new Map<string, MarcaDeCampo[]>();
    const agregar = (p: ProblemaDeFila, tono: MarcaDeCampo['tono']) => {
      if (p.fila === null) return;
      const llave = `${p.fila - 1}:${p.campo}`;
      mapa.set(llave, [...(mapa.get(llave) ?? []), { tono, texto: textoCortoDelProblema(p, 'BARBEROS') }]);
    };
    revision?.errores.forEach((p) => agregar(p, 'error'));
    revision?.advertencias.forEach((p) => agregar(p, 'aviso'));
    return mapa;
  }, [revision]);

  const listo = revision !== null && revision.errores.length === 0;

  const alternarServicio = (indice: number, servicioId: string) =>
    cambiarFilas((actuales) =>
      actuales.map((f, i) =>
        i !== indice
          ? f
          : {
              ...f,
              servicioIds: f.servicioIds.includes(servicioId)
                ? f.servicioIds.filter((id) => id !== servicioId)
                : [...f.servicioIds, servicioId],
            },
      ),
    );

  const marcarTodos = (indice: number) =>
    cambiarFilas((actuales) =>
      actuales.map((f, i) => {
        if (i !== indice) return f;
        const todos = activos.every((s) => f.servicioIds.includes(s.id));
        return { ...f, servicioIds: todos ? [] : activos.map((s) => s.id) };
      }),
    );

  const columnas: ColumnaCarga<FilaBarbero>[] = [
    { campo: 'nombre', etiqueta: 'Nombre visible', placeholder: 'Ej.: Carlos Ñaupa', ancho: 1.3 },
    {
      campo: 'servicioIds',
      etiqueta: 'Servicios que ofrece',
      ancho: 2.7,
      renderizar: (fila, indice, { id, idEtiqueta, descrito, invalido }) =>
        activos.length === 0 ? (
          <p className={propios.sinServicios} id={id}>
            Sin servicios activos todavía.
          </p>
        ) : (
          <div
            id={id}
            role="group"
            aria-labelledby={idEtiqueta}
            aria-describedby={descrito}
            className={propios.servicios}
            data-invalido={invalido || undefined}
          >
            {activos.map((s) => {
              const marcado = fila.servicioIds.includes(s.id);
              return (
                <label key={s.id} className={propios.opcion} data-marcado={marcado || undefined}>
                  <input type="checkbox" checked={marcado} onChange={() => alternarServicio(indice, s.id)} />
                  <span>{s.nombre}</span>
                </label>
              );
            })}
            {activos.length > 1 && (
              <button type="button" className={propios.todos} onClick={() => marcarTodos(indice)}>
                {activos.every((s) => fila.servicioIds.includes(s.id)) ? 'Quitar todos' : 'Todos'}
                <span className="sr-only">, fila {indice + 1}</span>
              </button>
            )}
          </div>
        ),
    },
  ];

  const agregarFila = () => {
    if (filas.length >= MAX_FILAS_LOTE) return;
    cambiarFilas((actuales) => [...actuales, filaVacia()]);
    focoPendiente.current = idDeCampo(PREFIJO, filas.length, 'nombre');
  };

  const agregarPegado = (texto: string) => {
    const conservadas = filas.filter((f) => !estaVacia(f));
    const { filas: nombres, fuera } = nombresDePegado(texto, MAX_FILAS_LOTE - conservadas.length);
    if (nombres.length === 0 && fuera === 0) return false;
    cambiarFilas(() => [
      ...conservadas,
      ...nombres.map((nombre) => ({ clave: nuevaClave(), nombre, servicioIds: [] })),
    ]);
    setAviso(
      fuera > 0
        ? `Se agregaron ${nombres.length} filas; ${fuera} quedaron fuera por el límite de ${MAX_FILAS_LOTE}.`
        : null,
    );
    if (nombres.length > 0) focoPendiente.current = idDeCampo(PREFIJO, conservadas.length, 'nombre');
    return true;
  };

  const alPegarEnTabla = (e: ClipboardEvent<HTMLDivElement>) => {
    const texto = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(texto.trim())) return;
    e.preventDefault();
    agregarPegado(texto);
  };

  const irAlCampo = (p: ProblemaDeFila) => {
    if (p.fila === null) return;
    const id = idDeCampo(PREFIJO, p.fila - 1, p.campo);
    const destino = document.getElementById(id);
    // En el grupo de servicios, el foco va a su primera casilla.
    (destino?.querySelector<HTMLElement>('input') ?? destino)?.focus();
  };

  const salir = () => (hayCambios ? setSaliendo(true) : navegar('/app/barberos'));

  // Error al guardar que no es de las filas ni del cupo (red, sesión): se puede reintentar con la misma clave.
  const errorDeGuardado =
    guardar.isError && !erroresDeCarga(guardar.error) && !cupoSuperado(guardar.error) ? guardar.error : null;

  return (
    <>
      <EncabezadoPagina
        migas={[
          { etiqueta: 'Inicio', a: '/app' },
          { etiqueta: 'Barberos', a: '/app/barberos' },
          { etiqueta: 'Agregar varios' },
        ]}
        titulo="Agregar varios barberos"
        descripcion="Escribe o pega los nombres de tu equipo y marca los servicios que ofrece cada uno. Se crean como perfiles, sin cuenta de usuario."
      />

      <div className={estilos.pagina}>
        {disponibles !== null && maximo !== null && activosHoy !== null && (
          <p className={propios.cupo} data-lleno={disponibles === 0 || undefined}>
            <Icono nombre={disponibles === 0 ? 'alerta' : 'usuarios'} tamano={18} />
            <span>
              Tu plan permite <strong>{maximo}</strong> barberos activos. Tienes <strong>{activosHoy}</strong>
              .{' '}
              {disponibles === 0 ? (
                <>
                  No puedes agregar más.{' '}
                  <Link to="/app/suscripcion" className={propios.enlace}>
                    Ver planes
                  </Link>
                </>
              ) : (
                <>
                  Puedes agregar <strong>{disponibles}</strong>.
                </>
              )}
            </span>
          </p>
        )}

        {servicios.isSuccess && activos.length === 0 && (
          <p className={propios.avisoServicios} role="note">
            <Icono nombre="info" tamano={18} />
            <span>
              Aún no tienes servicios activos: los barberos se guardarán sin servicios y no aparecerán en las
              reservas hasta que les asignes alguno.{' '}
              <Link to="/app/servicios/agregar-varios" className={propios.enlace}>
                Agregar servicios
              </Link>
            </span>
          </p>
        )}

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
            <Boton
              type="button"
              variante="secundario"
              icono="copiar"
              aria-expanded={pegando}
              aria-controls="pegar-nombres"
              onClick={() => setPegando((v) => !v)}
            >
              Pegar nombres
            </Boton>
          </div>
          <p className={estilos.contador} aria-live="polite">
            <strong>{conDatos.length}</strong> de {MAX_FILAS_LOTE} filas
          </p>
        </div>

        {pegando && (
          <section id="pegar-nombres" className={estilos.pegado} aria-labelledby="titulo-pegado">
            <h2 id="titulo-pegado" className={estilos.subtitulo}>
              Pegar nombres desde una hoja de cálculo
            </h2>
            <p className={estilos.ayuda}>
              Copia la columna de <strong>nombres</strong> (uno por línea) y pégala aquí. Luego marca los
              servicios de cada uno.
            </p>
            <label htmlFor="texto-pegado" className="sr-only">
              Nombres copiados de la hoja de cálculo
            </label>
            <textarea
              id="texto-pegado"
              className={`entrada ${estilos.areaPegado}`}
              rows={4}
              value={textoPegado}
              placeholder={'Carlos Ñaupa\nAna Pillaca'}
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
            tipo="BARBEROS"
            sustantivo={{ uno: 'barbero', varios: 'barberos' }}
            etiquetaDeCampo={(campo) => ETIQUETAS[campo] ?? campo}
            textoDeCarga={(p) =>
              p.problema === 'supera_cupo'
                ? textoSuperaCupo(revision.cupo.maximo, revision.cupo.activos, revision.filas)
                : textoCortoDelProblema(p, 'BARBEROS')
            }
            alIrA={irAlCampo}
          />
        )}

        <div onPaste={alPegarEnTabla}>
          <TablaCarga
            prefijo={PREFIJO}
            titulo="Barberos por agregar"
            filas={filas}
            columnas={columnas}
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
        {errorDeGuardado && (
          <div className={estilos.errorGuardado}>
            <Alerta>No se guardó ningún barbero. {mensajeDeError(errorDeGuardado)}</Alerta>
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
                  ? 'Guardar 1 barbero'
                  : `Guardar ${revision.filas} barberos`
                : 'Guardar'}
            </Boton>
          </div>
        </div>
      </div>

      <ModalConfirmacion
        abierto={saliendo}
        onAbiertoCambia={setSaliendo}
        titulo="¿Salir sin guardar?"
        descripcion="Perderás las filas que escribiste. Ningún barbero se ha guardado todavía."
        textoConfirmar="Salir sin guardar"
        textoCancelar="Seguir editando"
        onConfirmar={() => navegar('/app/barberos')}
      />
    </>
  );
}

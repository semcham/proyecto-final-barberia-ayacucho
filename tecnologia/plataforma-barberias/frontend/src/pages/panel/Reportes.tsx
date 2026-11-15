import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '../../api/client';
import {
  apiReportes,
  clavesReportes,
  type PeriodoDeReportes,
  type ReportesDelPeriodo,
} from '../../api/reportes';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Alerta, Boton, Campo, EstadoVacio } from '../../components/ui';
import { fechaIsoDeBarberia } from '../../hora-barberia';
import { Cargando } from './Cargando';
import { mensajeDeError, useZonaBarberia } from './datos-barberia';
import estilos from './Panel.module.css';
import tablas from './Reportes.module.css';

// T023 de 005 · Reportes del propietario (/app/reportes; US2, FR-019 a FR-024): el período se elige con dos fechas
// locales de la barbería (por defecto, el mes en curso) y se ven tres reportes en tablas, sin gráficos: citas por
// estado, servicios más solicitados y actividad. Las reglas del período (orden, 366 días) las valida el servidor: su
// mensaje se muestra junto al campo y se anuncia. No depende del asistente de IA (FR-026).

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Del día 1 al último día del mes en curso en la zona de la barbería. */
function mesEnCurso(zona: string): PeriodoDeReportes {
  const [anio, mes] = fechaIsoDeBarberia(new Date(), zona).split('-').map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, '0');
  return { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

/** Una fecha local YYYY-MM-DD como "1 de noviembre de 2026" (sin desplazar el día por la zona). */
function fechaLarga(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(anio, mes - 1, dia)));
}

type CampoPeriodo = keyof PeriodoDeReportes;

/** Campo y mensaje de un 422 del servidor, si el error es de un campo del período. */
function errorDeCampo(error: unknown): { campo: CampoPeriodo; mensaje: string } | null {
  if (!(error instanceof ApiError) || error.estado !== 422) return null;
  const campo = error.detalles[0]?.campo;
  return campo === 'desde' || campo === 'hasta' ? { campo, mensaje: error.message } : null;
}

export default function Reportes() {
  const zona = useZonaBarberia();
  const [periodo, setPeriodo] = useState<PeriodoDeReportes>(() => mesEnCurso(zona));
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<PeriodoDeReportes>({ defaultValues: periodo });

  const reportes = useQuery({
    queryKey: clavesReportes.delPeriodo(periodo),
    queryFn: () => apiReportes.delPeriodo(periodo),
  });

  const deCampo = errorDeCampo(reportes.error);
  const campoConError = deCampo?.campo;
  const mensajeDeCampo = deCampo?.mensaje;
  // El mensaje del servidor (422) va junto al campo que hay que corregir.
  useEffect(() => {
    if (campoConError && mensajeDeCampo) setError(campoConError, { message: mensajeDeCampo });
  }, [campoConError, mensajeDeCampo, setError]);

  const enviar = (valores: PeriodoDeReportes) => {
    clearErrors();
    setPeriodo({ desde: valores.desde, hasta: valores.hasta });
  };

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Reportes' }]}
        titulo="Reportes"
        descripcion="Las citas de tu barbería en un período: por estado, los servicios más solicitados y la actividad de cada barbero. Solo conteos, sin datos de tus clientes. Las fechas son las de tu barbería."
      />
      <form className={estilos.formulario} onSubmit={handleSubmit(enviar)} noValidate aria-label="Período">
        <div className={estilos.fila}>
          <Campo
            id="reportes-desde"
            etiqueta="Desde"
            type="date"
            registro={register('desde')}
            error={errors.desde?.message}
          />
          <Campo
            id="reportes-hasta"
            etiqueta="Hasta"
            type="date"
            registro={register('hasta')}
            error={errors.hasta?.message}
          />
        </div>
        <div className={estilos.acciones}>
          <Boton type="submit">Ver reportes</Boton>
        </div>
      </form>

      {reportes.isPending ? (
        <Cargando texto="Cargando los reportes…" />
      ) : reportes.isError ? (
        <div className={tablas.error}>
          <Alerta>{deCampo ? deCampo.mensaje : mensajeDeError(reportes.error)}</Alerta>
          {!deCampo && (
            <Boton type="button" variante="secundario" tamano="sm" onClick={() => void reportes.refetch()}>
              Reintentar
            </Boton>
          )}
        </div>
      ) : (
        <Resultados datos={reportes.data} />
      )}
    </>
  );
}

function Resultados({ datos }: { datos: ReportesDelPeriodo }) {
  const { periodo, citas, serviciosMasSolicitados, actividad } = datos;
  const titulo = `Del ${fechaLarga(periodo.desde)} al ${fechaLarga(periodo.hasta)}`;
  if (citas.total === 0) {
    return (
      <section aria-label="Reportes del período">
        <p className={tablas.periodo}>{titulo}</p>
        <EstadoVacio
          icono="calendario"
          titulo="No hay citas en este período"
          descripcion="Elige otras fechas para ver sus reportes."
        />
      </section>
    );
  }
  return (
    <section aria-label="Reportes del período" className={tablas.reportes}>
      <p className={tablas.periodo}>{titulo}</p>

      <Tabla
        titulo="Citas por estado"
        columnas={['Estado', 'Citas']}
        filas={[
          ['Pendientes', citas.pendientes],
          ['Confirmadas', citas.confirmadas],
          ['Completadas', citas.completadas],
          ['No asistió', citas.noAsistio],
          ['Canceladas', citas.canceladas],
          ['De ellas, canceladas tarde', citas.canceladasTardias],
          ['Total', citas.total],
        ]}
      />

      {serviciosMasSolicitados.length > 0 ? (
        <Tabla
          titulo="Servicios más solicitados"
          columnas={['Puesto', 'Servicio', 'Citas']}
          filas={serviciosMasSolicitados.map((s, i) => [i + 1, s.nombre, s.citas])}
          nota="Sin contar las citas canceladas; hasta los 10 primeros."
        />
      ) : (
        <p className={tablas.nota}>
          Todas las citas del período se cancelaron: no hay servicios más solicitados.
        </p>
      )}

      <h2 className={tablas.subtitulo}>Actividad</h2>
      <div className={tablas.rejilla}>
        <Tabla
          titulo="Citas por barbero"
          columnas={['Barbero', 'Citas']}
          filas={actividad.porBarbero.map((b) => [b.barbero, b.citas])}
        />
        <Tabla
          titulo="Citas por día de la semana"
          columnas={['Día', 'Citas']}
          filas={actividad.porDiaDeSemana.map((d) => [DIAS[d.dia - 1], d.citas])}
        />
        <Tabla
          titulo="Cancelaciones tardías y no asistencias"
          columnas={['Tipo', 'Citas']}
          filas={[
            ['Cancelaciones tardías', actividad.cancelacionesTardias],
            ['No asistencias', actividad.noAsistencias],
          ]}
        />
      </div>
    </section>
  );
}

/** Tabla de datos con su título como <caption> (nombre accesible) y encabezados de columna. */
function Tabla({
  titulo,
  columnas,
  filas,
  nota,
}: {
  titulo: string;
  columnas: string[];
  filas: (string | number)[][];
  nota?: string;
}) {
  return (
    <div className={tablas.contenedor}>
      <table className={tablas.tabla}>
        <caption>{titulo}</caption>
        <thead>
          <tr>
            {columnas.map((columna, i) => (
              <th key={columna} scope="col" className={i === columnas.length - 1 ? tablas.numero : undefined}>
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={i}>
              {fila.map((celda, j) => (
                <td key={j} className={typeof celda === 'number' ? tablas.numero : undefined}>
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {nota && <p className={tablas.nota}>{nota}</p>}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import {
  apiIndicadores,
  clavesIndicadores,
  type Indicadores as DatosIndicadores,
} from '../../api/indicadores';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Alerta, Boton } from '../../components/ui';
import { CargandoLista } from '../panel/Cargando';
import tablas from '../panel/Reportes.module.css';

// T038 de 007 · Indicadores de la plataforma (/plataforma/indicadores; US2, RF31; FR-012 a FR-016). El administrador
// ve conteos agregados de todas las barberías, en tablas con encabezados y sin gráficos, con la hora del cálculo.
// Ningún dato de una barbería ni de una persona. Las secciones de citas por mes y de usuarios aparecen solo si el
// servidor las envía (fase 2c de 007, con las vistas de solo conteo); si no vienen, no se muestran ni en cero.

const ESTADOS: Record<string, string> = {
  TRIAL: 'En prueba',
  ACTIVE: 'Activa',
  PAST_DUE: 'En período de gracia',
  EXPIRED: 'Vencida',
  SUSPENDED: 'Suspendida',
  CANCELLED: 'Cancelada',
  SIN_SUSCRIPCION: 'Sin suscripción',
};

const fechaHora = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Lima',
});

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No pudimos conectar con el servidor. Intenta de nuevo.';
  return error.message;
}

export default function Indicadores() {
  const indicadores = useQuery({ queryKey: clavesIndicadores.todos, queryFn: apiIndicadores.consultar });

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/plataforma' }, { etiqueta: 'Indicadores' }]}
        titulo="Indicadores"
        descripcion="Conteos de uso de todas las barberías. No incluyen datos de ninguna barbería ni de ninguna persona."
        acciones={
          <Boton
            type="button"
            variante="secundario"
            tamano="sm"
            icono="recargar"
            cargando={indicadores.isFetching && !indicadores.isPending}
            onClick={() => void indicadores.refetch()}
          >
            Actualizar
          </Boton>
        }
      />
      {indicadores.isPending ? (
        <CargandoLista texto="Calculando los indicadores…" filas={3} />
      ) : indicadores.isError ? (
        <div className={tablas.reportes}>
          <Alerta>No se pudieron calcular los indicadores. {mensajeDeError(indicadores.error)}</Alerta>
          <div>
            <Boton type="button" variante="secundario" onClick={() => void indicadores.refetch()}>
              Intentar de nuevo
            </Boton>
          </div>
        </div>
      ) : (
        <Contenido datos={indicadores.data} />
      )}
    </>
  );
}

function Contenido({ datos }: { datos: DatosIndicadores }) {
  const { barberias } = datos;
  return (
    <div className={tablas.reportes}>
      <p className={tablas.nota}>
        Calculado el <time dateTime={datos.calculadoEn}>{fechaHora.format(new Date(datos.calculadoEn))}</time>{' '}
        (hora de Lima).
      </p>
      <div className={tablas.rejilla}>
        <Tabla
          titulo="Barberías"
          columnas={['Indicador', 'Barberías']}
          filas={[
            ['Activas', barberias.activas],
            ['Suspendidas por la plataforma', barberias.suspendidas],
          ]}
          nota="Activas: no suspendidas y con la suscripción en prueba, activa o en período de gracia."
        />
        <Tabla
          titulo="Barberías por estado de la suscripción"
          columnas={['Estado de la suscripción', 'Barberías']}
          filas={barberias.porEstadoDeSuscripcion.map((e) => [ESTADOS[e.estado] ?? e.estado, e.barberias])}
        />
        {/* T051 · Fase 2c: solo si el servidor los envía (vistas de solo conteo); si no, no se muestran ni en cero. */}
        {datos.usuarios && (
          <Tabla
            titulo="Usuarios"
            columnas={['Tipo', 'Usuarios']}
            filas={[
              ['Personal (propietarios y barberos)', datos.usuarios.personal],
              ['Clientes', datos.usuarios.clientes],
            ]}
            nota="Membresías activas: una persona con cuenta en dos barberías cuenta una vez en cada una."
          />
        )}
      </div>
      {datos.citasPorMes && (
        <Tabla
          titulo="Citas registradas por mes"
          columnas={['Mes', 'Total', ...ESTADOS_DE_CITA.map(([, etiqueta]) => etiqueta)]}
          filas={datos.citasPorMes.map((m) => {
            const porEstado = new Map(m.porEstado.map((e) => [e.estado, e.citas]));
            return [
              nombreDelMes(m.mes),
              m.total,
              ...ESTADOS_DE_CITA.map(([estado]) => porEstado.get(estado) ?? 0),
            ];
          })}
          nota="Los últimos 12 meses, por la fecha en que se registró cada cita (hora de Lima)."
        />
      )}
    </div>
  );
}

/** Estados de la cita, en el orden de las columnas. */
const ESTADOS_DE_CITA: [string, string][] = [
  ['PENDIENTE', 'Pendientes'],
  ['CONFIRMADA', 'Confirmadas'],
  ['COMPLETADA', 'Completadas'],
  ['NO_ASISTIO', 'No asistió'],
  ['CANCELADA', 'Canceladas'],
];

const formatoMes = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** `2026-11` → "noviembre de 2026". */
function nombreDelMes(mes: string): string {
  return formatoMes.format(new Date(`${mes}-01T12:00:00Z`));
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

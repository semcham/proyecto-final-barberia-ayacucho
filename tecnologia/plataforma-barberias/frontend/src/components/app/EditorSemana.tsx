import type { components } from '../../api/schema-002';
import { Boton } from '../ui/Boton';
import { BotonIcono } from '../ui/BotonIcono';
import estilos from './EditorSemana.module.css';

export type Tramo = components['schemas']['TramoHorario'];

export const NOMBRE_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
/** La semana empieza el lunes en Perú. */
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

/**
 * Errores del horario semanal, uno por día, con las mismas reglas que el servidor (FR-002): cierre posterior
 * a la apertura y sin tramos solapados. La interfaz solo ayuda; el servidor vuelve a validar.
 */
export function validarSemana(tramos: readonly Tramo[]): string[] {
  const errores: string[] = [];
  for (const dia of ORDEN_DIAS) {
    const delDia = tramos.filter((t) => t.diaSemana === dia).sort((a, b) => a.inicio.localeCompare(b.inicio));
    if (delDia.some((t) => t.fin <= t.inicio)) {
      errores.push(`${NOMBRE_DIA[dia]}: el cierre debe ser posterior a la apertura.`);
    } else if (delDia.some((t, i) => i > 0 && t.inicio < delDia[i - 1].fin)) {
      errores.push(`${NOMBRE_DIA[dia]}: hay tramos que se solapan.`);
    }
  }
  return errores;
}

/**
 * Editor del horario semanal en tramos (horario de atención y disponibilidad de cada barbero, T060). Cada
 * día puede tener varios tramos (por ejemplo, mañana y tarde) o ninguno (cerrado). Las horas son las de la
 * barbería.
 */
export function EditorSemana({
  tramos,
  onCambio,
}: {
  tramos: readonly Tramo[];
  onCambio: (tramos: Tramo[]) => void;
}) {
  const reemplazar = (indice: number, cambio: Partial<Tramo>) =>
    onCambio(tramos.map((t, i) => (i === indice ? { ...t, ...cambio } : t)));
  const quitar = (indice: number) => onCambio(tramos.filter((_, i) => i !== indice));
  const agregar = (dia: number) => {
    const ultimo = tramos.filter((t) => t.diaSemana === dia).sort((a, b) => b.fin.localeCompare(a.fin))[0];
    const nuevo = ultimo
      ? {
          diaSemana: dia,
          inicio: ultimo.fin,
          fin: ultimo.fin < '23:00' ? sumarHoras(ultimo.fin, 1) : '23:59',
        }
      : { diaSemana: dia, inicio: '09:00', fin: '18:00' };
    onCambio([...tramos, nuevo]);
  };

  return (
    <div className={estilos.semana}>
      {ORDEN_DIAS.map((dia) => {
        const nombre = NOMBRE_DIA[dia];
        const delDia = tramos.map((t, indice) => ({ t, indice })).filter(({ t }) => t.diaSemana === dia);
        return (
          <fieldset key={dia} className={estilos.dia}>
            <legend className={estilos.nombreDia}>{nombre}</legend>
            {delDia.length === 0 ? (
              <p className={estilos.cerrado}>Cerrado</p>
            ) : (
              <ul className={estilos.tramos}>
                {delDia.map(({ t, indice }, n) => (
                  <li key={indice} className={estilos.tramo}>
                    <input
                      type="time"
                      className="entrada"
                      aria-label={`${nombre}, apertura del tramo ${n + 1}`}
                      value={t.inicio}
                      onChange={(evento) => reemplazar(indice, { inicio: evento.target.value })}
                    />
                    <span aria-hidden="true">a</span>
                    <input
                      type="time"
                      className="entrada"
                      aria-label={`${nombre}, cierre del tramo ${n + 1}`}
                      value={t.fin}
                      onChange={(evento) => reemplazar(indice, { fin: evento.target.value })}
                    />
                    <BotonIcono
                      icono="cerrar"
                      etiqueta={`Quitar el tramo ${n + 1} del ${nombre.toLowerCase()}`}
                      onClick={() => quitar(indice)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <Boton
              type="button"
              variante="fantasma"
              tamano="sm"
              icono="mas"
              aria-label={`Agregar un tramo el ${nombre.toLowerCase()}`}
              onClick={() => agregar(dia)}
            >
              Agregar tramo
            </Boton>
          </fieldset>
        );
      })}
    </div>
  );
}

function sumarHoras(hora: string, horas: number): string {
  const [hh, mm] = hora.split(':').map(Number);
  return `${String(Math.min(23, hh + horas)).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

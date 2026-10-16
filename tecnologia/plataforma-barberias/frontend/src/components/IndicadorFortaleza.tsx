import estilos from './IndicadorFortaleza.module.css';

// Orientación visual mientras se escribe. No reemplaza la validación: el mínimo de 10 caracteres lo exige el
// formulario y la política completa (contraseñas comunes, que no contenga el correo) la aplica el backend.

const NIVELES = ['Muy débil', 'Débil', 'Aceptable', 'Fuerte', 'Muy fuerte'] as const;

const MUY_COMUNES = /^(?:123456|password|contrase(?:ñ|n)a|qwerty|abc123|111111|iloveyou|admin)/i;

/** Puntaje de 0 (muy débil) a 4 (muy fuerte). */
export function evaluarFortaleza(valor: string): number {
  if (valor.length < 10) return valor.length < 6 ? 0 : 1;
  let puntos = 1;
  if (valor.length >= 14) puntos += 1;
  if (valor.length >= 20) puntos += 1;
  const variedad = [/[a-záéíóúñ]/, /[A-ZÁÉÍÓÚÑ]/, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(valor)).length;
  if (variedad >= 3) puntos += 1;
  if (/(.)\1{3,}/.test(valor) || MUY_COMUNES.test(valor)) puntos -= 2;
  return Math.max(0, Math.min(4, puntos));
}

export function IndicadorFortaleza({ valor }: { valor: string }) {
  if (!valor) return null;
  const nivel = evaluarFortaleza(valor);
  return (
    <div className={estilos.indicador} data-nivel={nivel}>
      <div className={estilos.barras} aria-hidden="true">
        {NIVELES.map((_, i) => (
          <span key={i} className={i <= nivel ? estilos.llena : undefined} />
        ))}
      </div>
      <p className={estilos.texto} aria-live="polite">
        Seguridad: <strong>{NIVELES[nivel]}</strong>
      </p>
    </div>
  );
}

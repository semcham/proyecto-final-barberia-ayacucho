import estilos from './IlustracionBarberia.module.css';

/**
 * Ilustración propia de barbería: poste giratorio, tijeras, navaja y peine. SVG en línea (sin peticiones
 * extra) con los colores del sistema de diseño. Es decorativa: quien la usa la marca como aria-hidden.
 */
export function IlustracionBarberia({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 460"
      className={[estilos.ilustracion, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id="ilus-rayas"
          width="34"
          height="34"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-38)"
        >
          <rect width="34" height="34" className={estilos.vidrio} />
          <rect width="11" height="34" className={estilos.rayaRoja} />
          <rect x="17" width="5" height="34" className={estilos.rayaCobre} />
        </pattern>
        <linearGradient id="ilus-brillo" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="ilus-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1ece4" />
          <stop offset="1" stopColor="#a9a39a" />
        </linearGradient>
        <linearGradient id="ilus-oro" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={estilos.oroClaro} />
          <stop offset="1" className={estilos.oroOscuro} />
        </linearGradient>
      </defs>

      {/* Anillos de fondo */}
      <circle cx="210" cy="230" r="196" className={estilos.anillo} />
      <circle cx="210" cy="230" r="150" className={estilos.anilloPunteado} />

      {/* Poste de barbería */}
      <g transform="translate(78 40)">
        <rect x="56" y="0" width="8" height="18" className={estilos.soporte} />
        <circle cx="60" cy="10" r="15" fill="url(#ilus-oro)" />
        <rect x="18" y="22" width="84" height="26" rx="8" fill="url(#ilus-oro)" />
        <rect x="26" y="48" width="68" height="9" className={estilos.oroBanda} />
        <rect x="32" y="57" width="56" height="246" rx="3" fill="url(#ilus-rayas)" />
        <rect x="32" y="57" width="56" height="246" rx="3" fill="url(#ilus-brillo)" />
        <rect x="26" y="303" width="68" height="9" className={estilos.oroBanda} />
        <rect x="18" y="312" width="84" height="26" rx="8" fill="url(#ilus-oro)" />
        <path d="M44 338h32l-8 22H52z" fill="url(#ilus-oro)" />
      </g>

      {/* Tijeras abiertas */}
      <g transform="translate(300 128) rotate(118)">
        <path d="M-4 -5 L132 -24 L134 -17 L6 7 Z" fill="url(#ilus-metal)" />
        <path d="M-4 5 L132 24 L134 17 L6 -7 Z" fill="url(#ilus-metal)" />
        <path d="M-2 -3 L-34 -20" className={estilos.mango} />
        <path d="M-2 3 L-34 20" className={estilos.mango} />
        <circle cx="-52" cy="-28" r="19" className={estilos.aro} />
        <circle cx="-52" cy="28" r="19" className={estilos.aro} />
        <circle cx="0" cy="0" r="6" className={estilos.tornillo} />
      </g>

      {/* Navaja abierta */}
      <g transform="translate(206 318) rotate(-16)">
        <rect x="0" y="0" width="168" height="24" rx="12" className={estilos.mangoNavaja} />
        <rect x="10" y="9" width="148" height="6" rx="3" className={estilos.vetaNavaja} />
        <path d="M14 4 L-112 -2 Q-138 10 -116 30 L14 22 Z" fill="url(#ilus-metal)" />
        <path d="M14 4 L-112 -2 L-112 4 L14 9 Z" className={estilos.lomo} />
        <circle cx="14" cy="13" r="7" className={estilos.tornillo} />
      </g>

      {/* Peine */}
      <g transform="translate(236 382) rotate(-6)">
        <rect x="0" y="0" width="140" height="15" rx="5" fill="url(#ilus-oro)" />
        {Array.from({ length: 17 }, (_, i) => (
          <rect
            key={i}
            x={6 + i * 8}
            y="14"
            width="4"
            height={i % 2 === 0 ? 22 : 18}
            rx="2"
            fill="url(#ilus-oro)"
          />
        ))}
      </g>

      {/* Destellos */}
      <path d="M352 56l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" className={estilos.destello} />
      <path d="M48 386l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" className={estilos.destello} />
      <path d="M380 262l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" className={estilos.destello} />
    </svg>
  );
}

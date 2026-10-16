// Indicador "puede haber una sesión" para no llamar a /auth/refresh cuando seguro no la hay (visitante nuevo
// o después de cerrar sesión): esa llamada respondería 401 y ensucia la consola y las métricas.
//
// La cookie de renovación real ("rt") es HttpOnly y JavaScript no puede verla, así que la interfaz guarda
// esta marca aparte. No es secreta ni da acceso a nada: solo dice "vale la pena intentar renovar". Se usa
// una cookie (no localStorage) para que caduque igual que "rt" (7 días, renovándose en cada uso) y para no
// guardar nada de la sesión en el almacenamiento del navegador.

const NOMBRE = 'hay_sesion';
const SIETE_DIAS_S = 7 * 24 * 60 * 60;

function atributos(maxAge: number): string {
  const seguro = location.protocol === 'https:' ? '; Secure' : '';
  return `; Max-Age=${maxAge}; Path=/; SameSite=Strict${seguro}`;
}

export const indicadorSesion = {
  presente(): boolean {
    return document.cookie.split(';').some((par) => par.trim() === `${NOMBRE}=1`);
  },
  marcar(): void {
    document.cookie = `${NOMBRE}=1${atributos(SIETE_DIAS_S)}`;
  },
  quitar(): void {
    document.cookie = `${NOMBRE}=${atributos(0)}`;
  },
};

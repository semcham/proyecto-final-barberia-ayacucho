import { PoliticaIntentos } from '../../../src/modules/acceso-barberias/identidad/domain/politica-intentos';

// T073 · Límite de intentos de inicio de sesión (R10, EQ-12).

const T0 = new Date('2026-10-15T12:00:00Z').getTime();
const en = (segundos: number) => new Date(T0 + segundos * 1000);
/** n fallos, uno cada `separacion` segundos desde `inicio`. */
const fallos = (n: number, separacion = 1, inicio = 0) =>
  Array.from({ length: n }, (_, i) => en(inicio + i * separacion));

describe('PoliticaIntentos', () => {
  it('con menos de 5 fallos no bloquea', () => {
    expect(PoliticaIntentos.evaluar(fallos(4), en(4))).toEqual({ bloqueado: false, reintentarEnSegundos: 0 });
  });

  it('sin fallos (p. ej. tras un acierto, que los borra) no bloquea', () => {
    expect(PoliticaIntentos.evaluar([], en(0)).bloqueado).toBe(false);
  });

  it('5 fallos en menos de 60 s bloquean el sexto intento, con espera de 60 s desde el último fallo', () => {
    const resultado = PoliticaIntentos.evaluar(fallos(5), en(5));
    expect(resultado).toEqual({ bloqueado: true, reintentarEnSegundos: 59 });
  });

  it('el sexto intento sigue bloqueado durante todo el minuto siguiente al quinto fallo', () => {
    expect(PoliticaIntentos.evaluar(fallos(5), en(63)).bloqueado).toBe(true);
    expect(PoliticaIntentos.evaluar(fallos(5), en(64)).bloqueado).toBe(false);
  });

  it('5 fallos repartidos en más de 60 s no bloquean', () => {
    expect(PoliticaIntentos.evaluar(fallos(5, 20), en(81)).bloqueado).toBe(false);
  });

  it('la espera crece con cada racha de 5 fallos: 60, 120, 240, 480 y como máximo 900 s', () => {
    const esperas = [5, 10, 15, 20, 25, 30].map(
      (n) => PoliticaIntentos.evaluar(fallos(n), en(n - 1)).reintentarEnSegundos,
    );
    expect(esperas).toEqual([60, 120, 240, 480, 900, 900]);
  });

  it('ignora los fallos de más de 24 horas', () => {
    const viejos = fallos(5, 1, -25 * 3600);
    expect(PoliticaIntentos.evaluar([...viejos, ...fallos(5)], en(5)).reintentarEnSegundos).toBe(59);
  });

  it('no depende del orden en que llegan los fallos', () => {
    expect(PoliticaIntentos.evaluar(fallos(5).reverse(), en(5)).bloqueado).toBe(true);
  });
});

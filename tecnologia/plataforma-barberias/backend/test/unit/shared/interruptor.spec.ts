import { Clock } from '../../../src/shared/clock/clock';
import { Interruptor } from '../../../src/shared/cache/interruptor';

// T005 · Interruptor de circuito de la caché (R06, FR-020): 5 fallos seguidos lo abren, durante la pausa
// no se llama a la operación, luego deja pasar una prueba (semiabierto) y avisa una vez por caída.

class RelojFalso extends Clock {
  private ms = Date.parse('2026-10-26T10:00:00Z');
  ahora(): Date {
    return new Date(this.ms);
  }
  avanzar(ms: number): void {
    this.ms += ms;
  }
}

const falla = () => Promise.reject(new Error('redis no responde'));
const responde = () => Promise.resolve('ok');
const respaldo = () => 'respaldo';

function crear() {
  const reloj = new RelojFalso();
  const avisos: string[] = [];
  const interruptor = new Interruptor({
    fallosParaAbrir: 5,
    pausaMs: 10_000,
    reloj,
    alAbrir: () => avisos.push('abierto'),
    alRecuperar: () => avisos.push('recuperado'),
  });
  return { reloj, avisos, interruptor };
}

async function fallar(interruptor: Interruptor, veces: number): Promise<void> {
  for (let i = 0; i < veces; i += 1) await interruptor.ejecutar(falla, respaldo);
}

describe('Interruptor', () => {
  it('un fallo devuelve el respaldo, sin lanzar', async () => {
    const { interruptor } = crear();
    await expect(interruptor.ejecutar(falla, respaldo)).resolves.toBe('respaldo');
  });

  it('sigue cerrado con 4 fallos y se abre con el 5.º seguido', async () => {
    const { interruptor, avisos } = crear();
    await fallar(interruptor, 4);
    expect(interruptor.estado).toBe('cerrado');
    await fallar(interruptor, 1);
    expect(interruptor.estado).toBe('abierto');
    expect(avisos).toEqual(['abierto']);
  });

  it('un éxito reinicia la cuenta de fallos', async () => {
    const { interruptor } = crear();
    await fallar(interruptor, 4);
    await expect(interruptor.ejecutar(responde, respaldo)).resolves.toBe('ok');
    await fallar(interruptor, 4);
    expect(interruptor.estado).toBe('cerrado');
  });

  it('abierto, no llama a la operación durante la pausa', async () => {
    const { interruptor, reloj } = crear();
    await fallar(interruptor, 5);
    const operacion = jest.fn(responde);
    reloj.avanzar(9_999);
    await expect(interruptor.ejecutar(operacion, respaldo)).resolves.toBe('respaldo');
    expect(operacion).not.toHaveBeenCalled();
  });

  it('vencida la pausa, una prueba exitosa lo cierra y avisa la recuperación', async () => {
    const { interruptor, reloj, avisos } = crear();
    await fallar(interruptor, 5);
    reloj.avanzar(10_000);
    expect(interruptor.estado).toBe('semiabierto');
    await expect(interruptor.ejecutar(responde, respaldo)).resolves.toBe('ok');
    expect(interruptor.estado).toBe('cerrado');
    expect(avisos).toEqual(['abierto', 'recuperado']);
  });

  it('vencida la pausa, una prueba fallida lo reabre sin repetir el aviso', async () => {
    const { interruptor, reloj, avisos } = crear();
    await fallar(interruptor, 5);
    reloj.avanzar(10_000);
    await fallar(interruptor, 1);
    expect(interruptor.estado).toBe('abierto');
    reloj.avanzar(5_000);
    const operacion = jest.fn(responde);
    await interruptor.ejecutar(operacion, respaldo);
    expect(operacion).not.toHaveBeenCalled();
    expect(avisos).toEqual(['abierto']);
  });

  it('en semiabierto deja pasar una sola prueba a la vez', async () => {
    const { interruptor, reloj } = crear();
    await fallar(interruptor, 5);
    reloj.avanzar(10_000);
    let liberar: (valor: string) => void = () => undefined;
    const lenta = jest.fn(() => new Promise<string>((resolver) => (liberar = resolver)));
    const otra = jest.fn(responde);
    const primera = interruptor.ejecutar(lenta, respaldo);
    await expect(interruptor.ejecutar(otra, respaldo)).resolves.toBe('respaldo');
    expect(otra).not.toHaveBeenCalled();
    liberar('ok');
    await expect(primera).resolves.toBe('ok');
    expect(interruptor.estado).toBe('cerrado');
  });

  it('avisa una sola vez por caída aunque sigan los fallos', async () => {
    const { interruptor, reloj, avisos } = crear();
    await fallar(interruptor, 20);
    reloj.avanzar(10_000);
    await interruptor.ejecutar(responde, respaldo);
    await fallar(interruptor, 5);
    expect(avisos).toEqual(['abierto', 'recuperado', 'abierto']);
  });

  it('un respaldo asíncrono también sirve', async () => {
    const { interruptor } = crear();
    await expect(interruptor.ejecutar(falla, () => Promise.resolve(null))).resolves.toBeNull();
  });
});

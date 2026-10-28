import { Clock } from '../../../src/shared/clock/clock';
import {
  CandadoDeTareas,
  EjecutorTareas,
  type Programador,
  procesarCadaUno,
  RegistroDeCorridas,
} from '../../../src/shared/tareas/ejecutor-tareas';

// T007 · Ejecutor de tareas programadas (ADR-024, research R08), con candado, reloj y programador falsos:
// - con el candado tomado por otra réplica, la tarea no corre;
// - un error en un elemento no detiene el resto;
// - cada corrida queda registrada con los procesados y los fallidos (solo conteos);
// - el desfase aleatorio queda entre 0 y 30 s;
// - con TAREAS_ACTIVAS=false no se programa nada.

class RelojFalso extends Clock {
  ms = Date.parse('2026-11-01T10:00:00Z');
  ahora(): Date {
    return new Date(this.ms);
  }
}

class CandadoFalso extends CandadoDeTareas {
  tomados = new Set<string>();
  pedidos: string[] = [];
  async conCandado<T>(nombre: string, fn: () => Promise<T>) {
    this.pedidos.push(nombre);
    if (this.tomados.has(nombre)) return { ejecutada: false as const };
    this.tomados.add(nombre);
    try {
      return { ejecutada: true as const, resultado: await fn() };
    } finally {
      this.tomados.delete(nombre);
    }
  }
}

interface Corrida {
  id: string;
  tarea: string;
  replica: string;
  inicio: Date;
  fin?: Date;
  procesados?: number;
  fallidos?: number;
  error?: string | null;
}

class RegistroFalso extends RegistroDeCorridas {
  corridas: Corrida[] = [];
  async iniciar(tarea: string, replica: string, inicio: Date): Promise<string> {
    const id = `corrida-${this.corridas.length + 1}`;
    this.corridas.push({ id, tarea, replica, inicio });
    return id;
  }
  async terminar(
    id: string,
    datos: { fin: Date; procesados: number; fallidos: number; error: string | null },
  ) {
    Object.assign(this.corridas.find((c) => c.id === id) as Corrida, datos);
  }
}

class ProgramadorFalso implements Programador {
  pendientes: { fn: () => void; ms: number; id: number }[] = [];
  private siguiente = 0;
  programar(fn: () => void, ms: number): number {
    const id = ++this.siguiente;
    this.pendientes.push({ fn, ms, id });
    return id;
  }
  cancelar(id: unknown): void {
    this.pendientes = this.pendientes.filter((p) => p.id !== id);
  }
  /** Ejecuta lo programado hasta ahora (no lo que se programe al ejecutarlo). */
  disparar(): void {
    const actuales = this.pendientes;
    this.pendientes = [];
    for (const p of actuales) p.fn();
  }
}

function crear(opciones: { activas?: boolean; aleatorio?: () => number } = {}) {
  const reloj = new RelojFalso();
  const candado = new CandadoFalso();
  const registro = new RegistroFalso();
  const programador = new ProgramadorFalso();
  const ejecutor = new EjecutorTareas({
    activas: opciones.activas ?? true,
    intervaloMs: 300_000,
    replica: 'backend-1',
    candado,
    registro,
    reloj,
    programador,
    aleatorio: opciones.aleatorio ?? (() => 0.5),
  });
  return { reloj, candado, registro, programador, ejecutor };
}

const esperarMicrotareas = () => new Promise((r) => setImmediate(r));

describe('EjecutorTareas (ADR-024)', () => {
  it('ejecuta la tarea con el candado y registra la corrida con sus conteos', async () => {
    const { ejecutor, registro, candado } = crear();
    ejecutor.registrar({
      nombre: 'vencer-suscripciones',
      ejecutar: async () => ({ procesados: 3, fallidos: 1 }),
    });
    await expect(ejecutor.ejecutarAhora('vencer-suscripciones')).resolves.toEqual({
      ejecutada: true,
      procesados: 3,
      fallidos: 1,
    });
    expect(candado.pedidos).toEqual(['vencer-suscripciones']);
    expect(registro.corridas).toEqual([
      {
        id: 'corrida-1',
        tarea: 'vencer-suscripciones',
        replica: 'backend-1',
        inicio: new Date('2026-11-01T10:00:00Z'),
        fin: new Date('2026-11-01T10:00:00Z'),
        procesados: 3,
        fallidos: 1,
        error: null,
      },
    ]);
  });

  it('no corre la tarea si otra réplica tiene el candado, y no registra nada', async () => {
    const { ejecutor, registro, candado } = crear();
    const ejecutar = jest.fn(async () => ({ procesados: 1, fallidos: 0 }));
    ejecutor.registrar({ nombre: 'conciliar-pagos', ejecutar });
    candado.tomados.add('conciliar-pagos');
    await expect(ejecutor.ejecutarAhora('conciliar-pagos')).resolves.toEqual({ ejecutada: false });
    expect(ejecutar).not.toHaveBeenCalled();
    expect(registro.corridas).toEqual([]);
  });

  it('una tarea que falla queda registrada como fallida, con el tipo de error y sin su mensaje', async () => {
    const { ejecutor, registro } = crear();
    ejecutor.registrar({
      nombre: 'conciliar-pagos',
      ejecutar: async () => {
        throw new TypeError('detalle interno con datos 987654321');
      },
    });
    await expect(ejecutor.ejecutarAhora('conciliar-pagos')).resolves.toEqual({
      ejecutada: true,
      procesados: 0,
      fallidos: 1,
    });
    expect(registro.corridas[0]).toMatchObject({ procesados: 0, fallidos: 1, error: 'TypeError' });
    expect(JSON.stringify(registro.corridas)).not.toContain('987654321');
  });

  it('una tarea desconocida es un error de programación', async () => {
    const { ejecutor } = crear();
    await expect(ejecutor.ejecutarAhora('no-existe')).rejects.toThrow(/no-existe/);
  });

  it('no se registran dos tareas con el mismo nombre', () => {
    const { ejecutor } = crear();
    const tarea = { nombre: 'vencer-suscripciones', ejecutar: async () => ({ procesados: 0, fallidos: 0 }) };
    ejecutor.registrar(tarea);
    expect(() => ejecutor.registrar(tarea)).toThrow(/vencer-suscripciones/);
  });

  describe('procesarCadaUno: un error en un elemento no detiene el resto', () => {
    it('cuenta procesados y fallidos', async () => {
      const vistos: number[] = [];
      const resultado = await procesarCadaUno([1, 2, 3, 4], async (n) => {
        vistos.push(n);
        if (n === 2) throw new Error('falla en el 2');
      });
      expect(vistos).toEqual([1, 2, 3, 4]);
      expect(resultado).toEqual({ procesados: 3, fallidos: 1 });
    });

    it('un elemento sin cambios no cuenta como procesado', async () => {
      const resultado = await procesarCadaUno([1, 2, 3], async (n) => n !== 2);
      expect(resultado).toEqual({ procesados: 2, fallidos: 0 });
    });
  });

  describe('programación', () => {
    it.each([
      [0, 300_000],
      [0.5, 315_000],
      [0.9999, 329_997],
    ])('con aleatorio %s, el desfase queda entre 0 y 30 s (%s ms)', (aleatorio, ms) => {
      const { ejecutor, programador } = crear({ aleatorio: () => aleatorio });
      ejecutor.registrar({
        nombre: 'vencer-suscripciones',
        ejecutar: async () => ({ procesados: 0, fallidos: 0 }),
      });
      ejecutor.iniciar();
      expect(programador.pendientes.map((p) => p.ms)).toEqual([ms]);
      expect(ms - 300_000).toBeGreaterThanOrEqual(0);
      expect(ms - 300_000).toBeLessThan(30_000);
    });

    it('al vencer el intervalo ejecuta la tarea y la vuelve a programar', async () => {
      const { ejecutor, programador, registro } = crear();
      ejecutor.registrar({
        nombre: 'vencer-suscripciones',
        ejecutar: async () => ({ procesados: 0, fallidos: 0 }),
      });
      ejecutor.registrar({
        nombre: 'conciliar-pagos',
        ejecutar: async () => ({ procesados: 0, fallidos: 0 }),
      });
      ejecutor.iniciar();
      expect(programador.pendientes).toHaveLength(2);
      programador.disparar();
      await esperarMicrotareas();
      await esperarMicrotareas();
      expect(registro.corridas.map((c) => c.tarea).sort()).toEqual([
        'conciliar-pagos',
        'vencer-suscripciones',
      ]);
      expect(programador.pendientes).toHaveLength(2);
    });

    it('con TAREAS_ACTIVAS=false no se programa nada', () => {
      const { ejecutor, programador } = crear({ activas: false });
      ejecutor.registrar({
        nombre: 'vencer-suscripciones',
        ejecutar: async () => ({ procesados: 0, fallidos: 0 }),
      });
      ejecutor.iniciar();
      expect(programador.pendientes).toEqual([]);
    });

    it('al detenerse cancela lo programado', async () => {
      const { ejecutor, programador } = crear();
      ejecutor.registrar({
        nombre: 'vencer-suscripciones',
        ejecutar: async () => ({ procesados: 0, fallidos: 0 }),
      });
      ejecutor.iniciar();
      await ejecutor.onModuleDestroy();
      expect(programador.pendientes).toEqual([]);
    });
  });
});

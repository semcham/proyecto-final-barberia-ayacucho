import {
  type FuenteDeIndicador,
  RegistroDeIndicadores,
} from '../../../src/shared/indicadores/registro-de-indicadores';

// T028 de 007 · El registro de indicadores de M06 (research R01): junta lo que calcula cada fuente registrada, sin
// reglas de negocio; una fuente repetida es un error de arranque, y si una fuente falla la consulta falla entera (sin
// resultados parciales que parezcan ceros).

function fuente(nombre: string, calcular: () => Promise<unknown>): FuenteDeIndicador {
  return { nombre, calcular };
}

describe('RegistroDeIndicadores (M06, T028 de 007)', () => {
  it('sin fuentes, no calcula nada', async () => {
    expect(await new RegistroDeIndicadores().calcular()).toEqual({});
  });

  it('junta el resultado de cada fuente bajo su nombre, tal cual', async () => {
    const registro = new RegistroDeIndicadores();
    const barberias = { activas: 3, suspendidas: 1, porEstadoDeSuscripcion: [] };
    registro.registrar(fuente('barberias', async () => barberias));
    registro.registrar(fuente('usuarios', async () => ({ personal: 0, clientes: 0 })));
    expect(await registro.calcular()).toEqual({ barberias, usuarios: { personal: 0, clientes: 0 } });
    expect(registro.nombres()).toEqual(['barberias', 'usuarios']);
  });

  it('una fuente repetida al registrar es un error de arranque', () => {
    const registro = new RegistroDeIndicadores();
    registro.registrar(fuente('barberias', async () => 1));
    expect(() => registro.registrar(fuente('barberias', async () => 2))).toThrow(/barberias/);
  });

  it('si una fuente falla, la consulta falla entera', async () => {
    const registro = new RegistroDeIndicadores();
    registro.registrar(fuente('barberias', async () => ({ activas: 3 })));
    registro.registrar(
      fuente('citasPorMes', async () => {
        throw new Error('la vista no responde');
      }),
    );
    await expect(registro.calcular()).rejects.toThrow('la vista no responde');
  });

  it('calcula las fuentes a la vez, no una tras otra', async () => {
    const registro = new RegistroDeIndicadores();
    const espera = (ms: number, valor: number) => new Promise<number>((r) => setTimeout(() => r(valor), ms));
    registro.registrar(fuente('a', () => espera(150, 1)));
    registro.registrar(fuente('b', () => espera(150, 2)));
    const inicio = Date.now();
    expect(await registro.calcular()).toEqual({ a: 1, b: 2 });
    expect(Date.now() - inicio).toBeLessThan(290);
  });
});

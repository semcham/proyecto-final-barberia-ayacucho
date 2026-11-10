import { ConsoleLogger, Logger } from '@nestjs/common';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { citaConEnlaces, ipUnica, solicitudDeEnlace } from '../../helpers/enlaces';
import { barberiaParaReservar } from '../../helpers/reservas';
import { cerrarPools } from '../../helpers/test-db';

// T083 · El token de un enlace nunca aparece en los registros de la aplicación (contracts/enlaces-de-accion.md §6;
// FR-035). Se capturan TODAS las salidas (los métodos del Logger de Nest y stdout/stderr) mientras se usan
// enlaces válidos, usados, alterados, vencidos y bloqueados, y se busca cada token (y su parte de datos).

describe('Ningún token en los registros (T083)', () => {
  let prueba: AppDePrueba;
  const capturado: string[] = [];
  const restaurar: (() => void)[] = [];

  beforeAll(async () => {
    prueba = await crearApp();
    const guardar = (...partes: unknown[]) => {
      capturado.push(partes.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
    };
    for (const metodo of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      for (const objetivo of [Logger.prototype, ConsoleLogger.prototype, Logger]) {
        const original = (objetivo as unknown as Record<string, unknown>)[metodo];
        if (typeof original !== 'function') continue;
        const espia = jest
          .spyOn(objetivo as unknown as Record<string, (...a: unknown[]) => unknown>, metodo)
          .mockImplementation(function (this: unknown, ...args: unknown[]) {
            guardar(...args);
            return (original as (...a: unknown[]) => unknown).apply(this, args);
          });
        restaurar.push(() => espia.mockRestore());
      }
    }
    for (const flujo of [process.stdout, process.stderr]) {
      const original = flujo.write.bind(flujo);
      const espia = jest.spyOn(flujo, 'write').mockImplementation(((trozo: unknown, ...resto: unknown[]) => {
        guardar(String(trozo));
        return (original as (...a: unknown[]) => boolean)(trozo, ...resto);
      }) as typeof flujo.write);
      restaurar.push(() => espia.mockRestore());
    }
  });

  afterAll(async () => {
    for (const fn of restaurar) fn();
    await prueba.cerrar();
    await cerrarPools();
  });

  it('ni el token ni su parte de datos aparecen en ninguna salida', async () => {
    const e = await barberiaParaReservar();
    const c = await citaConEnlaces(prueba, e, 300);
    const ip = ipUnica();
    const tokens: string[] = [];
    const usar = async (
      accion: 'consultar' | 'confirmar' | 'cancelar' | 'reprogramar',
      token: string,
      cuerpo?: object,
    ) => {
      tokens.push(token);
      await solicitudDeEnlace(prueba, accion, token, ip, cuerpo);
    };

    const confirmar = c.enlace('CONFIRMAR');
    await usar('consultar', confirmar);
    await usar('confirmar', confirmar);
    // Ya usado, de otra acción, alterado, una reprogramación inválida y, al final, bloqueado por la IP (429).
    await usar('confirmar', confirmar);
    await usar('cancelar', c.enlace('CONFIRMAR'));
    await usar('cancelar', `${c.enlace('CANCELAR').slice(0, -2)}zz`);
    await usar('reprogramar', c.enlace('REPROGRAMAR'), { inicio: 'no-es-una-fecha' });
    for (let i = 0; i < 4; i += 1) await usar('consultar', `${confirmar}x${i}`);
    await usar('consultar', c.enlace('CONFIRMAR'));

    const todo = capturado.join('\n');
    for (const token of tokens) {
      expect(todo).not.toContain(token);
      const [datos] = token.split('.');
      if (datos.length > 20) expect(todo).not.toContain(datos);
    }
  });
});

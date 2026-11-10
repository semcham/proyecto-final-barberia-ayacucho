import { HISTORIAL_MS, PoliticaIntentos } from '../../../src/modules/acceso-barberias';
import * as indiceM01 from '../../../src/modules/acceso-barberias';
import { DemasiadosIntentos } from '../../../src/modules/catalogo-citas/catalogo/domain/errores';
import { LimiteRechazosEnlace } from '../../../src/modules/catalogo-citas/citas/application/limite-rechazos-enlace';
import type { IntentosEnlaceRepository } from '../../../src/modules/catalogo-citas/citas/application/ports/intentos-enlace-repository';
import type { Clock } from '../../../src/shared';

// T077 · Límite de rechazos de los enlaces por IP (FR-031; research R07). El caso de uso de M02 usa la MISMA
// PoliticaIntentos de M01, importada de acceso-barberias/index.ts (no una copia), con la IP como clave:
// 5 rechazos en 60 s bloquean 60 s; cada racha siguiente duplica la espera, hasta 900 s; el historial es de 24 h.
// La regla en sí la prueba test/unit/identidad/politica-intentos.spec.ts.

const SEGUNDO = 1000;
const IP = '203.0.113.7';

class RelojFijo implements Clock {
  constructor(public instante: Date) {}
  ahora(): Date {
    return this.instante;
  }
}

class IntentosEnMemoria implements Pick<IntentosEnlaceRepository, 'fallosDesde' | 'registrar'> {
  readonly filas: { ip: string; en: Date }[] = [];
  consultas: { ip: string; desde: Date }[] = [];
  async fallosDesde(ip: string, desde: Date): Promise<Date[]> {
    this.consultas.push({ ip, desde });
    return this.filas.filter((f) => f.ip === ip && f.en >= desde).map((f) => f.en);
  }
  async registrar(ip: string, en: Date): Promise<void> {
    this.filas.push({ ip, en });
  }
}

function preparar() {
  const reloj = new RelojFijo(new Date('2026-11-12T15:00:00Z'));
  const repo = new IntentosEnMemoria();
  const limite = new LimiteRechazosEnlace(repo as unknown as IntentosEnlaceRepository, reloj);
  const avanzar = (ms: number) => (reloj.instante = new Date(reloj.instante.getTime() + ms));
  return { reloj, repo, limite, avanzar };
}

async function rechazos(limite: LimiteRechazosEnlace, n: number, avanzar: (ms: number) => void) {
  for (let i = 0; i < n; i += 1) {
    await limite.registrarRechazo(IP);
    avanzar(SEGUNDO);
  }
}

describe('Límite de rechazos de los enlaces por IP (T077)', () => {
  it('la regla es la de M01: el mismo objeto que exporta acceso-barberias/index.ts', () => {
    expect(indiceM01.PoliticaIntentos).toBe(PoliticaIntentos);
    expect(HISTORIAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('evalúa con PoliticaIntentos.evaluar, sobre el historial de 24 h de esa IP', async () => {
    const { limite, repo, reloj } = preparar();
    const espia = jest.spyOn(PoliticaIntentos, 'evaluar');
    try {
      await limite.exigirSinBloqueo(IP);
      expect(espia).toHaveBeenCalledTimes(1);
      expect(repo.consultas).toEqual([{ ip: IP, desde: new Date(reloj.instante.getTime() - HISTORIAL_MS) }]);
    } finally {
      espia.mockRestore();
    }
  });

  it('con 4 rechazos no bloquea; con 5 en 60 s bloquea 60 s con DemasiadosIntentos', async () => {
    const { limite, avanzar } = preparar();
    await rechazos(limite, 4, avanzar);
    await expect(limite.exigirSinBloqueo(IP)).resolves.toBeUndefined();
    await rechazos(limite, 1, avanzar);
    const error = await limite.exigirSinBloqueo(IP).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemasiadosIntentos);
    expect((error as DemasiadosIntentos).codigo).toBe('DEMASIADOS_INTENTOS');
    // Desde el último rechazo pasó 1 s: faltan 59 s.
    expect((error as DemasiadosIntentos).detalles).toEqual([{ reintentarEnSegundos: 59 }]);
    avanzar(60 * SEGUNDO);
    await expect(limite.exigirSinBloqueo(IP)).resolves.toBeUndefined();
  });

  it('cada racha siguiente duplica la espera (120 s), hasta 900 s', async () => {
    const { limite, avanzar } = preparar();
    await rechazos(limite, 5, avanzar);
    avanzar(61 * SEGUNDO);
    await rechazos(limite, 5, avanzar);
    const segunda = (await limite.exigirSinBloqueo(IP).catch((e: unknown) => e)) as DemasiadosIntentos;
    expect(segunda.detalles).toEqual([{ reintentarEnSegundos: 119 }]);

    for (let racha = 3; racha <= 6; racha += 1) {
      avanzar(901 * SEGUNDO);
      await rechazos(limite, 5, avanzar);
    }
    const tope = (await limite.exigirSinBloqueo(IP).catch((e: unknown) => e)) as DemasiadosIntentos;
    expect(tope.detalles).toEqual([{ reintentarEnSegundos: 899 }]);
  });

  it('otra IP no se ve afectada', async () => {
    const { limite, avanzar } = preparar();
    await rechazos(limite, 5, avanzar);
    await expect(limite.exigirSinBloqueo('198.51.100.1')).resolves.toBeUndefined();
  });
});

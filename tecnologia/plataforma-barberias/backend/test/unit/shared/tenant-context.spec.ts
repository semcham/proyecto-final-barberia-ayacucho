import { SinContextoDeTenant } from '../../../src/shared/errores';
import { TenantContext } from '../../../src/shared/tenant/tenant-context';
import { TenantId } from '../../../src/shared/tenant/tenant-id';

const A = TenantId.de('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
const B = TenantId.de('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c');

const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

describe('TenantContext', () => {
  const contexto = new TenantContext();

  it('falla si se pide el tenant fuera de un contexto', () => {
    expect(() => contexto.actual()).toThrow(SinContextoDeTenant);
    expect(contexto.actualOpcional()).toBeNull();
  });

  it('falla si el contexto existe pero aún no tiene tenant', () => {
    contexto.ejecutarCon(null, () => {
      expect(() => contexto.actual()).toThrow(SinContextoDeTenant);
    });
  });

  it('aísla el tenant entre ejecuciones concurrentes', async () => {
    const vistos: string[] = [];
    await Promise.all([
      contexto.ejecutarCon(A, async () => {
        await pausa(20);
        vistos.push(`A:${contexto.actual().valor}`);
      }),
      contexto.ejecutarCon(B, async () => {
        await pausa(5);
        vistos.push(`B:${contexto.actual().valor}`);
      }),
    ]);
    expect(vistos.sort()).toEqual([`A:${A.valor}`, `B:${B.valor}`]);
  });

  it('permite fijar el tenant una vez y no cambiarlo por otro', () => {
    contexto.ejecutarCon(null, () => {
      contexto.fijar(A);
      expect(contexto.actual().equals(A)).toBe(true);
      expect(() => contexto.fijar(A)).not.toThrow();
      expect(() => contexto.fijar(B)).toThrow();
    });
  });

  it('no permite fijar un tenant sin contexto', () => {
    expect(() => contexto.fijar(A)).toThrow(SinContextoDeTenant);
  });

  it('hereda los datos de la solicitud en un contexto anidado', () => {
    contexto.ejecutarCon(
      null,
      () =>
        contexto.ejecutarCon(A, () => {
          expect(contexto.datosSolicitud()).toEqual({
            ip: '10.0.0.1',
            userAgent: undefined,
            correlationId: 'c-1',
          });
        }),
      { ip: '10.0.0.1', correlationId: 'c-1' },
    );
  });
});

describe('TenantId', () => {
  it('rechaza valores que no son UUID', () => {
    expect(() => TenantId.de('otra-barberia')).toThrow();
    expect(() => TenantId.de("' OR 1=1 --")).toThrow();
  });
});

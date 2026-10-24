import {
  crearEntradaCatalogo,
  leerEntradaCatalogo,
} from '../../../src/modules/catalogo-citas/catalogo/application/entrada-catalogo';
import type { CatalogoPublicoDatos } from '../../../src/modules/catalogo-citas/catalogo/application/ports/catalogo-publico-query';

// T029 · Entrada del catálogo público en la caché compartida (006, data-model.md §2.1): formato `v: 1` con
// lista cerrada de campos; cualquier otra cosa equivale a ausente (FR-015) y nunca sale un dato privado.

const DATOS: CatalogoPublicoDatos = {
  horario: { tramos: [{ diaSemana: 1, inicio: '09:00', fin: '19:00' }] },
  servicios: [
    {
      id: '0190a5c4-0000-7000-8000-000000000001',
      nombre: 'Corte',
      descripcion: null,
      precio: '20.00',
      duracionMinutos: 30,
    },
  ],
  barberos: [
    {
      id: '0190a5c4-0000-7000-8000-000000000002',
      nombre: 'Luis',
      servicioIds: ['0190a5c4-0000-7000-8000-000000000001'],
    },
  ],
};

/** Lo que hace el adaptador de Redis: el valor viaja como JSON. */
const porJson = (valor: unknown): unknown => JSON.parse(JSON.stringify(valor));

describe('Entrada del catálogo público', () => {
  it('se serializa con v: 1 y la generación, y se lee igual', () => {
    const entrada = crearEntradaCatalogo(DATOS, 3);
    expect(entrada).toEqual({ v: 1, generacion: 3, ...DATOS });
    expect(leerEntradaCatalogo(porJson(entrada))).toEqual({ v: 1, generacion: 3, ...DATOS });
  });

  it.each([
    ['otra versión', { ...crearEntradaCatalogo(DATOS, 1), v: 2 }],
    ['sin versión', { generacion: 1, ...DATOS }],
    ['texto ilegible', '{"v":1,"horario":'],
    ['nulo', null],
    ['servicios que no son lista', { ...crearEntradaCatalogo(DATOS, 1), servicios: 'x' }],
    [
      'barbero sin servicioIds',
      { ...crearEntradaCatalogo(DATOS, 1), barberos: [{ id: 'b', nombre: 'Luis' }] },
    ],
    [
      'precio numérico',
      { ...crearEntradaCatalogo(DATOS, 1), servicios: [{ ...DATOS.servicios[0], precio: 20 }] },
    ],
    ['generación negativa', { ...crearEntradaCatalogo(DATOS, 1), generacion: -1 }],
  ])('%s equivale a ausente', (_caso, valor) => {
    expect(leerEntradaCatalogo(valor)).toBeNull();
  });

  it('no admite campos fuera de la lista: el teléfono de un cliente o el motivo de un bloqueo no se serializan', () => {
    const contaminados = {
      ...DATOS,
      telefono: '987654321',
      horario: { tramos: [{ ...DATOS.horario.tramos[0], reason: 'cita médica' }] },
      servicios: [{ ...DATOS.servicios[0], clienteCorreo: 'cliente@prueba.pe' }],
      barberos: [{ ...DATOS.barberos[0], telefono: '912345678', userId: 'u-1' }],
    } as unknown as CatalogoPublicoDatos;

    const texto = JSON.stringify(crearEntradaCatalogo(contaminados, 0));
    for (const privado of ['987654321', 'cita médica', 'cliente@prueba.pe', '912345678', 'u-1']) {
      expect(texto).not.toContain(privado);
    }
    expect(crearEntradaCatalogo(contaminados, 0)).toEqual({ v: 1, generacion: 0, ...DATOS });

    // Y al leer tampoco pasa nada de más.
    const leida = leerEntradaCatalogo({
      ...(porJson(crearEntradaCatalogo(DATOS, 0)) as object),
      telefono: '987654321',
    });
    expect(JSON.stringify(leida)).not.toContain('987654321');
  });
});

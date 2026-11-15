import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  barberiaDelAsistente,
  type BarberiaDelAsistente,
  ENTORNO_SIN_LIMITE,
  falsoDe,
  preguntar,
  usoDeCuota,
} from '../../helpers/asistente';
import { cerrarPools } from '../../helpers/test-db';

// T036 de 005 · PR09, FR-004 y SC-006: con el token de un cliente de A, ninguna respuesta del asistente trae datos de
// B, aunque el mensaje nombre a B o el modelo (engañado) pida un servicio o un barbero de B; un intento de indicar la
// barbería en el cuerpo se rechaza; y la cuota de A no toca la de B.

describe('T036 · Aislamiento del asistente entre barberías (PR09)', () => {
  let prueba: AppDePrueba;
  let a: BarberiaDelAsistente;
  let b: BarberiaDelAsistente;

  beforeAll(async () => {
    prueba = await crearApp({ entorno: ENTORNO_SIN_LIMITE });
    a = await barberiaDelAsistente();
    b = await barberiaDelAsistente('Exclusivo B ');
  });

  afterEach(() => falsoDe(prueba).restaurar());

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const sinNadaDeB = (cuerpo: unknown) => {
    const texto = JSON.stringify(cuerpo);
    for (const dato of [b.tenantId, b.slug, b.nombre, 'Exclusivo B', b.corte, b.barba, b.luis, b.ana]) {
      expect({ dato, aparece: texto.includes(dato) }).toEqual({ dato, aparece: false });
    }
  };

  it('los servicios son solo los de A, aunque el mensaje nombre a B', async () => {
    const { body } = await preguntar(prueba, a.cliente.token, `¿Qué servicios tiene ${b.nombre}?`).expect(
      200,
    );
    expect(body.datos.servicios.map((s: { servicioId: string }) => s.servicioId).sort()).toEqual(
      [a.corte, a.barba].sort(),
    );
    sinNadaDeB(body);
  });

  it('un servicio de B pedido por su nombre no se encuentra en A (se ofrecen los de A)', async () => {
    falsoDe(prueba).fijarModo({
      tipo: 'guion',
      respuesta: {
        intencion: 'horarios_libres',
        argumentos: { servicio: 'Exclusivo B Corte clásico', fecha: '2030-01-15' },
      },
    });
    const { body } = await preguntar(
      prueba,
      a.cliente.token,
      'horarios del corte de la otra barbería',
    ).expect(200);
    expect(body.resultado).toBe('SIN_DATOS');
    sinNadaDeB(body);
  });

  it('un barbero de B pedido por su nombre no se encuentra en A', async () => {
    falsoDe(prueba).fijarModo({
      tipo: 'guion',
      respuesta: { intencion: 'barberos', argumentos: { servicio: 'Exclusivo B Barba' } },
    });
    const { body } = await preguntar(prueba, a.cliente.token, 'barberos de la otra').expect(200);
    expect(body.resultado).toBe('SIN_DATOS');
    sinNadaDeB(body);
  });

  it.each([
    ['tenantId de B', { tenantId: '' }],
    ['barberiaId de B', { barberiaId: '' }],
    ['un campo desconocido (tenant)', { tenant: '' }],
  ])('el cuerpo con %s → 400, sin respuesta del asistente', async (_caso, extra) => {
    const campo = Object.keys(extra)[0];
    const { body } = await preguntar(prueba, a.cliente.token, 'precios', undefined, {
      [campo]: b.tenantId,
    }).expect(400);
    expect(body.codigo).toBe('VALIDACION');
    expect(body.texto).toBeUndefined();
    sinNadaDeB(body);
  });

  it('la cuota de A no cambia la de B', async () => {
    const antesB = await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId);
    await preguntar(prueba, a.cliente.token, 'precios').expect(200);
    expect(await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId)).toBe(antesB);
    expect(await usoDeCuota(a.tenantId, 'BARBERIA', b.tenantId)).toBe(0);
  });
});

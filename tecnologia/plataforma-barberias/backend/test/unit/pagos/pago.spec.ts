import {
  ComprobanteYaEnRevision,
  TransicionDePagoInvalida,
} from '../../../src/modules/suscripciones-pagos/pagos/domain/errores';
import {
  ESTADOS_PAGO,
  type EstadoPago,
  type EventoPago,
  esImporteValido,
  MARCAS_REVISION,
  type PagoActual,
  transicionDePago,
} from '../../../src/modules/suscripciones-pagos/pagos/domain/pago';

// T011 · PR25: máquina de estados del pago (data-model.md §3), celda por celda. Las marcas de revisión
// (DUPLICADO, IMPORTE_DISTINTO, APROBADO_TRAS_RECHAZO, DEVOLUCION) son marcas, no estados: así lo dice la
// entidad Pago de la especificación (L1). La regla de aprobación (período objetivo y tope) la decide
// periodo.ts; aquí solo si el pago debe aplicar un período.

const YAPE = (estado: EstadoPago, extra: Partial<PagoActual> = {}): PagoActual => ({
  estado,
  metodo: 'YAPE',
  importeCentimos: 4900,
  moneda: 'PEN',
  marca: null,
  ...extra,
});
const TRANSFERENCIA = (estado: EstadoPago): PagoActual => ({ ...YAPE(estado), metodo: 'TRANSFERENCIA' });
const proveedor = (
  estado: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE' | 'EXPIRADO' | 'DEVUELTO',
  importeCentimos = 4900,
  moneda = 'PEN',
): EventoPago => ({ tipo: 'PROVEEDOR', estado, importeCentimos, moneda });

describe('PR25 · Pago: eventos del proveedor (notificación o conciliación)', () => {
  it.each([
    // [desde, evento, hacia, marca, aplicarPeriodo, efecto]
    ['PENDIENTE', 'APROBADO', 'APROBADO', null, true, 'APLICADO'],
    ['PENDIENTE', 'RECHAZADO', 'RECHAZADO', null, false, 'APLICADO'],
    ['PENDIENTE', 'EXPIRADO', 'EXPIRADO', null, false, 'APLICADO'],
    ['PENDIENTE', 'PENDIENTE', 'PENDIENTE', null, false, 'SIN_EFECTO'],
    ['PENDIENTE', 'DEVUELTO', 'PENDIENTE', null, false, 'SIN_EFECTO'],
    // "El dinero recibido nunca se ignora" (FR-012a).
    ['ANULADO', 'APROBADO', 'APROBADO', null, true, 'APLICADO'],
    ['EXPIRADO', 'APROBADO', 'APROBADO', null, true, 'APLICADO'],
    ['ANULADO', 'RECHAZADO', 'ANULADO', null, false, 'SIN_EFECTO'],
    ['EXPIRADO', 'PENDIENTE', 'EXPIRADO', null, false, 'SIN_EFECTO'],
    // Aprobado tras un rechazo: marca, sin período; lo decide el administrador (FR-017).
    ['RECHAZADO', 'APROBADO', 'RECHAZADO', 'APROBADO_TRAS_RECHAZO', false, 'REVISION'],
    ['RECHAZADO', 'PENDIENTE', 'RECHAZADO', null, false, 'SIN_EFECTO'],
    // Eventos atrasados sobre un pago aprobado: sin efecto.
    ['APROBADO', 'PENDIENTE', 'APROBADO', null, false, 'SIN_EFECTO'],
    ['APROBADO', 'RECHAZADO', 'APROBADO', null, false, 'SIN_EFECTO'],
    ['APROBADO', 'EXPIRADO', 'APROBADO', null, false, 'SIN_EFECTO'],
    ['APROBADO', 'APROBADO', 'APROBADO', null, false, 'SIN_EFECTO'],
    // Devolución o contracargo: marca, sin cambio en la suscripción (FR-017a).
    ['APROBADO', 'DEVUELTO', 'APROBADO', 'DEVOLUCION', false, 'REVISION'],
  ] as const)(
    '%s + proveedor %s → %s (marca %s, período %s, %s)',
    (desde, evento, hacia, marca, aplicar, efecto) => {
      expect(transicionDePago(YAPE(desde), proveedor(evento))).toEqual({
        estado: hacia,
        marca,
        aplicarPeriodo: aplicar,
        efecto,
      });
    },
  );

  it.each(['PENDIENTE', 'ANULADO', 'EXPIRADO'] as const)(
    '%s + aprobado con otro importe → APROBADO con IMPORTE_DISTINTO y sin período',
    (desde) => {
      expect(transicionDePago(YAPE(desde), proveedor('APROBADO', 4800))).toEqual({
        estado: 'APROBADO',
        marca: 'IMPORTE_DISTINTO',
        aplicarPeriodo: false,
        efecto: 'REVISION',
      });
    },
  );

  it('aprobado con otra moneda también es IMPORTE_DISTINTO', () => {
    expect(transicionDePago(YAPE('PENDIENTE'), proveedor('APROBADO', 4900, 'USD')).marca).toBe(
      'IMPORTE_DISTINTO',
    );
  });

  it.each(['ESPERANDO_COMPROBANTE', 'EN_REVISION'] as const)(
    'un evento del proveedor sobre una transferencia (%s) no tiene efecto',
    (desde) => {
      expect(transicionDePago(TRANSFERENCIA(desde), proveedor('APROBADO'))).toEqual({
        estado: desde,
        marca: null,
        aplicarPeriodo: false,
        efecto: 'SIN_EFECTO',
      });
    },
  );
});

describe('PR25 · Pago: órdenes de la plataforma', () => {
  it.each([
    ['PENDIENTE', { tipo: 'ANULAR' }, 'ANULADO', 'YAPE'],
    ['PENDIENTE', { tipo: 'EXPIRAR' }, 'EXPIRADO', 'YAPE'],
    ['ESPERANDO_COMPROBANTE', { tipo: 'COMPROBANTE_SUBIDO' }, 'EN_REVISION', 'TRANSFERENCIA'],
    ['ESPERANDO_COMPROBANTE', { tipo: 'EXPIRAR' }, 'EXPIRADO', 'TRANSFERENCIA'],
    ['ESPERANDO_COMPROBANTE', { tipo: 'ANULAR' }, 'ANULADO', 'TRANSFERENCIA'],
    ['EN_REVISION', { tipo: 'APROBAR_REVISION' }, 'APROBADO', 'TRANSFERENCIA'],
    ['EN_REVISION', { tipo: 'RECHAZAR_REVISION' }, 'RECHAZADO', 'TRANSFERENCIA'],
  ] as const)('%s + %o → %s', (desde, evento, hacia, metodo) => {
    const actual = metodo === 'YAPE' ? YAPE(desde) : TRANSFERENCIA(desde);
    expect(transicionDePago(actual, evento)).toEqual({
      estado: hacia,
      marca: null,
      aplicarPeriodo: hacia === 'APROBADO',
      efecto: 'APLICADO',
    });
  });

  it('un pago con el comprobante en revisión nunca se anula: COMPROBANTE_YA_EN_REVISION (H4)', () => {
    expect(() => transicionDePago(TRANSFERENCIA('EN_REVISION'), { tipo: 'ANULAR' })).toThrow(
      ComprobanteYaEnRevision,
    );
    const error = new ComprobanteYaEnRevision();
    expect(error.codigo).toBe('COMPROBANTE_YA_EN_REVISION');
  });

  // Toda combinación de estado y orden que no está en la tabla es inválida.
  const VALIDAS = new Set([
    'PENDIENTE:ANULAR',
    'PENDIENTE:EXPIRAR',
    'ESPERANDO_COMPROBANTE:COMPROBANTE_SUBIDO',
    'ESPERANDO_COMPROBANTE:EXPIRAR',
    'ESPERANDO_COMPROBANTE:ANULAR',
    'EN_REVISION:APROBAR_REVISION',
    'EN_REVISION:RECHAZAR_REVISION',
    'EN_REVISION:ANULAR',
  ]);
  const ORDENES = [
    'ANULAR',
    'EXPIRAR',
    'COMPROBANTE_SUBIDO',
    'APROBAR_REVISION',
    'RECHAZAR_REVISION',
  ] as const;
  const invalidas = ESTADOS_PAGO.flatMap((estado) =>
    ORDENES.filter((orden) => !VALIDAS.has(`${estado}:${orden}`)).map((orden) => [estado, orden] as const),
  );

  it.each(invalidas)('%s + %s → TransicionDePagoInvalida', (estado, orden) => {
    const metodo = ['ESPERANDO_COMPROBANTE', 'EN_REVISION'].includes(estado) ? TRANSFERENCIA : YAPE;
    expect(() => transicionDePago(metodo(estado), { tipo: orden })).toThrow(TransicionDePagoInvalida);
  });
});

describe('PR25 · Marcas e importes', () => {
  it('las marcas de revisión no son estados', () => {
    for (const marca of MARCAS_REVISION) expect(ESTADOS_PAGO).not.toContain(marca);
    expect(MARCAS_REVISION).toEqual(
      expect.arrayContaining([
        'DUPLICADO',
        'IMPORTE_DISTINTO',
        'APROBADO_TRAS_RECHAZO',
        'DEVOLUCION',
        'FECHA_ANTERIOR_AL_PAGO',
      ]),
    );
  });

  it.each([
    [4900, true],
    [1, true],
    [0, false],
    [-100, false],
    [49.5, false],
    [Number.NaN, false],
    [2 ** 53, false],
  ])('importe en céntimos enteros y positivos: %s → %s', (importe, valido) => {
    expect(esImporteValido(importe)).toBe(valido);
  });
});

import {
  Adelanto,
  ESTADOS_ADELANTO,
  type EstadoAdelanto,
} from '../../../src/modules/suscripciones-pagos/adelantos/domain/adelanto';
import {
  AdelantoNoPorDevolver,
  AdelantoResuelto,
  AdelantoVencido,
  PagoYaRegistrado,
  SinPagoRegistrado,
} from '../../../src/modules/suscripciones-pagos/adelantos/domain/errores';

// T002 de 008 · Estados del adelanto y sus transiciones (data-model §5; FR-013, FR-014, FR-016 a FR-022).
// Cada transición permitida da el estado esperado; cada una no permitida se rechaza con su error, sin efecto.

const MIN = 60_000;
const horaLimite = new Date('2026-11-20T10:30:00-05:00');
const limiteRevision = new Date('2026-11-21T10:30:00-05:00');
const plazos = { horaLimite, limiteRevision };
const antes = (instante: Date) => new Date(instante.getTime() - MIN);
const en = (instante: Date) => new Date(instante.getTime());

const todosMenos = (...excluidos: EstadoAdelanto[]) => ESTADOS_ADELANTO.filter((e) => !excluidos.includes(e));

describe('Adelanto · estados (data-model §5)', () => {
  it('son exactamente los ocho del modelo de datos', () => {
    expect([...ESTADOS_ADELANTO].sort()).toEqual(
      [
        'POR_PAGAR',
        'POR_REVISAR',
        'CONFIRMADO',
        'VENCIDO',
        'ANULADO',
        'POR_DEVOLVER',
        'DEVUELTO',
        'RETENIDO',
      ].sort(),
    );
  });

  it('caben en varchar(12)', () => {
    for (const estado of ESTADOS_ADELANTO) expect(estado.length).toBeLessThanOrEqual(12);
  });

  it('pendientes: POR_PAGAR y POR_REVISAR; el resto ya está resuelto', () => {
    expect(ESTADOS_ADELANTO.filter((e) => Adelanto.estaPendiente(e)).sort()).toEqual([
      'POR_PAGAR',
      'POR_REVISAR',
    ]);
  });
});

describe('Adelanto · registrar el pago (POR_PAGAR → POR_REVISAR; FR-009, FR-010)', () => {
  it('desde POR_PAGAR antes de la hora límite → POR_REVISAR', () => {
    expect(Adelanto.registrarPago('POR_PAGAR', antes(horaLimite), plazos)).toBe('POR_REVISAR');
  });

  it('desde POR_PAGAR en la hora límite o después → ADELANTO_VENCIDO', () => {
    expect(() => Adelanto.registrarPago('POR_PAGAR', en(horaLimite), plazos)).toThrow(AdelantoVencido);
  });

  it('con un pago ya registrado (POR_REVISAR) → PAGO_YA_REGISTRADO', () => {
    expect(() => Adelanto.registrarPago('POR_REVISAR', antes(horaLimite), plazos)).toThrow(PagoYaRegistrado);
  });

  it.each(todosMenos('POR_PAGAR', 'POR_REVISAR'))('desde %s → ADELANTO_RESUELTO', (estado) => {
    expect(() => Adelanto.registrarPago(estado, antes(horaLimite), plazos)).toThrow(AdelantoResuelto);
  });
});

describe('Adelanto · rechazar el pago (POR_REVISAR → POR_PAGAR; FR-014)', () => {
  it('desde POR_REVISAR → POR_PAGAR (con su hora límite original)', () => {
    expect(Adelanto.rechazar('POR_REVISAR')).toBe('POR_PAGAR');
  });

  it('sin pago registrado (POR_PAGAR) → SIN_PAGO_REGISTRADO', () => {
    expect(() => Adelanto.rechazar('POR_PAGAR')).toThrow(SinPagoRegistrado);
  });

  it.each(todosMenos('POR_PAGAR', 'POR_REVISAR'))('desde %s → ADELANTO_RESUELTO', (estado) => {
    expect(() => Adelanto.rechazar(estado)).toThrow(AdelantoResuelto);
  });
});

describe('Adelanto · confirmar (POR_REVISAR → CONFIRMADO; FR-012, FR-013, FR-015)', () => {
  it('desde POR_REVISAR → CONFIRMADO, con efecto', () => {
    expect(Adelanto.confirmar('POR_REVISAR')).toEqual({ estado: 'CONFIRMADO', efecto: true });
  });

  it('ya CONFIRMADO → sin efecto (repetir no cambia nada ni avisa)', () => {
    expect(Adelanto.confirmar('CONFIRMADO')).toEqual({ estado: 'CONFIRMADO', efecto: false });
  });

  it('sin pago registrado (POR_PAGAR) → SIN_PAGO_REGISTRADO', () => {
    expect(() => Adelanto.confirmar('POR_PAGAR')).toThrow(SinPagoRegistrado);
  });

  it.each(todosMenos('POR_PAGAR', 'POR_REVISAR', 'CONFIRMADO'))('desde %s → ADELANTO_RESUELTO', (estado) => {
    expect(() => Adelanto.confirmar(estado)).toThrow(AdelantoResuelto);
  });
});

describe('Adelanto · vencimiento (tarea; FR-017, FR-018)', () => {
  it('POR_PAGAR con la hora límite cumplida → VENCIDO, causa SIN_PAGO', () => {
    expect(Adelanto.decidirVencimiento('POR_PAGAR', en(horaLimite), plazos)).toEqual({
      estado: 'VENCIDO',
      causa: 'SIN_PAGO',
    });
  });

  it('POR_PAGAR antes de la hora límite → nada', () => {
    expect(Adelanto.decidirVencimiento('POR_PAGAR', antes(horaLimite), plazos)).toBeNull();
  });

  it('POR_REVISAR después de la hora límite pero antes del límite máximo → nada (el horario sigue retenido)', () => {
    expect(Adelanto.decidirVencimiento('POR_REVISAR', en(horaLimite), plazos)).toBeNull();
    expect(Adelanto.decidirVencimiento('POR_REVISAR', antes(limiteRevision), plazos)).toBeNull();
  });

  it('POR_REVISAR con el límite máximo adicional cumplido → POR_DEVOLVER, causa SIN_REVISION', () => {
    expect(Adelanto.decidirVencimiento('POR_REVISAR', en(limiteRevision), plazos)).toEqual({
      estado: 'POR_DEVOLVER',
      causa: 'SIN_REVISION',
    });
  });

  it.each(todosMenos('POR_PAGAR', 'POR_REVISAR'))('%s ya resuelto → nada, a cualquier hora', (estado) => {
    expect(
      Adelanto.decidirVencimiento(estado, new Date(limiteRevision.getTime() + 60 * MIN), plazos),
    ).toBeNull();
  });
});

describe('Adelanto · al cancelar la cita (R10; FR-019, FR-021)', () => {
  const cancelaciones = [
    { porCliente: true, tardia: false },
    { porCliente: true, tardia: true },
    { porCliente: false, tardia: false },
  ];

  it.each(cancelaciones)('POR_PAGAR → ANULADO (%o)', (cancelacion) => {
    expect(Adelanto.alCancelar('POR_PAGAR', cancelacion)).toBe('ANULADO');
  });

  it.each(cancelaciones)('POR_REVISAR → POR_DEVOLVER (%o): el propietario pudo recibirlo', (cancelacion) => {
    expect(Adelanto.alCancelar('POR_REVISAR', cancelacion)).toBe('POR_DEVOLVER');
  });

  it('CONFIRMADO, cancela el cliente con tiempo → POR_DEVOLVER', () => {
    expect(Adelanto.alCancelar('CONFIRMADO', { porCliente: true, tardia: false })).toBe('POR_DEVOLVER');
  });

  it('CONFIRMADO, cancela el propietario → POR_DEVOLVER', () => {
    expect(Adelanto.alCancelar('CONFIRMADO', { porCliente: false, tardia: false })).toBe('POR_DEVOLVER');
  });

  it('CONFIRMADO, cancela tarde el cliente → RETENIDO', () => {
    expect(Adelanto.alCancelar('CONFIRMADO', { porCliente: true, tardia: true })).toBe('RETENIDO');
  });

  it.each(todosMenos('POR_PAGAR', 'POR_REVISAR', 'CONFIRMADO'))('desde %s → ADELANTO_RESUELTO', (estado) => {
    expect(() => Adelanto.alCancelar(estado, { porCliente: true, tardia: false })).toThrow(AdelantoResuelto);
  });
});

describe('Adelanto · no asistió (FR-021)', () => {
  it('CONFIRMADO → RETENIDO', () => {
    expect(Adelanto.alNoAsistir('CONFIRMADO')).toBe('RETENIDO');
  });

  it.each(todosMenos('CONFIRMADO'))(
    'desde %s → ADELANTO_RESUELTO (la cita no podía estar confirmada)',
    (estado) => {
      expect(() => Adelanto.alNoAsistir(estado)).toThrow(AdelantoResuelto);
    },
  );
});

describe('Adelanto · marcar devuelto (aclaración Q2; FR-022)', () => {
  it('POR_DEVOLVER → DEVUELTO', () => {
    expect(Adelanto.marcarDevuelto('POR_DEVOLVER')).toBe('DEVUELTO');
  });

  it.each(todosMenos('POR_DEVOLVER'))('desde %s → ADELANTO_NO_POR_DEVOLVER', (estado) => {
    expect(() => Adelanto.marcarDevuelto(estado)).toThrow(AdelantoNoPorDevolver);
  });
});

describe('Adelanto · saldo del día de la cita (FR-020)', () => {
  it('saldo = precio − adelanto', () => {
    expect(Adelanto.saldo(3000, 600)).toBe(2400);
    expect(Adelanto.saldo(3000, 3000)).toBe(0);
  });
});

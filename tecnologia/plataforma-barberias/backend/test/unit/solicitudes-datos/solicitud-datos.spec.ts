import { FechaLocal } from '../../../src/shared/nucleo';
import { sumarDiasHabiles } from '../../../src/modules/acceso-barberias/solicitudes-datos/domain/dias-habiles';
import {
  SolicitudCerrada,
  SolicitudYaEnAtencion,
  ValidacionSolicitud,
} from '../../../src/modules/acceso-barberias/solicitudes-datos/domain/errores';
import {
  type NuevaSolicitudDatos,
  SolicitudDatos,
} from '../../../src/modules/acceso-barberias/solicitudes-datos/domain/solicitud-datos';

// T001 de 007 · FR-004, FR-011; data-model §1: transiciones RECIBIDA → EN_ATENCION → ATENDIDA | RECHAZADA (y las
// directas desde RECIBIDA), estados finales, plazo de 10 días hábiles (lunes a viernes, sin feriados) desde la fecha
// local, "vencida" al leer y las reglas del dominio (422).

const AHORA = new Date('2026-11-16T15:00:00Z');
const PROPIETARIO = '0193a000-0000-7000-8000-0000000000aa';

function nueva(cambios: Partial<NuevaSolicitudDatos> = {}): SolicitudDatos {
  return SolicitudDatos.registrar({
    id: '0193a000-0000-7000-8000-000000000001',
    tenantId: '0193a000-0000-7000-8000-0000000000bb',
    tipo: 'ACCESO',
    titular: { tipo: 'CLIENTE', clienteId: '0193a000-0000-7000-8000-0000000000cc' },
    detalle: null,
    registradaPor: '0193a000-0000-7000-8000-0000000000dd',
    enNombre: false,
    recibidaEn: AHORA,
    fechaLocal: FechaLocal.de('2026-11-16'),
    ...cambios,
  });
}

function problemaDe(fn: () => unknown): { campo: unknown; problema: unknown; estado: unknown } {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidacionSolicitud);
    const e = error as ValidacionSolicitud;
    return { campo: e.detalles[0]?.campo, problema: e.detalles[0]?.problema, estado: e.estadoHttp };
  }
  throw new Error('No lanzó ValidacionSolicitud');
}

describe('SolicitudDatos (dominio, T001 de 007)', () => {
  describe('registro', () => {
    it('queda RECIBIDA, con la fecha, el tipo, el titular y el plazo de 10 días hábiles', () => {
      const s = nueva();
      expect(s.estado).toBe('RECIBIDA');
      expect(s.tipo).toBe('ACCESO');
      expect(s.recibidaEn).toEqual(AHORA);
      expect(s.venceEl.toString()).toBe('2026-11-30');
      expect(s.enNombre).toBe(false);
      expect([s.respuesta, s.motivo, s.enAtencionDesde, s.cerradaEn, s.cerradaPor]).toEqual([
        null,
        null,
        null,
        null,
        null,
      ]);
    });

    it('una rectificación sin detalle (o solo con espacios) no se registra: 422 con el campo detalle', () => {
      expect(problemaDe(() => nueva({ tipo: 'RECTIFICACION', detalle: null }))).toEqual({
        campo: 'detalle',
        problema: 'requerido',
        estado: 422,
      });
      expect(problemaDe(() => nueva({ tipo: 'RECTIFICACION', detalle: '   ' }))).toEqual({
        campo: 'detalle',
        problema: 'requerido',
        estado: 422,
      });
    });

    it('una rectificación con detalle se registra y guarda el detalle sin los espacios de los extremos', () => {
      const s = nueva({ tipo: 'RECTIFICACION', detalle: '  Mi teléfono es 987654321  ' });
      expect(s.detalle).toBe('Mi teléfono es 987654321');
    });

    it('el detalle de más de 500 caracteres se rechaza también en el dominio', () => {
      expect(problemaDe(() => nueva({ detalle: 'x'.repeat(501) }))).toEqual({
        campo: 'detalle',
        problema: 'largo',
        estado: 422,
      });
    });

    it('un barbero puede ser el titular; "en nombre de" queda marcado', () => {
      const barbero = nueva({
        titular: { tipo: 'BARBERO', membresiaId: '0193a000-0000-7000-8000-0000000000ee' },
      });
      expect(barbero.titular).toEqual({
        tipo: 'BARBERO',
        membresiaId: '0193a000-0000-7000-8000-0000000000ee',
      });
      expect(nueva({ enNombre: true }).enNombre).toBe(true);
    });
  });

  describe('transiciones', () => {
    const DESPUES = new Date('2026-11-17T15:00:00Z');

    it('RECIBIDA → EN_ATENCION → ATENDIDA, con la respuesta, quién y cuándo', () => {
      const s = nueva();
      s.iniciarAtencion(DESPUES);
      expect([s.estado, s.enAtencionDesde]).toEqual(['EN_ATENCION', DESPUES]);
      s.atender('Se corrigió el teléfono a mano.', PROPIETARIO, DESPUES);
      expect([s.estado, s.respuesta, s.cerradaPor, s.cerradaEn]).toEqual([
        'ATENDIDA',
        'Se corrigió el teléfono a mano.',
        PROPIETARIO,
        DESPUES,
      ]);
    });

    it('RECIBIDA → EN_ATENCION → RECHAZADA, con el motivo', () => {
      const s = nueva();
      s.iniciarAtencion(DESPUES);
      s.rechazar('No es titular de la cuenta', PROPIETARIO, DESPUES);
      expect([s.estado, s.motivo, s.respuesta]).toEqual(['RECHAZADA', 'No es titular de la cuenta', null]);
    });

    it('desde RECIBIDA se puede atender o rechazar directamente', () => {
      const atendida = nueva();
      atendida.atender('Hecho.', PROPIETARIO, DESPUES);
      expect([atendida.estado, atendida.enAtencionDesde]).toEqual(['ATENDIDA', null]);
      const rechazada = nueva();
      rechazada.rechazar('Motivo válido', PROPIETARIO, DESPUES);
      expect(rechazada.estado).toBe('RECHAZADA');
    });

    it('iniciar una que ya está en atención responde 409 SOLICITUD_YA_EN_ATENCION', () => {
      const s = nueva();
      s.iniciarAtencion(DESPUES);
      expect(() => s.iniciarAtencion(DESPUES)).toThrow(SolicitudYaEnAtencion);
    });

    it.each([
      ['ATENDIDA', (s: SolicitudDatos) => s.atender('Hecho.', PROPIETARIO, DESPUES)],
      ['RECHAZADA', (s: SolicitudDatos) => s.rechazar('Motivo válido', PROPIETARIO, DESPUES)],
    ])('desde %s (estado final) ninguna transición: 409 SOLICITUD_CERRADA', (_estado, cerrar) => {
      const s = nueva();
      cerrar(s);
      expect(() => s.iniciarAtencion(DESPUES)).toThrow(SolicitudCerrada);
      expect(() => s.atender('Otra vez.', PROPIETARIO, DESPUES)).toThrow(SolicitudCerrada);
      expect(() => s.rechazar('Otra vez sí', PROPIETARIO, DESPUES)).toThrow(SolicitudCerrada);
      expect(new SolicitudCerrada().codigo).toBe('SOLICITUD_CERRADA');
    });

    it('ATENDIDA sin respuesta (o vacía) responde 422 con el campo respuesta, y la solicitud no cambia', () => {
      const s = nueva();
      expect(problemaDe(() => s.atender('', PROPIETARIO, DESPUES))).toEqual({
        campo: 'respuesta',
        problema: 'requerido',
        estado: 422,
      });
      expect(problemaDe(() => s.atender(null, PROPIETARIO, DESPUES))).toEqual({
        campo: 'respuesta',
        problema: 'requerido',
        estado: 422,
      });
      expect(s.estado).toBe('RECIBIDA');
    });

    it('RECHAZADA sin motivo responde 422 con el campo motivo; un motivo de menos de 5 o más de 300, también', () => {
      const s = nueva();
      expect(problemaDe(() => s.rechazar(null, PROPIETARIO, DESPUES))).toEqual({
        campo: 'motivo',
        problema: 'requerido',
        estado: 422,
      });
      expect(problemaDe(() => s.rechazar('  no ', PROPIETARIO, DESPUES)).campo).toBe('motivo');
      expect(problemaDe(() => s.rechazar('x'.repeat(301), PROPIETARIO, DESPUES)).campo).toBe('motivo');
      expect(s.estado).toBe('RECIBIDA');
    });
  });

  describe('vencida (se calcula al leer, no se guarda)', () => {
    it('abierta y con el plazo pasado: vencida; el mismo día del plazo, todavía no', () => {
      const s = nueva();
      expect(s.vencidaEn(FechaLocal.de('2026-11-30'))).toBe(false);
      expect(s.vencidaEn(FechaLocal.de('2026-12-01'))).toBe(true);
      s.iniciarAtencion(new Date('2026-12-01T15:00:00Z'));
      expect(s.vencidaEn(FechaLocal.de('2026-12-01'))).toBe(true);
    });

    it('una cerrada nunca está vencida, aunque se haya cerrado tarde', () => {
      const s = nueva();
      s.atender('Hecho.', PROPIETARIO, new Date('2026-12-10T15:00:00Z'));
      expect(s.vencidaEn(FechaLocal.de('2026-12-10'))).toBe(false);
    });
  });
});

describe('sumarDiasHabiles (lunes a viernes, sin feriados)', () => {
  it.each([
    ['un lunes', '2026-11-16', '2026-11-30'],
    ['un viernes', '2026-11-20', '2026-12-04'],
    ['un sábado (cuenta desde el lunes)', '2026-11-21', '2026-12-04'],
    ['un domingo', '2026-11-22', '2026-12-04'],
    ['a fin de mes', '2026-11-30', '2026-12-14'],
    ['a fin de año', '2026-12-28', '2027-01-11'],
  ])('registrada %s (%s) vence el %s', (_caso, desde, hasta) => {
    expect(sumarDiasHabiles(FechaLocal.de(desde), 10).toString()).toBe(hasta);
  });

  it('el plazo nunca cae en sábado ni domingo', () => {
    let fecha = FechaLocal.de('2026-01-01');
    for (let i = 0; i < 400; i++) {
      expect([0, 6]).not.toContain(sumarDiasHabiles(fecha, 10).diaSemana);
      fecha = fecha.sumarDias(1);
    }
  });
});

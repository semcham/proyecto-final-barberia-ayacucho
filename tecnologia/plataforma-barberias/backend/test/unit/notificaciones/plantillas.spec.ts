import { componerAviso, datosDelEvento } from '../../../src/modules/notificaciones/domain/plantillas';

// T059 · Plantillas de los avisos de cita (FR-013, FR-014; principio VII, datos mínimos). Texto simple con la
// barbería, el servicio, el barbero, la fecha y la hora EN LA HORA DE LA BARBERÍA y, en la reprogramación, la
// hora anterior. Nunca el teléfono, el correo ni otros datos del cliente, ni datos de otras citas: la plantilla
// solo puede usar los campos que deja pasar `datosDelEvento`.

const TELEFONO = '987654321';
const CORREO = 'rocio.huamani@prueba.pe';

/** Payload con campos de más, como si un evento trajera datos que no debe (nunca debe pasar). */
const payload = {
  citaId: '0190a1b2-0000-7000-8000-000000000001',
  clienteId: '0190a1b2-0000-7000-8000-00000000000c',
  servicio: 'Corte clásico',
  barbero: 'Carlos Ñaupa',
  // 15:00 UTC = 10:00 en Lima.
  inicio: '2026-11-12T15:00:00.000Z',
  fin: '2026-11-12T15:30:00.000Z',
  inicioAnterior: '2026-11-11T14:00:00.000Z',
  zonaHoraria: 'America/Lima',
  telefono: TELEFONO,
  correo: CORREO,
  cliente: { nombre: 'Rocío Huamaní', telefono: TELEFONO },
  otraCita: { servicio: 'Barba', inicio: '2026-11-20T15:00:00.000Z' },
};

const datos = datosDelEvento(payload, 'Barbería Huamanga');

describe('Plantillas de avisos de cita (T059)', () => {
  it('datosDelEvento deja pasar solo los campos que el mensaje necesita', () => {
    expect(datos).toEqual({
      barberia: 'Barbería Huamanga',
      servicio: 'Corte clásico',
      barbero: 'Carlos Ñaupa',
      inicio: '2026-11-12T15:00:00.000Z',
      inicioAnterior: '2026-11-11T14:00:00.000Z',
      zonaHoraria: 'America/Lima',
    });
  });

  it('confirmación al cliente: barbería, servicio, barbero, fecha y hora de la barbería', () => {
    const { asunto, texto } = componerAviso('CITA_CREADA', 'CLIENTE', datos);
    expect(asunto).toMatch(/cita confirmada/i);
    expect(asunto).toContain('Barbería Huamanga');
    for (const parte of [
      'Barbería Huamanga',
      'Corte clásico',
      'Carlos Ñaupa',
      '12 de noviembre de 2026',
      '10:00',
    ]) {
      expect(texto).toContain(parte);
    }
    expect(texto).toMatch(/hora de la barbería/i);
  });

  it('la hora sale en la zona de la barbería, no en UTC ni en la del servidor', () => {
    const { texto } = componerAviso('CITA_CREADA', 'CLIENTE', {
      ...datos,
      zonaHoraria: 'America/Mexico_City',
    });
    expect(texto).toContain('09:00');
    expect(texto).not.toContain('15:00');
  });

  it('reprogramación: la hora anterior y la nueva', () => {
    const { asunto, texto } = componerAviso('CITA_REPROGRAMADA', 'CLIENTE', datos);
    expect(asunto).toMatch(/reprogramada/i);
    expect(texto).toContain('11 de noviembre de 2026');
    expect(texto).toContain('09:00');
    expect(texto).toContain('12 de noviembre de 2026');
    expect(texto).toContain('10:00');
    expect(texto.indexOf('09:00')).toBeLessThan(texto.indexOf('10:00'));
  });

  it('cancelación: al cliente y al personal', () => {
    expect(componerAviso('CITA_CANCELADA', 'CLIENTE', datos).asunto).toMatch(/cancelada/i);
    const alPersonal = componerAviso('CITA_CANCELADA', 'PROPIETARIO', datos);
    expect(alPersonal.texto).toMatch(/el cliente canceló/i);
    expect(componerAviso('CITA_REPROGRAMADA', 'BARBERO', datos).texto).toMatch(/el cliente reprogramó/i);
  });

  it.each([
    ['CITA_CREADA', 'CLIENTE'],
    ['CITA_CANCELADA', 'CLIENTE'],
    ['CITA_CANCELADA', 'PROPIETARIO'],
    ['CITA_CANCELADA', 'BARBERO'],
    ['CITA_REPROGRAMADA', 'CLIENTE'],
    ['CITA_REPROGRAMADA', 'PROPIETARIO'],
    ['CITA_REPROGRAMADA', 'BARBERO'],
  ] as const)(
    '%s para %s: texto simple, sin teléfono, correo, nombre del cliente ni otras citas',
    (tipo, para) => {
      // Aunque el payload traiga datos de más, la plantilla compone con `datosDelEvento`.
      const { asunto, texto } = componerAviso(tipo, para, datosDelEvento(payload, 'Barbería Huamanga'));
      const todo = `${asunto}\n${texto}`;
      expect(todo).not.toContain(TELEFONO);
      expect(todo).not.toContain(CORREO);
      expect(todo).not.toContain('@');
      expect(todo).not.toContain('Rocío');
      expect(todo).not.toContain('Barba');
      expect(todo).not.toContain('20 de noviembre');
      // Texto simple: ni HTML ni enlaces en los avisos de cita (los enlaces son solo del recordatorio, fase 4).
      expect(todo).not.toMatch(/<[a-z/][^>]*>/i);
      expect(todo).not.toMatch(/https?:\/\//);
      expect(asunto.length).toBeLessThanOrEqual(120);
      expect(asunto).not.toContain('\n');
    },
  );
});

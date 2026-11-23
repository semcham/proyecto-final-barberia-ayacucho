import {
  componerAviso,
  componerAvisoDeCuenta,
  datosDeCuenta,
  datosDelEvento,
} from '../../../src/modules/notificaciones/domain/plantillas';

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

// T059 de 008 (fase 6, US5-2; contracts/eventos.md §2 de 008): CitaCancelada trae `adelanto` (POR_DEVOLVER o
// RETENIDO) cuando la cita tenía uno; la plantilla lo menciona al cliente y al propietario. Sin el campo, igual que en 004.
describe('CITA_CANCELADA con el adelanto (T059 de 008)', () => {
  const conAdelanto = (adelanto: string) =>
    datosDelEvento({ ...payload, canceladaPor: 'CLIENTE', adelanto }, 'Barbería Huamanga');

  it('datosDelEvento solo deja pasar POR_DEVOLVER o RETENIDO', () => {
    expect(conAdelanto('POR_DEVOLVER').adelanto).toBe('POR_DEVOLVER');
    expect(conAdelanto('RETENIDO').adelanto).toBe('RETENIDO');
    expect(conAdelanto('ANULADO').adelanto).toBeUndefined();
    expect(conAdelanto('cualquier cosa').adelanto).toBeUndefined();
    expect(datos.adelanto).toBeUndefined();
  });

  it('por devolver: al cliente, que la barbería se lo devolverá; al propietario, que lo devuelva', () => {
    const alCliente = componerAviso('CITA_CANCELADA', 'CLIENTE', conAdelanto('POR_DEVOLVER')).texto;
    const alPropietario = componerAviso('CITA_CANCELADA', 'PROPIETARIO', conAdelanto('POR_DEVOLVER')).texto;
    expect(alCliente).toMatch(/la barbería debe devolverte el adelanto/i);
    expect(alPropietario).toMatch(/devuelve el adelanto/i);
    expect(alPropietario).toMatch(/por devolver/i);
  });

  it('retenido: al cliente y al propietario, que el adelanto queda para la barbería', () => {
    const alCliente = componerAviso('CITA_CANCELADA', 'CLIENTE', conAdelanto('RETENIDO')).texto;
    const alPropietario = componerAviso('CITA_CANCELADA', 'PROPIETARIO', conAdelanto('RETENIDO')).texto;
    expect(alCliente).toMatch(/el adelanto no se devuelve/i);
    expect(alPropietario).toMatch(/el adelanto queda para la barbería/i);
    expect(`${alCliente}${alPropietario}`).not.toMatch(/devuelve el adelanto|debe devolverte/i);
  });

  it('el barbero no recibe datos del adelanto, y sin el campo el texto es el de 004', () => {
    const alBarbero = componerAviso('CITA_CANCELADA', 'BARBERO', conAdelanto('POR_DEVOLVER')).texto;
    expect(alBarbero).not.toMatch(/adelanto/i);
    expect(componerAviso('CITA_CANCELADA', 'CLIENTE', datos).texto).not.toMatch(/adelanto/i);
  });
});

// T033 de 010 · Avisos de la cuenta (contracts/eventos-y-avisos.md §2 de 010; constitución 1.8.0, principio VII): el
// nombre de la barbería, el enlace con su vigencia y, al cambiar la contraseña, la fecha. Nunca el correo de la persona,
// la contraseña ni datos de citas, aunque el evento los trajera.
describe('Plantillas de los avisos de la cuenta (010)', () => {
  const ENLACE_VERIFICAR = 'https://citas.barberias.pe/verificar#token-de-prueba-0123456789';
  const ENLACE_RESTABLECER = 'https://citas.barberias.pe/restablecer#token-de-prueba-9876543210';
  const CONTRASENA = 'mi-clave-secreta-de-prueba';
  /** Un payload con campos de más (nunca debe pasar), para comprobar que la lista de datos es cerrada. */
  const conDeMas = {
    enlaceId: '0190a1b2-0000-7000-8000-0000000000e1',
    usuarioId: '0190a1b2-0000-7000-8000-0000000000u1',
    proposito: 'VERIFICAR_CORREO',
    venceEn: '2026-11-24T15:00:00.000Z',
    cambiadaEn: '2026-11-23T15:00:00.000Z',
    correo: CORREO,
    telefono: TELEFONO,
    contrasena: CONTRASENA,
    servicio: 'Corte clásico',
  };
  const textoDe = (
    tipo: 'VERIFICAR_CORREO' | 'RECUPERAR_CONTRASENA' | 'CONTRASENA_CAMBIADA',
    enlace?: string,
  ) => {
    const { asunto, texto } = componerAvisoDeCuenta(
      tipo,
      datosDeCuenta(conDeMas, 'Barbería Huamanga', 'America/Lima', enlace),
    );
    return `${asunto}\n${texto}`;
  };

  it('verificar el correo: la barbería, el enlace, su vigencia de 24 h y "si no fuiste tú"', () => {
    const texto = textoDe('VERIFICAR_CORREO', ENLACE_VERIFICAR);
    expect(texto).toContain('Barbería Huamanga');
    expect(texto).toContain(ENLACE_VERIFICAR);
    expect(texto).toMatch(/24 horas/);
    expect(texto).toMatch(/si no fuiste tú, ignora este correo/i);
  });

  it('recuperar la contraseña: el enlace, su vigencia de 1 hora y que la contraseña no cambia si no se pidió', () => {
    const texto = textoDe('RECUPERAR_CONTRASENA', ENLACE_RESTABLECER);
    expect(texto).toContain(ENLACE_RESTABLECER);
    expect(texto).toMatch(/1 hora/);
    expect(texto).toMatch(/si no lo pediste, ignora este correo: tu contraseña no cambia/i);
  });

  it('contraseña cambiada: la fecha y hora en la zona de la barbería, sesiones cerradas y qué hacer si no fue la persona', () => {
    const texto = textoDe('CONTRASENA_CAMBIADA');
    // 15:00 UTC = 10:00 en Lima.
    expect(texto).toMatch(/23 de noviembre de 2026, a las 10:00/);
    expect(texto).toMatch(/cerramos las sesiones/i);
    expect(texto).toMatch(/si no fuiste tú, pide otra recuperación/i);
  });

  it.each(['VERIFICAR_CORREO', 'RECUPERAR_CONTRASENA', 'CONTRASENA_CAMBIADA'] as const)(
    '%s: nunca el correo, el teléfono, la contraseña ni datos de citas',
    (tipo) => {
      const texto = textoDe(tipo, tipo === 'CONTRASENA_CAMBIADA' ? undefined : ENLACE_VERIFICAR);
      for (const prohibido of [
        CORREO,
        TELEFONO,
        CONTRASENA,
        'Corte clásico',
        conDeMas.enlaceId,
        conDeMas.usuarioId,
      ]) {
        expect(texto).not.toContain(prohibido);
      }
      expect(Object.keys(datosDeCuenta(conDeMas, 'B', 'America/Lima'))).toEqual([
        'barberia',
        'zonaHoraria',
        'cambiadaEn',
      ]);
    },
  );

  it('los avisos con enlace no se componen sin él', () => {
    expect(() => textoDe('VERIFICAR_CORREO')).toThrow();
    expect(() => textoDe('RECUPERAR_CONTRASENA')).toThrow();
  });
});

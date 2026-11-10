import { destinatariosDe } from '../../../src/modules/notificaciones/domain/destinatarios';
import { elegirCanal } from '../../../src/modules/notificaciones/domain/eleccion-canal';

// T058 · Quién recibe qué (contracts/eventos.md §4; FR-008, FR-009, FR-015). El cliente siempre; el propietario
// y el barbero con usuario, solo si canceló o reprogramó el cliente. El propietario se identifica por la barbería
// (tenant): su correo se resuelve al enviar. Un cliente sin correo (presencial) → el aviso se descarta (SIN_CANAL).

const TENANT = '0190a1b2-0000-7000-8000-00000000000a';
const CLIENTE = '0190a1b2-0000-7000-8000-00000000000c';
const BARBERO_USUARIO = '0190a1b2-0000-7000-8000-00000000000b';

const base = {
  citaId: '0190a1b2-0000-7000-8000-000000000001',
  clienteId: CLIENTE,
  servicio: 'Corte',
  barbero: 'Luis',
  inicio: '2026-11-12T10:00:00-05:00',
  zonaHoraria: 'America/Lima',
};

const cliente = { tipo: 'CLIENTE', ref: CLIENTE };
const propietario = { tipo: 'PROPIETARIO', ref: TENANT };
const barbero = { tipo: 'BARBERO', ref: BARBERO_USUARIO };

describe('Destinatarios por evento (contracts/eventos.md §4)', () => {
  it('CitaCreada: solo el cliente (también la cita presencial)', () => {
    expect(destinatariosDe('CitaCreada', { ...base, origen: 'EN_LINEA' }, TENANT)).toEqual([cliente]);
    expect(
      destinatariosDe(
        'CitaCreada',
        { ...base, origen: 'PRESENCIAL', barberoUsuarioId: BARBERO_USUARIO },
        TENANT,
      ),
    ).toEqual([cliente]);
  });

  it('CitaCancelada por el cliente: cliente, propietario y barbero con usuario', () => {
    expect(
      destinatariosDe(
        'CitaCancelada',
        { ...base, canceladaPor: 'CLIENTE', tardia: false, barberoUsuarioId: BARBERO_USUARIO },
        TENANT,
      ),
    ).toEqual([cliente, propietario, barbero]);
  });

  it('CitaCancelada por el cliente con un barbero sin usuario: cliente y propietario', () => {
    expect(
      destinatariosDe('CitaCancelada', { ...base, canceladaPor: 'CLIENTE', tardia: true }, TENANT),
    ).toEqual([cliente, propietario]);
  });

  it('CitaCancelada por el propietario: solo el cliente', () => {
    expect(
      destinatariosDe(
        'CitaCancelada',
        { ...base, canceladaPor: 'PROPIETARIO', tardia: false, barberoUsuarioId: BARBERO_USUARIO },
        TENANT,
      ),
    ).toEqual([cliente]);
  });

  it('CitaReprogramada por el cliente: cliente, propietario y barbero con usuario; por el propietario: solo el cliente', () => {
    const reprogramada = { ...base, version: 2, inicioAnterior: '2026-11-12T09:00:00-05:00', fin: '' };
    expect(
      destinatariosDe(
        'CitaReprogramada',
        { ...reprogramada, reprogramadaPor: 'CLIENTE', barberoUsuarioId: BARBERO_USUARIO },
        TENANT,
      ),
    ).toEqual([cliente, propietario, barbero]);
    expect(
      destinatariosDe(
        'CitaReprogramada',
        { ...reprogramada, reprogramadaPor: 'PROPIETARIO', barberoUsuarioId: BARBERO_USUARIO },
        TENANT,
      ),
    ).toEqual([cliente]);
  });

  it('un tipo que no es de cita no tiene destinatarios aquí', () => {
    expect(destinatariosDe('PagoAprobado', { pagoId: 'x' }, TENANT)).toEqual([]);
  });

  it('un payload sin clienteId no crea avisos (evento mal formado)', () => {
    expect(destinatariosDe('CitaCreada', { ...base, clienteId: undefined }, TENANT)).toEqual([]);
  });
});

describe('Elección de canal (fase 3: siempre correo)', () => {
  it('con correo: CORREO a esa dirección', () => {
    expect(elegirCanal({ correo: 'ana@prueba.pe', canal: 'CORREO' })).toEqual({
      canal: 'CORREO',
      destino: 'ana@prueba.pe',
    });
  });

  it('el cliente presencial sin correo, o un destinatario que ya no existe: se descarta con SIN_CANAL', () => {
    expect(elegirCanal({ correo: null, canal: 'CORREO' })).toEqual({ descartar: 'SIN_CANAL' });
    expect(elegirCanal(null)).toEqual({ descartar: 'SIN_CANAL' });
  });
});

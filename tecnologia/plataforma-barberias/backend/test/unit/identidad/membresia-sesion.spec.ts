import { OperacionNoPermitida } from '../../../src/modules/acceso-barberias/identidad/domain/errores';
import { Membresia } from '../../../src/modules/acceso-barberias/identidad/domain/membresia';
import { Sesion } from '../../../src/modules/acceso-barberias/identidad/domain/sesion';

const DIA = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-10-15T12:00:00Z');
const despues = (dias: number) => new Date(T0.getTime() + dias * DIA);

describe('Membresia', () => {
  const tenant = 'tenant-a';

  it('el propietario nace ACTIVA y el barbero PENDIENTE', () => {
    expect(Membresia.crearPropietario('m1', tenant, 'u1').estado).toBe('ACTIVA');
    expect(Membresia.crearBarberoPendiente('m2', tenant, 'u2').estado).toBe('PENDIENTE');
  });

  it('PENDIENTE → ACTIVA al activar; no se activa dos veces', () => {
    const barbero = Membresia.crearBarberoPendiente('m2', tenant, 'u2');
    barbero.activar();
    expect(barbero.estado).toBe('ACTIVA');
    expect(() => barbero.activar()).toThrow(OperacionNoPermitida);
  });

  it('el propietario desactiva a un barbero activo o pendiente', () => {
    const activo = Membresia.crearBarberoPendiente('m2', tenant, 'u2');
    activo.activar();
    activo.desactivar('u1');
    expect(activo.estado).toBe('DESACTIVADA');

    const pendiente = Membresia.crearBarberoPendiente('m3', tenant, 'u3');
    pendiente.desactivar('u1');
    expect(pendiente.estado).toBe('DESACTIVADA');
  });

  it('el propietario no puede desactivarse a sí mismo (FR-019)', () => {
    const propietario = Membresia.crearPropietario('m1', tenant, 'u1');
    expect(() => propietario.desactivar('u1')).toThrow(OperacionNoPermitida);
    expect(propietario.estado).toBe('ACTIVA');
  });

  it('no se desactiva dos veces', () => {
    const barbero = Membresia.crearBarberoPendiente('m2', tenant, 'u2');
    barbero.desactivar('u1');
    expect(() => barbero.desactivar('u1')).toThrow(OperacionNoPermitida);
  });

  it('reactivar vuelve a ACTIVA con contraseña o a PENDIENTE sin ella', () => {
    const conClave = Membresia.crearBarberoPendiente('m2', tenant, 'u2');
    conClave.activar();
    conClave.desactivar('u1');
    conClave.reactivar(true);
    expect(conClave.estado).toBe('ACTIVA');

    const sinClave = Membresia.crearBarberoPendiente('m3', tenant, 'u3');
    sinClave.desactivar('u1');
    sinClave.reactivar(false);
    expect(sinClave.estado).toBe('PENDIENTE');
  });

  it('solo se reactiva una membresía desactivada', () => {
    expect(() => Membresia.crearPropietario('m1', tenant, 'u1').reactivar(true)).toThrow(
      OperacionNoPermitida,
    );
  });
});

describe('Sesion', () => {
  const nueva = () => Sesion.iniciar('s1', 'tenant-a', 'u1', 'hash-1', T0);

  it('está vigente al iniciar y vence a los 7 días sin uso', () => {
    const sesion = nueva();
    expect(sesion.estaVigente(despues(6.9))).toBe(true);
    expect(sesion.estaVigente(despues(7))).toBe(false);
  });

  it('cada renovación desliza la vida 7 días, con tope absoluto de 30', () => {
    const sesion = nueva();
    for (const dia of [6, 12, 18, 24]) sesion.rotar(`hash-${dia}`, despues(dia));
    expect(sesion.estaVigente(despues(29.9))).toBe(true);
    expect(sesion.estaVigente(despues(30))).toBe(false);
  });

  it('rotar guarda el token anterior para detectar su reutilización', () => {
    const sesion = nueva();
    sesion.rotar('hash-2', despues(1));
    expect(sesion.hashTokenVigente).toBe('hash-2');
    expect(sesion.esTokenAnterior('hash-1')).toBe(true);
    expect(sesion.esTokenAnterior('hash-2')).toBe(false);
  });

  it('no se puede rotar una sesión que no está vigente', () => {
    const sesion = nueva();
    sesion.cerrar(despues(1));
    expect(() => sesion.rotar('hash-2', despues(1))).toThrow(OperacionNoPermitida);
    expect(() => nueva().rotar('hash-2', despues(8))).toThrow(OperacionNoPermitida);
  });

  it('cerrar y revocar terminan la sesión y son idempotentes', () => {
    const cerrada = nueva();
    cerrada.cerrar(despues(1));
    cerrada.revocar(despues(2));
    expect(cerrada.estado).toBe('CERRADA');
    expect(cerrada.terminadaEn).toEqual(despues(1));

    const revocada = nueva();
    revocada.revocar(despues(1));
    expect(revocada.estado).toBe('REVOCADA');
    expect(revocada.estaVigente(despues(1))).toBe(false);
  });

  it('se purga 30 días después de terminar (R08)', () => {
    const cerrada = nueva();
    cerrada.cerrar(despues(1));
    expect(cerrada.debePurgarse(despues(31))).toBe(false);
    expect(cerrada.debePurgarse(despues(31.1))).toBe(true);
  });

  it('una sesión vencida por tiempo se purga 30 días después de su vencimiento', () => {
    const vencida = nueva(); // vence en el día 7 sin uso
    expect(vencida.debePurgarse(despues(37))).toBe(false);
    expect(vencida.debePurgarse(despues(37.1))).toBe(true);
  });

  it('una sesión vigente nunca se purga', () => {
    expect(nueva().debePurgarse(despues(1))).toBe(false);
  });
});

// T121 · Período de gracia en la rotación del token de renovación (FR-008a, research R23).
describe('Sesion: período de gracia', () => {
  const GRACIA_MS = 10_000;
  const ROTACION = despues(1);
  const segundos = (s: number) => new Date(ROTACION.getTime() + s * 1000);
  // hash-1 (inicial) → hash-2 (vigente tras rotar en ROTACION).
  const rotada = () => {
    const sesion = Sesion.iniciar('s1', 'tenant-a', 'u1', 'hash-1', T0);
    sesion.rotar('hash-2', ROTACION);
    return sesion;
  };

  it('rotar registra el momento de la rotación y deja la gracia disponible', () => {
    const sesion = rotada();
    expect(sesion.rotadaEn).toEqual(ROTACION);
    expect(sesion.graciaUsadaEn).toBeNull();
    expect(sesion.hashTokenReemplazado).toBeNull();
  });

  it('clasifica el vigente, el anterior dentro de la ventana y un token desconocido', () => {
    const sesion = rotada();
    expect(sesion.clasificarToken('hash-2', segundos(5), GRACIA_MS)).toBe('VIGENTE');
    expect(sesion.clasificarToken('hash-1', segundos(5), GRACIA_MS)).toBe('GRACIA');
    expect(sesion.clasificarToken('hash-1', segundos(10), GRACIA_MS)).toBe('GRACIA');
    expect(sesion.clasificarToken('otro', segundos(5), GRACIA_MS)).toBe('DESCONOCIDO');
  });

  it('el anterior fuera de la ventana es una reutilización (robo real)', () => {
    expect(rotada().clasificarToken('hash-1', segundos(11), GRACIA_MS)).toBe('REUTILIZADO');
  });

  it('la gracia sirve una sola vez: el segundo uso del anterior es una reutilización', () => {
    const sesion = rotada();
    sesion.rotarEnGracia('hash-3', segundos(3));
    expect(sesion.hashTokenVigente).toBe('hash-3');
    expect(sesion.graciaUsadaEn).toEqual(segundos(3));
    expect(sesion.clasificarToken('hash-1', segundos(4), GRACIA_MS)).toBe('REUTILIZADO');
  });

  it('el token que la gracia dejó sin efecto es una reutilización (robo dentro de la ventana)', () => {
    const sesion = rotada();
    sesion.rotarEnGracia('hash-3', segundos(3));
    expect(sesion.hashTokenReemplazado).toBe('hash-2');
    expect(sesion.clasificarToken('hash-2', segundos(4), GRACIA_MS)).toBe('REUTILIZADO');
    expect(sesion.clasificarToken('hash-3', segundos(4), GRACIA_MS)).toBe('VIGENTE');
  });

  it('la gracia no extiende la ventana: se cuenta desde la rotación', () => {
    const sesion = rotada();
    sesion.rotarEnGracia('hash-3', segundos(8));
    expect(sesion.rotadaEn).toEqual(ROTACION);
  });

  it('una rotación normal reinicia la gracia para el nuevo token anterior', () => {
    const sesion = rotada();
    sesion.rotarEnGracia('hash-3', segundos(3));
    sesion.rotar('hash-4', segundos(60));
    expect(sesion.graciaUsadaEn).toBeNull();
    expect(sesion.hashTokenReemplazado).toBeNull();
    expect(sesion.clasificarToken('hash-3', segundos(65), GRACIA_MS)).toBe('GRACIA');
    expect(sesion.clasificarToken('hash-2', segundos(65), GRACIA_MS)).toBe('DESCONOCIDO');
  });

  it('con gracia 0 el anterior es una reutilización de inmediato (comportamiento previo)', () => {
    expect(rotada().clasificarToken('hash-1', ROTACION, 0)).toBe('REUTILIZADO');
  });

  it('no se puede usar la gracia en una sesión que no está vigente', () => {
    const sesion = rotada();
    sesion.revocar(segundos(1));
    expect(() => sesion.rotarEnGracia('hash-3', segundos(2))).toThrow(OperacionNoPermitida);
  });
});

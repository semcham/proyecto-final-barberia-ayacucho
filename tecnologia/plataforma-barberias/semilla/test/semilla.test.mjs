// T010 de 009 · Semilla idempotente por la API pública (FR-019; research R04). Usa una API falsa en memoria: no
// necesita Docker, no toca ninguna base de datos y nunca ve una contraseña real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cargarSemilla, CODIGOS } from '../cargar-semilla.mjs';

const DATOS = JSON.parse(readFileSync(fileURLToPath(new URL('../datos.json', import.meta.url)), 'utf8'));

/** API falsa con el comportamiento mínimo de los contratos de 001 y 002 que usa la semilla. */
class ApiFalsa {
  constructor() {
    this.llamadas = [];
    this.cuentas = new Map(); // correo → { contrasena, rol, barberia, estado, id, nombre }
    this.barberias = new Map(); // slug → { id, nombre, slug, horario, servicios, barberos, usuarios }
    this.citas = new Map(); // id → cita
    this.tokens = new Map(); // token → correo
    this.activaciones = new Map(); // token → correo
    // 010 (T066): el buzón (como Mailpit) y los enlaces de verificación vigentes.
    this.correos = []; // { id, para, texto }, del más viejo al más nuevo
    this.verificaciones = new Map(); // token → correo
    this.siguiente = 1;
  }

  id() {
    return `00000000-0000-4000-8000-${String(this.siguiente++).padStart(12, '0')}`;
  }

  sesion(correo) {
    const token = `t-${this.id()}`;
    this.tokens.set(token, correo);
    const c = this.cuentas.get(correo);
    const b = [...this.barberias.values()].find((x) => x.id === c.barberia);
    return {
      tokenAcceso: token,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        id: c.id,
        nombre: c.nombre,
        correo,
        rol: c.rol,
        barberia: { id: b.id, nombre: b.nombre, slug: b.slug },
        correoVerificado: c.verificado !== false,
      },
    };
  }

  /** Como M05 al enviar: un enlace nuevo de verificación (anula los anteriores) y su correo en el buzón. */
  enviarVerificacion(correo) {
    for (const [token, para] of this.verificaciones) if (para === correo) this.verificaciones.delete(token);
    const token = `v${this.id().replace(/-/g, '')}abcdefghij`;
    this.verificaciones.set(token, correo);
    this.correos.push({
      id: `m${this.correos.length + 1}`,
      para: correo,
      texto: `Verifica tu correo: http://localhost:5173/verificar#${token} (vale 24 horas).`,
    });
  }

  /** El buzón de desarrollo (API HTTP de Mailpit): búsqueda por destinatario, el más nuevo primero. */
  atenderBuzon(ruta, searchParams) {
    if (ruta === '/api/v1/search') {
      const para = (searchParams.get('query') ?? '').replace(/^to:/, '');
      const propios = this.correos.filter((c) => c.para === para).reverse();
      return { estado: 200, cuerpo: { messages: propios.slice(0, 1).map((c) => ({ ID: c.id })) } };
    }
    const mensaje = /^\/api\/v1\/message\/(.+)$/.exec(ruta);
    const correo = mensaje && this.correos.find((c) => c.id === mensaje[1]);
    return correo ? { estado: 200, cuerpo: { Text: correo.texto } } : { estado: 404, cuerpo: {} };
  }

  quien(headers) {
    const token = (headers?.authorization ?? headers?.Authorization ?? '').replace(/^Bearer /, '');
    const correo = this.tokens.get(token);
    if (!correo) return null;
    const cuenta = this.cuentas.get(correo);
    return { correo, cuenta, barberia: [...this.barberias.values()].find((b) => b.id === cuenta.barberia) };
  }

  fetch = async (url, init = {}) => {
    const { host, pathname, searchParams } = new URL(url);
    const deBuzon = host === 'buzon.prueba';
    const ruta = deBuzon ? pathname : pathname.replace(/^\/api\/v1/, '');
    const metodo = (init.method ?? 'GET').toUpperCase();
    const cuerpo = init.body ? JSON.parse(init.body) : undefined;
    if (!deBuzon) this.llamadas.push({ metodo, ruta, cuerpo });
    const r = deBuzon
      ? this.atenderBuzon(ruta, searchParams)
      : this.atender(metodo, ruta, cuerpo, init.headers ?? {}, searchParams);
    return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), {
      status: r.estado,
      headers: { 'content-type': 'application/json' },
    });
  };

  atender(metodo, ruta, cuerpo, headers) {
    const yo = this.quien(headers);
    if (metodo === 'POST' && ruta === '/auth/login') {
      const c = this.cuentas.get(cuerpo.correo);
      if (!c || c.contrasena !== cuerpo.contrasena || c.estado !== 'ACTIVA')
        return { estado: 401, cuerpo: { codigo: 'CREDENCIALES_INVALIDAS' } };
      return { estado: 200, cuerpo: this.sesion(cuerpo.correo) };
    }
    if (metodo === 'POST' && ruta === '/barberias') {
      if (this.cuentas.has(cuerpo.propietario.correo))
        return { estado: 409, cuerpo: { codigo: 'CORREO_NO_DISPONIBLE' } };
      const slug = cuerpo.nombreBarberia
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const b = {
        id: this.id(),
        nombre: cuerpo.nombreBarberia,
        slug,
        horario: [],
        servicios: [],
        barberos: [],
        usuarios: [],
      };
      this.barberias.set(slug, b);
      this.cuentas.set(cuerpo.propietario.correo, {
        id: this.id(),
        nombre: cuerpo.propietario.nombre,
        contrasena: cuerpo.propietario.contrasena,
        rol: 'PROPIETARIO',
        barberia: b.id,
        estado: 'ACTIVA',
      });
      return {
        estado: 201,
        cuerpo: {
          barberia: { id: b.id, nombre: b.nombre, slug },
          suscripcion: { estado: 'TRIAL' },
          sesion: this.sesion(cuerpo.propietario.correo),
        },
      };
    }
    const publico = /^\/publico\/([^/]+)$/.exec(ruta);
    if (metodo === 'GET' && publico) {
      const b = this.barberias.get(publico[1]);
      return b
        ? {
            estado: 200,
            cuerpo: { barberia: { nombre: b.nombre, slug: b.slug, zonaHoraria: 'America/Lima' } },
          }
        : { estado: 404, cuerpo: {} };
    }
    if (metodo === 'POST' && ruta === '/clientes/registro') {
      if (this.cuentas.has(cuerpo.correo)) return { estado: 409, cuerpo: { codigo: 'CORREO_NO_DISPONIBLE' } };
      const b = this.barberias.get(cuerpo.barberia);
      this.cuentas.set(cuerpo.correo, {
        id: this.id(),
        nombre: cuerpo.nombre,
        contrasena: cuerpo.contrasena,
        rol: 'CLIENTE',
        barberia: b.id,
        estado: 'ACTIVA',
        // 010: la cuenta nueva nace sin verificar y recibe su correo.
        verificado: false,
      });
      this.enviarVerificacion(cuerpo.correo);
      return { estado: 201, cuerpo: this.sesion(cuerpo.correo) };
    }
    if (metodo === 'POST' && ruta === '/auth/activar') {
      const correo = this.activaciones.get(cuerpo.token);
      if (!correo) return { estado: 400, cuerpo: {} };
      Object.assign(this.cuentas.get(correo), { contrasena: cuerpo.contrasena, estado: 'ACTIVA' });
      for (const barberia of this.barberias.values()) {
        const usuario = barberia.usuarios.find((u) => u.correo === correo);
        if (usuario) usuario.estado = 'ACTIVA';
      }
      this.activaciones.delete(cuerpo.token);
      return { estado: 200, cuerpo: {} };
    }
    if (metodo === 'POST' && ruta === '/cuenta/verificacion') {
      const correo = this.verificaciones.get(cuerpo.token);
      if (!correo) return { estado: 410, cuerpo: { codigo: 'ENLACE_NO_VALIDO' } };
      this.verificaciones.delete(cuerpo.token);
      const c = this.cuentas.get(correo);
      c.verificado = true;
      const b = [...this.barberias.values()].find((x) => x.id === c.barberia);
      return { estado: 200, cuerpo: { barberia: b.slug } };
    }
    if (!yo) return { estado: 401, cuerpo: { codigo: 'NO_AUTENTICADO' } };
    if (metodo === 'POST' && ruta === '/cuenta/verificacion/reenvio') {
      if (yo.cuenta.verificado === false) this.enviarVerificacion(yo.correo);
      return {
        estado: 202,
        cuerpo: { mensaje: 'Si tu correo aún no está verificado, te enviamos un enlace nuevo.' },
      };
    }
    const b = yo.barberia;
    if (metodo === 'GET' && ruta === '/barberia/horario')
      return { estado: 200, cuerpo: { tramos: b.horario } };
    if (metodo === 'PUT' && ruta === '/barberia/horario') {
      b.horario = cuerpo.tramos;
      return { estado: 200, cuerpo: { tramos: b.horario } };
    }
    if (metodo === 'GET' && ruta === '/servicios') return { estado: 200, cuerpo: b.servicios };
    if (metodo === 'POST' && ruta === '/servicios') {
      const s = { id: this.id(), activo: true, ...cuerpo };
      b.servicios.push(s);
      return { estado: 201, cuerpo: s };
    }
    if (metodo === 'GET' && ruta === '/usuarios')
      return { estado: 200, cuerpo: { datos: b.usuarios, total: b.usuarios.length } };
    if (metodo === 'POST' && ruta === '/usuarios') {
      const u = {
        id: this.id(),
        nombre: cuerpo.nombre,
        correo: cuerpo.correo,
        rol: cuerpo.rol,
        estado: 'PENDIENTE',
      };
      b.usuarios.push(u);
      this.cuentas.set(cuerpo.correo, { ...u, contrasena: null, barberia: b.id });
      const token = `act-${this.id()}-xxxxxxxxxxxxxxxx`;
      this.activaciones.set(token, cuerpo.correo);
      return {
        estado: 201,
        cuerpo: {
          usuario: u,
          activacion: { enlace: `http://localhost:5173/activar?token=${token}`, venceEn: 'x' },
        },
      };
    }
    if (metodo === 'GET' && ruta === '/barberos') return { estado: 200, cuerpo: b.barberos };
    if (metodo === 'POST' && ruta === '/barberos') {
      const x = {
        id: this.id(),
        activo: true,
        nombre: cuerpo.nombre,
        servicioIds: cuerpo.servicioIds,
        usuarioId: cuerpo.usuarioId ?? null,
        disponibilidad: [],
      };
      b.barberos.push(x);
      return { estado: 201, cuerpo: x };
    }
    const disp = /^\/barberos\/([^/]+)\/disponibilidad$/.exec(ruta);
    if (disp) {
      const x = b.barberos.find((y) => y.id === disp[1]);
      if (metodo === 'PUT') x.disponibilidad = cuerpo.tramos;
      return { estado: 200, cuerpo: { tramos: x.disponibilidad } };
    }
    if (metodo === 'GET' && ruta === '/clientes/yo/citas') {
      const propias = [...this.citas.values()].filter((c) => c.cliente === yo.correo);
      return { estado: 200, cuerpo: { total: propias.length, pagina: 1, tamano: 50, elementos: propias } };
    }
    if (metodo === 'POST' && ruta === '/citas') {
      // 010 (FR-009): sin el correo verificado, el cliente no reserva.
      if (yo.cuenta.rol === 'CLIENTE' && yo.cuenta.verificado === false)
        return { estado: 403, cuerpo: { codigo: 'CORREO_NO_VERIFICADO' } };
      const servicio = b.servicios.find((s) => s.id === cuerpo.servicioId);
      const barbero = b.barberos.find((x) => x.id === cuerpo.barberoId);
      const ocupado = [...this.citas.values()].some(
        (c) => c.barberoId === barbero.id && c.inicio === cuerpo.inicio && c.estado !== 'CANCELADA',
      );
      if (ocupado) return { estado: 409, cuerpo: { codigo: 'HORARIO_NO_DISPONIBLE' } };
      const c = {
        id: this.id(),
        barberia: b.nombre,
        servicio: servicio.nombre,
        barbero: barbero.nombre,
        barberoId: barbero.id,
        inicio: cuerpo.inicio,
        estado: 'CONFIRMADA',
        cliente: yo.correo,
      };
      this.citas.set(c.id, c);
      return { estado: 201, cuerpo: c };
    }
    const cancelar = /^\/citas\/([^/]+)\/cancelar$/.exec(ruta);
    if (metodo === 'POST' && cancelar) {
      const c = this.citas.get(cancelar[1]);
      c.estado = 'CANCELADA';
      return { estado: 200, cuerpo: c };
    }
    return { estado: 404, cuerpo: { codigo: 'NO_ENCONTRADO', ruta } };
  }
}

const HOY = new Date('2026-11-19T15:00:00Z');
const opciones = (api, extra = {}) => ({
  api: 'http://api.prueba/api/v1',
  datos: DATOS,
  fetch: api.fetch,
  hoy: HOY,
  log: () => {},
  buzon: 'http://buzon.prueba',
  esperaBuzonMs: 50,
  ...extra,
});
const totalCreadas = (resumen) => Object.values(resumen).reduce((s, t) => s + t.creadas, 0);

test('primera corrida: crea las dos barberías con todo lo de datos.json', async () => {
  const api = new ApiFalsa();
  const r = await cargarSemilla(opciones(api));
  assert.equal(r.codigo, CODIGOS.OK, r.mensaje);
  assert.equal(r.resumen.barberias.creadas, 2);
  const esperado = (campo) => DATOS.barberias.reduce((s, b) => s + b[campo].length, 0);
  assert.equal(r.resumen.servicios.creadas, esperado('servicios'));
  assert.equal(r.resumen.barberos.creadas, esperado('barberos'));
  assert.equal(r.resumen.clientes.creadas, esperado('clientes'));
  assert.equal(r.resumen.citas.creadas, esperado('citas'));
  const canceladas = DATOS.barberias.reduce((s, b) => s + b.citas.filter((c) => c.cancelar).length, 0);
  assert.equal([...api.citas.values()].filter((c) => c.estado === 'CANCELADA').length, canceladas);
  assert.ok(canceladas > 0, 'la semilla incluye citas canceladas');
});

test('segunda corrida: 0 creadas, todo existente y sin llamadas que creen ni cambien contraseñas', async () => {
  const api = new ApiFalsa();
  await cargarSemilla(opciones(api));
  api.llamadas = [];
  const r = await cargarSemilla(opciones(api));
  assert.equal(r.codigo, CODIGOS.OK, r.mensaje);
  assert.equal(totalCreadas(r.resumen), 0);
  assert.ok(r.resumen.barberias.existentes === 2);
  const escrituras = api.llamadas.filter((l) => l.metodo !== 'GET' && l.ruta !== '/auth/login');
  assert.deepEqual(escrituras, [], 'una segunda corrida no escribe nada');
});

test('una barbería cuyo propietario ya existe se salta (inicia sesión en vez de registrarse)', async () => {
  const api = new ApiFalsa();
  await cargarSemilla(opciones(api));
  api.llamadas = [];
  await cargarSemilla(opciones(api));
  assert.equal(api.llamadas.filter((l) => l.ruta === '/barberias').length, 0);
});

test('un correo de cliente ya registrado inicia sesión en vez de registrarse', async () => {
  const api = new ApiFalsa();
  await cargarSemilla(opciones(api));
  api.llamadas = [];
  await cargarSemilla(opciones(api));
  assert.equal(api.llamadas.filter((l) => l.ruta === '/clientes/registro').length, 0);
  const logins = api.llamadas.filter((l) => l.ruta === '/auth/login' && l.cuerpo.barberia);
  assert.equal(
    logins.length,
    DATOS.barberias.reduce((s, b) => s + b.clientes.length, 0),
  );
});

test('un 409 al reservar cuenta como existente, no como error', async () => {
  const api = new ApiFalsa();
  const original = api.atender.bind(api);
  api.atender = (metodo, ruta, ...resto) =>
    metodo === 'POST' && ruta === '/citas'
      ? { estado: 409, cuerpo: { codigo: 'HORARIO_NO_DISPONIBLE' } }
      : original(metodo, ruta, ...resto);
  const r = await cargarSemilla(opciones(api));
  assert.equal(r.codigo, CODIGOS.OK, r.mensaje);
  assert.equal(r.resumen.citas.creadas, 0);
  assert.equal(
    r.resumen.citas.existentes,
    DATOS.barberias.reduce((s, b) => s + b.citas.length, 0),
  );
});

test('--reiniciar-contrasenas en el modo local termina con código 3 sin llamar a la API', async () => {
  const api = new ApiFalsa();
  const r = await cargarSemilla(opciones(api, { reiniciarContrasenas: true }));
  assert.equal(r.codigo, 3);
  assert.equal(CODIGOS.REINICIO_RECHAZADO, 3);
  assert.equal(api.llamadas.length, 0);
});

test('la carga nunca llama a una ruta que cambie contraseñas de cuentas existentes', async () => {
  const api = new ApiFalsa();
  await cargarSemilla(opciones(api));
  await cargarSemilla(opciones(api));
  const rutas = api.llamadas.map((l) => l.ruta);
  assert.ok(!rutas.some((r) => /contrasena|password|recuperar|restablecer/i.test(r)));
  // /auth/activar solo se usa para activar a un barbero recién creado (pendiente), una vez por cuenta.
  const activaciones = api.llamadas.filter((l) => l.ruta === '/auth/activar').length;
  const conUsuario = DATOS.barberias.reduce((s, b) => s + b.barberos.filter((x) => x.usuario).length, 0);
  assert.equal(activaciones, conUsuario);
});

test('datos.json: solo datos inventados, sin administrador, dos barberías y los conteos del modelo', () => {
  assert.equal(DATOS.barberias.length, 2);
  const correos = [];
  const telefonos = [];
  for (const b of DATOS.barberias) {
    correos.push(b.propietario.correo);
    for (const x of b.barberos) if (x.usuario) correos.push(x.usuario.correo);
    for (const c of b.clientes) {
      correos.push(c.correo);
      telefonos.push(c.telefono);
    }
  }
  for (const c of correos) assert.match(c, /@ejemplo\.test$/, c);
  for (const t of telefonos) assert.match(t, /^\+51 900 000 0\d\d$/, t);
  assert.equal(new Set(correos).size, correos.length, 'correos únicos');
  assert.ok(
    !JSON.stringify(DATOS).match(/administrador|plataforma|admin@/i),
    'sin administrador de la plataforma',
  );
  const [a, b] = DATOS.barberias;
  assert.deepEqual(
    [
      a.slugEsperado,
      a.servicios.length,
      a.barberos.length,
      a.barberos.filter((x) => x.usuario).length,
      a.clientes.length,
      a.citas.length,
    ],
    ['barberia-demo-centro', 4, 3, 1, 6, 12],
  );
  assert.deepEqual(
    [b.slugEsperado, b.servicios.length, b.barberos.length, b.clientes.length, b.citas.length],
    ['barberia-demo-huamanga', 3, 2, 4, 8],
  );
});

// T066 de 010 (research R13): sin el correo verificado el cliente no reserva; la semilla lo verifica con el enlace del
// buzón (como Mailpit) antes de reservar, y una segunda carga no vuelve a hacerlo.
test('verifica a cada cliente con el enlace del buzón antes de su primera reserva', async () => {
  const api = new ApiFalsa();
  const r = await cargarSemilla(opciones(api));
  assert.equal(r.codigo, CODIGOS.OK, r.mensaje);
  const clientes = DATOS.barberias.flatMap((b) => b.clientes.map((c) => c.correo));
  for (const correo of clientes) assert.equal(api.cuentas.get(correo).verificado, true, correo);
  const verificaciones = api.llamadas.filter((l) => l.ruta === '/cuenta/verificacion');
  assert.equal(verificaciones.length, clientes.length);
  const primeraReserva = api.llamadas.findIndex((l) => l.ruta === '/citas' && l.metodo === 'POST');
  const ultimaVerificacion = api.llamadas.findLastIndex((l) => l.ruta === '/cuenta/verificacion');
  // En cada barbería, sus clientes se verifican antes de que reserven.
  assert.ok(primeraReserva > api.llamadas.findIndex((l) => l.ruta === '/cuenta/verificacion'));
  assert.ok(ultimaVerificacion > 0);
});

test('segunda corrida: no vuelve a verificar ni pide reenvíos', async () => {
  const api = new ApiFalsa();
  await cargarSemilla(opciones(api));
  api.llamadas = [];
  await cargarSemilla(opciones(api));
  assert.equal(api.llamadas.filter((l) => l.ruta.startsWith('/cuenta/')).length, 0);
});

test('un cliente que quedó sin verificar con un enlace ya inválido: pide el reenvío y usa el nuevo', async () => {
  const api = new ApiFalsa();
  const [cliente] = DATOS.barberias[0].clientes;
  // Una carga anterior lo registró, pero se cortó antes de verificar y su enlace ya no sirve.
  const original = api.atender.bind(api);
  let cortar = true;
  api.atender = (metodo, ruta, cuerpo, ...resto) => {
    const r = original(metodo, ruta, cuerpo, ...resto);
    if (cortar && metodo === 'POST' && ruta === '/clientes/registro' && cuerpo.correo === cliente.correo) {
      api.verificaciones.clear();
      cortar = false;
    }
    return r;
  };
  const r = await cargarSemilla(opciones(api));
  assert.equal(r.codigo, CODIGOS.OK, r.mensaje);
  assert.equal(api.cuentas.get(cliente.correo).verificado, true);
  assert.equal(api.llamadas.filter((l) => l.ruta === '/cuenta/verificacion/reenvio').length, 1);
});

test('si el correo de verificación no llega al buzón, termina con un error claro (sin token en el mensaje)', async () => {
  const api = new ApiFalsa();
  api.enviarVerificacion = () => {};
  const r = await cargarSemilla(opciones(api));
  assert.equal(r.codigo, CODIGOS.ERROR);
  assert.match(r.mensaje, /No llegó al buzón de desarrollo un correo con el enlace de \/verificar/);
});

import { randomBytes } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCita } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { cerrarPools, poolDe } from '../../helpers/test-db';
import { crearEscenario, type Escenario, sesionCliente, tokenPara } from '../../helpers/sesiones';

// T117 · PR10 (EQ-10): entradas mal formadas, demasiado largas o maliciosas se rechazan con un mensaje
// controlado o quedan neutralizadas (se guardan como texto, nunca se ejecutan), y no crean filas.

const TABLAS = [
  'tenant',
  'user_account',
  'membership',
  'subscription',
  'terms_acceptance',
  'account_activation',
];
const correoNuevo = () => `entrada-${randomBytes(4).toString('hex')}@prueba.pe`;
const CLAVE = 'una clave larga y propia';

async function conteos(): Promise<Record<string, number>> {
  const resultado: Record<string, number> = {};
  for (const tabla of TABLAS) {
    resultado[tabla] = (
      await poolDe('seed').query(`SELECT count(*)::int AS total FROM ${tabla}`)
    ).rows[0].total;
  }
  return resultado;
}

function registro(
  cambios: { nombreBarberia?: string; nombre?: string; correo?: string; contrasena?: string } = {},
) {
  return {
    nombreBarberia: cambios.nombreBarberia ?? 'Barbería Válida',
    propietario: {
      nombre: cambios.nombre ?? 'Dueño Válido',
      correo: cambios.correo ?? correoNuevo(),
      contrasena: cambios.contrasena ?? CLAVE,
    },
    aceptaciones: { terminosVersion: '2026-10', politicaDatosVersion: '2026-10' },
  };
}

/** Respuesta de error con el formato del contrato y sin trazas ni detalles internos. */
function esErrorControlado(cuerpo: Record<string, unknown>) {
  expect(Object.keys(cuerpo).sort()).toEqual(['codigo', 'detalles', 'mensaje']);
  expect(JSON.stringify(cuerpo)).not.toMatch(/stack|at \w+ \(|node_modules|SELECT|INSERT|syntax error/i);
}

describe('PR10 · Validación de entradas', () => {
  let prueba: AppDePrueba;
  let escenario: Escenario;

  beforeAll(async () => {
    prueba = await crearApp();
    escenario = await crearEscenario();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('POST /barberias', () => {
    it.each([
      ['caracteres de control en el nombre', registro({ nombreBarberia: 'Barbería\u0000Oculta' })],
      ['salto de línea en el nombre del propietario', registro({ nombre: 'Rosa\nQuispe' })],
      ['nombre de 10 000 caracteres', registro({ nombreBarberia: 'x'.repeat(10_000) })],
      ['contraseña de 10 000 caracteres', registro({ contrasena: 'x'.repeat(10_000) })],
      ['inyección SQL en el correo', registro({ correo: "' OR 1=1 --" })],
      ['script en el correo', registro({ correo: '<script>alert(1)</script>@x.pe' })],
      ['tipo incorrecto (número en lugar de texto)', { ...registro(), nombreBarberia: 12345 }],
      ['objeto anidado en lugar de texto', { ...registro(), nombreBarberia: { $ne: null } }],
    ])('400 VALIDACION sin filas creadas: %s', async (_caso, cuerpo) => {
      const antes = await conteos();
      const respuesta = await prueba.agente.post('/api/v1/barberias').send(cuerpo).expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      esErrorControlado(respuesta.body);
      expect(await conteos()).toEqual(antes);
    });

    it('un nombre con <script> y comillas se guarda como texto literal (neutralizado, no ejecutado)', async () => {
      const nombre = `<script>alert('x')</script> "Barbería"; DROP TABLE tenant;--`;
      const respuesta = await prueba.agente
        .post('/api/v1/barberias')
        .send(registro({ nombreBarberia: nombre }))
        .expect(201);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.body.barberia.nombre).toBe(nombre);
      const { rows } = await poolDe('seed').query('SELECT name FROM tenant WHERE id = $1', [
        respuesta.body.barberia.id,
      ]);
      expect(rows[0].name).toBe(nombre);
      // La tabla sigue existiendo: el texto nunca se interpretó como SQL.
      await poolDe('seed').query('SELECT 1 FROM tenant LIMIT 1');
    });
  });

  describe('POST /auth/login', () => {
    it.each([
      ["' OR '1'='1", "' OR '1'='1"],
      ["admin@x.pe'--", 'cualquiera'],
      ['x'.repeat(10_000), 'cualquiera'],
    ])('correo %# malicioso o enorme → 400 o 401 genérico, nunca 500', async (correo, contrasena) => {
      const respuesta = await prueba.agente
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
        .send({ correo, contrasena });
      expect([400, 401]).toContain(respuesta.status);
      esErrorControlado(respuesta.body);
    });
  });

  describe('POST /usuarios', () => {
    const conPropietario = () => ({ Authorization: `Bearer ${escenario.tokenPropietario}` });

    it.each([
      [
        'inyección SQL en el correo',
        { nombre: 'Luis', correo: "x'); DROP TABLE membership;--@x.pe", rol: 'BARBERO' },
      ],
      [
        'script en el nombre con caracteres de control',
        { nombre: '<script>\u0007</script>', correo: correoNuevo(), rol: 'BARBERO' },
      ],
      ['nombre de 10 000 caracteres', { nombre: 'x'.repeat(10_000), correo: correoNuevo(), rol: 'BARBERO' }],
      ['rol con inyección', { nombre: 'Luis', correo: correoNuevo(), rol: "BARBERO' OR 1=1" }],
    ])('400 VALIDACION sin filas creadas: %s', async (_caso, cuerpo) => {
      const antes = await conteos();
      const respuesta = await prueba.agente
        .post('/api/v1/usuarios')
        .set(conPropietario())
        .send(cuerpo)
        .expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      esErrorControlado(respuesta.body);
      expect(await conteos()).toEqual(antes);
    });

    it('un id que no es UUID en la ruta → 400 VALIDACION', async () => {
      const respuesta = await prueba.agente
        .get("/api/v1/usuarios/1' OR '1'='1")
        .set(conPropietario())
        .expect(400);
      esErrorControlado(respuesta.body);
    });
  });

  // T131 · Funcionalidad 002 (FR-051, EQ-10): todas las rutas nuevas rechazan con 400 VALIDACION, sin
  // ejecutar ni reflejar el contenido y sin crear ni cambiar filas.
  describe('rutas de la funcionalidad 002', () => {
    let e: BarberiaParaReservar;
    let propietario: string;
    let cliente: string;
    let citaDelCliente: string;
    const fecha = fechaEnDias(3);
    const TABLAS_002 = [
      'service',
      'barber',
      'barber_service',
      'business_hours',
      'working_hours',
      'time_off',
      'appointment',
      'appointment_status_history',
      'customer_profile',
      'consent_record',
    ];

    async function datos002(): Promise<Record<string, unknown[]>> {
      const resultado: Record<string, unknown[]> = {};
      for (const tabla of TABLAS_002) resultado[tabla] = await filasDe(tabla, e.barberia.tenantId);
      resultado.tenant = (
        await poolDe('seed').query('SELECT * FROM tenant WHERE id = $1', [e.barberia.tenantId])
      ).rows;
      return resultado;
    }

    beforeAll(async () => {
      e = await barberiaParaReservar();
      propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
      const sesion = await sesionCliente(e.barberia.tenantId);
      cliente = sesion.token;
      citaDelCliente = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        servicioId: e.servicioId,
        clienteId: sesion.cliente.clienteId,
        inicio: new Date(horaLima(fechaEnDias(6), '10:00')),
      });
    });

    type Metodo = 'get' | 'post' | 'patch' | 'put';
    type Quien = 'propietario' | 'cliente' | 'nadie';
    const SCRIPT = '<script>alert(1)</script>';
    const CONTROL = 'Corte\u0000\u0007';
    const casos: [string, Metodo, string, Quien, Record<string, unknown> | undefined][] = [
      // Servicios: textos, montos y duraciones.
      ['servicio con caracteres de control', 'post', '/servicios', 'propietario', { nombre: CONTROL, precio: '10', duracionMinutos: 30 }],
      ['servicio con script y caracteres de control', 'post', '/servicios', 'propietario', { nombre: `${SCRIPT}\u0000`, precio: '10', duracionMinutos: 30 }],
      ['nombre de servicio de 81 caracteres', 'post', '/servicios', 'propietario', { nombre: 'x'.repeat(81), precio: '10', duracionMinutos: 30 }],
      ['descripción de servicio de 10 000 caracteres', 'post', '/servicios', 'propietario', { nombre: 'Largo', descripcion: 'x'.repeat(10_000), precio: '10', duracionMinutos: 30 }],
      ['precio negativo', 'post', '/servicios', 'propietario', { nombre: 'Negativo', precio: '-5', duracionMinutos: 30 }],
      ['precio con 3 decimales', 'post', '/servicios', 'propietario', { nombre: 'Decimales', precio: '10.999', duracionMinutos: 30 }],
      ['precio como número con inyección', 'post', '/servicios', 'propietario', { nombre: 'Inyección', precio: "1; DROP TABLE service;--", duracionMinutos: 30 }],
      ['duración de 0 minutos', 'post', '/servicios', 'propietario', { nombre: 'Cero', precio: '10', duracionMinutos: 0 }],
      ['duración de 999 minutos', 'post', '/servicios', 'propietario', { nombre: 'Eterno', precio: '10', duracionMinutos: 999 }],
      ['duración que no es múltiplo de 5', 'post', '/servicios', 'propietario', { nombre: 'Raro', precio: '10', duracionMinutos: 7 }],
      ['id de servicio que no es UUID', 'patch', "/servicios/1' OR '1'='1", 'propietario', { precio: '10' }],
      ['tenantId en el cuerpo de una ruta con sesión', 'post', '/servicios', 'propietario', { nombre: 'Ajeno', precio: '10', duracionMinutos: 30, tenantId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }],
      // Barberos.
      ['barbero con caracteres de control', 'post', '/barberos', 'propietario', { nombre: CONTROL, servicioIds: [] }],
      ['barbero con servicio que no es UUID', 'post', '/barberos', 'propietario', { nombre: 'Pedro', servicioIds: [SCRIPT] }],
      ['barbero con 51 servicios', 'post', '/barberos', 'propietario', { nombre: 'Pedro', servicioIds: Array.from({ length: 51 }, () => '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b') }],
      ['tenant_id en el cuerpo', 'post', '/barberos', 'propietario', { nombre: 'Pedro', servicioIds: [], tenant_id: 'x' }],
      // Barbería y horario.
      ['descripción de 501 caracteres', 'patch', '/barberia', 'propietario', { descripcion: 'x'.repeat(501) }],
      ['dirección con caracteres de control', 'patch', '/barberia', 'propietario', { direccion: 'Jr. Lima\u0000 120' }],
      ['teléfono con script', 'patch', '/barberia', 'propietario', { telefono: SCRIPT }],
      ['enlace con script', 'patch', '/barberia', 'propietario', { slug: SCRIPT }],
      ['barberiaId en el cuerpo', 'patch', '/barberia', 'propietario', { nombre: 'Otra', barberiaId: 'x' }],
      ['hora imposible en el horario', 'put', '/barberia/horario', 'propietario', { tramos: [{ diaSemana: 1, inicio: '25:00', fin: '26:00' }] }],
      ['día de la semana fuera de rango', 'put', '/barberia/horario', 'propietario', { tramos: [{ diaSemana: 9, inicio: '09:00', fin: '13:00' }] }],
      ['29 tramos', 'put', '/barberia/horario', 'propietario', { tramos: Array.from({ length: 29 }, (_, i) => ({ diaSemana: i % 7, inicio: '09:00', fin: '10:00' })) }],
      // Bloqueos.
      ['bloqueo con fecha imposible', 'post', '/barberos/{barbero}/bloqueos', 'propietario', { inicio: '2026-02-30T10:00:00-05:00', fin: '2026-02-30T11:00:00-05:00' }],
      ['bloqueo con fecha mal formada', 'post', '/barberos/{barbero}/bloqueos', 'propietario', { inicio: 'mañana', fin: 'pasado' }],
      ['motivo de 201 caracteres', 'post', '/barberos/{barbero}/bloqueos', 'propietario', { inicio: horaLima(fecha, '10:00'), fin: horaLima(fecha, '11:00'), motivo: 'x'.repeat(201) }],
      ['motivo con caracteres de control', 'post', '/barberos/{barbero}/bloqueos', 'propietario', { inicio: horaLima(fecha, '10:00'), fin: horaLima(fecha, '11:00'), motivo: 'Trámite\u0000' }],
      ['disponibilidad con hora imposible', 'put', '/barberos/{barbero}/disponibilidad', 'propietario', { tramos: [{ diaSemana: 1, inicio: '09:00', fin: '24:30' }] }],
      // Horarios y citas.
      ['horarios con fecha imposible', 'get', `/horarios?servicio={servicio}&fecha=2026-13-01`, 'cliente', undefined],
      ['horarios con servicio que no es UUID', 'get', `/horarios?servicio=${encodeURIComponent(SCRIPT)}&fecha=${fecha}`, 'cliente', undefined],
      ['horarios públicos con fecha imposible', 'get', `/publico/{slug}/horarios?servicio={servicio}&fecha=2026-02-30`, 'nadie', undefined],
      ['cita con inicio mal formado', 'post', '/citas', 'cliente', { servicioId: '{servicio}', barberoId: '{barbero}', inicio: '20/10/2026 10:00' }],
      ['cita con servicio que no es UUID', 'post', '/citas', 'cliente', { servicioId: SCRIPT, barberoId: '{barbero}', inicio: horaLima(fecha, '10:00') }],
      ['cita con barberiaId en el cuerpo', 'post', '/citas', 'cliente', { servicioId: '{servicio}', barberoId: '{barbero}', inicio: horaLima(fecha, '10:00'), barberiaId: 'x' }],
      ['cancelación con motivo de 201 caracteres', 'post', '/citas/{cita}/cancelar', 'cliente', { motivo: 'x'.repeat(201) }],
      ['cancelación con motivo con caracteres de control', 'post', '/citas/{cita}/cancelar', 'cliente', { motivo: 'No voy\u0000' }],
      ['estado con script', 'post', '/citas/{cita}/estado', 'propietario', { estado: SCRIPT }],
      ['agenda con fecha imposible', 'get', '/agenda?fecha=2026-02-30', 'propietario', undefined],
      ['agenda con barbero que no es UUID', 'get', `/agenda?fecha=${fecha}&barbero=1%27%20OR%201%3D1`, 'propietario', undefined],
      // Clientes.
      ['búsqueda de 61 caracteres', 'get', `/clientes?buscar=${'x'.repeat(61)}`, 'propietario', undefined],
      ['búsqueda con caracteres de control', 'get', '/clientes?buscar=ana%00', 'propietario', undefined],
      ['cliente presencial con caracteres de control', 'post', '/clientes', 'propietario', { nombre: CONTROL, telefono: '966111222', consentimientoVerbal: true, versionPoliticaDatos: '2026-10' }],
      ['cliente presencial con teléfono con script', 'post', '/clientes', 'propietario', { nombre: 'Ana', telefono: SCRIPT, consentimientoVerbal: true, versionPoliticaDatos: '2026-10' }],
      ['cliente presencial con correo inyectado', 'post', '/clientes', 'propietario', { nombre: 'Ana', telefono: '966111222', correo: "' OR 1=1 --", consentimientoVerbal: true, versionPoliticaDatos: '2026-10' }],
      ['registro de cliente con nombre de 10 000 caracteres', 'post', '/clientes/registro', 'nadie', { barberia: '{slug}', nombre: 'x'.repeat(10_000), correo: correoNuevo(), telefono: '966111222', contrasena: CLAVE, aceptaPoliticaDatos: true, versionPoliticaDatos: '2026-10' }],
      ['historial con tamaño negativo', 'get', '/clientes/yo/citas?tamano=-1', 'cliente', undefined],
    ]; // prettier-ignore

    const sustituir = (texto: string) =>
      texto
        .replace('{servicio}', e.servicioId)
        .replace('{barbero}', e.barberoId)
        .replace('{cita}', citaDelCliente)
        .replace('{slug}', e.barberia.slug);

    it.each(casos)(
      '400 VALIDACION sin filas creadas ni contenido reflejado: %s',
      async (_caso, metodo, ruta, quien, cuerpo) => {
        const antes = await datos002();
        let solicitud = prueba.agente[metodo](`/api/v1${sustituir(ruta)}`);
        if (quien !== 'nadie')
          solicitud = solicitud.set(
            'Authorization',
            `Bearer ${quien === 'propietario' ? propietario : cliente}`,
          );
        if (cuerpo) solicitud = solicitud.send(JSON.parse(sustituir(JSON.stringify(cuerpo))));
        const respuesta = await solicitud;

        expect(respuesta.status).toBe(400);
        expect(respuesta.body.codigo).toBe('VALIDACION');
        esErrorControlado(respuesta.body);
        expect(JSON.stringify(respuesta.body)).not.toContain('<script>');
        expect(await datos002()).toEqual(antes);
      },
    );

    it('el encabezado X-Tenant-Id en una ruta con sesión → 400', async () => {
      const respuesta = await prueba.agente
        .get(`/api/v1/agenda?fecha=${fecha}`)
        .set({
          Authorization: `Bearer ${propietario}`,
          'X-Tenant-Id': '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        })
        .expect(400);
      esErrorControlado(respuesta.body);
    });

    it('un nombre de servicio con <script> (sin caracteres de control) se guarda como texto literal', async () => {
      const nombre = `${SCRIPT} "Corte"; DROP TABLE service;--`;
      const respuesta = await prueba.agente
        .post('/api/v1/servicios')
        .set('Authorization', `Bearer ${propietario}`)
        .send({ nombre, precio: '10', duracionMinutos: 30 })
        .expect(201);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.body.nombre).toBe(nombre);
      await poolDe('seed').query('SELECT 1 FROM service LIMIT 1');
    });
  });

  describe('cuerpo de la solicitud', () => {
    it('más de 16 KB → 413 con mensaje controlado y sin filas creadas', async () => {
      const antes = await conteos();
      const respuesta = await prueba.agente
        .post('/api/v1/barberias')
        .send({ ...registro(), relleno: 'x'.repeat(20 * 1024) })
        .expect(413);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      esErrorControlado(respuesta.body);
      expect(await conteos()).toEqual(antes);
    });

    it('JSON mal formado → 400 con mensaje controlado', async () => {
      const respuesta = await prueba.agente
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"correo": "a@b.pe", "contrasena": ')
        .expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      esErrorControlado(respuesta.body);
    });
  });
});

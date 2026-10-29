import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Publica } from '../../../src/host/solicitud';
import { Configuracion } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia } from '../../helpers/fixtures';
import { iniciarNginx, type NginxDePrueba } from '../../helpers/nginx';
import {
  barberiaParaReservar,
  citasActivasEn,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import { hoyEnLima, numeroOperacion, png } from '../../helpers/comprobantes';
import { barberiaEnPrueba, PLAN_BASICO } from '../../helpers/pagos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T020 · US1 (FR-001, FR-002, FR-005, FR-006, FR-026; SC-007; ADR-030): Nginx con la configuración del
// repositorio delante de dos instancias de la aplicación. Reparto, sesión entre instancias, IP real del
// cliente y PR16 a través del balanceador.
//
// Qué NO está aquí, y por qué (research.md R15, respaldo aplicado el 2026-10-22): las instancias en proceso
// se exponen a Nginx con el túnel SSH de Testcontainers, y con una instancia detenida el túnel no rechaza la
// conexión: la acepta y la deja colgada o la cierra según el momento, y su reenvío emite errores no
// capturados (AggregateError) dentro de Jest. Una réplica caída no se comporta como en Docker Compose o en
// la nube (conexión rechazada al instante), y el resultado dependía del azar (0 % y 50 % de errores en dos
// corridas iguales). Por eso la caída de una réplica con tráfico (PR04, SC-002) y el 503 sin réplicas
// (FR-007) se verifican con el entorno real de Docker Compose (T028, quickstart.md §6), donde la medida sí
// es representativa.

jest.setTimeout(300_000);

/** Ruta solo de prueba: la IP que la aplicación usa para límites y auditoría (`req.ip`). */
@Controller('prueba-ip')
class IpDePruebaController {
  @Get()
  @Publica()
  ip(@Req() solicitud: Request) {
    return { ip: solicitud.ip };
  }
}

/**
 * Ruta solo de prueba (T065): `backend-1` corta la conexión a mitad de la solicitud, sin responder (como una
 * réplica que cae mientras atiende); `backend-2` responde. No hace falta detener una instancia, que es lo que
 * el túnel de Testcontainers no reproduce bien (ver arriba).
 */
@Controller('prueba-corte')
class CorteDePruebaController {
  constructor(private readonly configuracion: Configuracion) {}

  @Get()
  @Publica()
  leer(@Req() solicitud: Request, @Res() respuesta: Response) {
    this.responder(solicitud, respuesta);
  }

  @Post()
  @Publica()
  escribir(@Req() solicitud: Request, @Res() respuesta: Response) {
    this.responder(solicitud, respuesta);
  }

  private responder(solicitud: Request, respuesta: Response) {
    if (this.configuracion.instanciaId === 'backend-1') {
      setTimeout(() => solicitud.socket.destroy(), 300);
      return;
    }
    respuesta.json({ instancia: this.configuracion.instanciaId });
  }
}

describe('Balanceador: Nginx delante de dos instancias (US1)', () => {
  let instancias: [AppDePrueba, AppDePrueba];
  let nginx: NginxDePrueba;

  const levantar = (indice: 0 | 1) =>
    crearApp({
      escuchar: true,
      controladoresExtra: [IpDePruebaController, CorteDePruebaController],
      entorno: { INSTANCIA_ID: `backend-${indice + 1}`, PROXIES_CONFIABLES: 'loopback' },
    });

  const porNginx = (ruta: string, init: RequestInit = {}) =>
    fetch(`${nginx.url}/api/v1${ruta}`, { signal: AbortSignal.timeout(5_000), ...init });

  beforeAll(async () => {
    instancias = [await levantar(0), await levantar(1)];
    nginx = await iniciarNginx({
      backends: [instancias[0].puerto as number, instancias[1].puerto as number],
    });
  });

  afterAll(async () => {
    // Primero Nginx: así el túnel no intenta reenviar hacia instancias ya cerradas.
    await nginx?.cerrar();
    await Promise.all(instancias.map((instancia) => instancia.cerrar()));
    await cerrarPools();
  });

  it('reparte las solicitudes entre las dos instancias, con la misma respuesta', async () => {
    const respuestas = await Promise.all(Array.from({ length: 20 }, () => porNginx('/salud')));
    const instanciasVistas = new Set(respuestas.map((r) => r.headers.get('x-instancia')));
    const cuerpos = new Set(await Promise.all(respuestas.map((r) => r.text())));
    expect(respuestas.every((r) => r.status === 200)).toBe(true);
    expect(instanciasVistas).toEqual(new Set(['backend-1', 'backend-2']));
    expect([...cuerpos]).toEqual(['{"estado":"ok"}']);
  });

  it('las respuestas de Nginx no revelan su versión (server_tokens off)', async () => {
    const respuesta = await porNginx('/salud');
    expect(respuesta.headers.get('server') ?? '').not.toMatch(/\d/);
  });

  it('IP real (FR-006): un X-Forwarded-For enviado por el cliente no cambia la IP que ve la aplicación', async () => {
    const sinEncabezado = (await (await porNginx('/prueba-ip')).json()) as { ip: string };
    const falsa = (await (
      await porNginx('/prueba-ip', { headers: { 'X-Forwarded-For': '203.0.113.9' } })
    ).json()) as { ip: string };
    console.info('IP vista por la aplicación a través de Nginx', JSON.stringify({ sinEncabezado, falsa }));
    expect(falsa.ip).not.toContain('203.0.113.9');
    expect(falsa.ip).toBe(sinEncabezado.ip);
    // Y no es la del túnel: es la del cliente, que entrega Nginx.
    expect(falsa.ip).not.toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
  });

  it('la sesión vale en ambas instancias, el cierre en una rige en la otra y los intentos se cuentan juntos', async () => {
    const [a, b] = instancias;
    const barberia = await sembrarBarberia();
    const ingreso = await a.agente
      .post('/api/v1/auth/login')
      .send({ correo: barberia.correo, contrasena: barberia.contrasena })
      .expect(200);
    const token = ingreso.body.tokenAcceso as string;
    await b.agente.get('/api/v1/auth/yo').set('Authorization', `Bearer ${token}`).expect(200);
    await a.agente.post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    await b.agente.get('/api/v1/auth/yo').set('Authorization', `Bearer ${token}`).expect(401);

    const otra = await sembrarBarberia();
    const ip = '203.0.113.77';
    for (let i = 0; i < 5; i += 1) {
      await instancias[i % 2].agente
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ correo: otra.correo, contrasena: 'contrasena-errada' })
        .expect(401);
    }
    for (const instancia of instancias) {
      const bloqueado = await instancia.agente
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ correo: otra.correo, contrasena: otra.contrasena });
      expect(bloqueado.status).toBe(429);
    }
  });

  it('PR16 por Nginx: 200 reservas simultáneas del mismo horario → 1 × 201, 199 × 409, 0 × 5xx (SC-007)', async () => {
    const escenario = await barberiaParaReservar();
    const tokens: string[] = [];
    for (let i = 0; i < 200; i += 20) {
      const tanda = await Promise.all(
        Array.from({ length: 20 }, () => sesionCliente(escenario.barberia.tenantId)),
      );
      tokens.push(...tanda.map((sesion) => sesion.token));
    }
    const fecha = fechaEnDias(4);
    const inicio = horaLima(fecha, '11:00');
    const cuerpo = JSON.stringify({
      servicioId: escenario.servicioId,
      barberoId: escenario.barberoId,
      inicio,
    });
    const respuestas = await Promise.all(
      tokens.map((token) =>
        porNginx('/citas', {
          method: 'POST',
          signal: AbortSignal.timeout(60_000),
          headers: {
            Authorization: `Bearer ${token}`,
            'Idempotency-Key': nuevaClave(),
            'Content-Type': 'application/json',
          },
          body: cuerpo,
        }),
      ),
    );
    const cuerpos = await Promise.all(respuestas.map((r) => r.json() as Promise<{ codigo?: string }>));
    const resumen = {
      e201: respuestas.filter((r) => r.status === 201).length,
      e409: respuestas.filter((r) => r.status === 409).length,
      e5xx: respuestas.filter((r) => r.status >= 500).length,
      otros: respuestas.filter((r) => ![201, 409].includes(r.status) && r.status < 500).length,
      instancias: [...new Set(respuestas.map((r) => r.headers.get('x-instancia')))].sort(),
      codigos409: [...new Set(cuerpos.filter((c) => c.codigo).map((c) => c.codigo))],
    };
    const activas = await citasActivasEn(escenario.barberoId, inicio, horaLima(fecha, '11:30'));
    console.info('PR16 por Nginx', JSON.stringify({ ...resumen, citasActivas: activas }));
    expect(resumen).toEqual({
      e201: 1,
      e409: 199,
      e5xx: 0,
      otros: 0,
      instancias: ['backend-1', 'backend-2'],
      codigos409: ['HORARIO_NO_DISPONIBLE'],
    });
    expect(activas).toBe(1);
  });

  // 003 (US3, R05): el límite del cuerpo sube a 6 MB SOLO en la subida del comprobante; el resto sigue en 16 KB.
  it('límite del cuerpo por Nginx: un comprobante de 4 MB llega; 20 KB en otra ruta y 7 MB en la subida dan 413', async () => {
    const b = await barberiaEnPrueba();
    const iniciado = await instancias[0].agente
      .post('/api/v1/suscripcion/pagos')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ planId: PLAN_BASICO, medio: 'TRANSFERENCIA' })
      .expect(201);
    const ruta = `/suscripcion/pagos/${iniciado.body.pago.id}/comprobante`;
    const formulario = (archivo: Buffer) => {
      const datos = new FormData();
      datos.append('archivo', new Blob([archivo]), 'comprobante.png');
      datos.append('numeroOperacion', numeroOperacion());
      datos.append('fechaTransferencia', hoyEnLima());
      return datos;
    };
    const subir = (archivo: Buffer) =>
      porNginx(ruta, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${b.token}` },
        body: formulario(archivo),
      });

    // Más de 6 MB: lo corta Nginx antes de llegar a la aplicación.
    const grande = await subir(png(7 * 1024 * 1024));
    expect(grande.status).toBe(413);
    // 4 MB: pasa Nginx y la aplicación lo guarda.
    const archivo = png(4 * 1024 * 1024);
    const subida = await subir(archivo);
    expect(subida.status).toBe(201);
    expect(((await subida.json()) as { estado: string }).estado).toBe('EN_REVISION');
    const { rows } = await poolDe('seed').query(
      'SELECT size_bytes FROM payment_receipt WHERE payment_id = $1',
      [iniciado.body.pago.id],
    );
    expect(rows).toEqual([{ size_bytes: archivo.length }]);

    // Cualquier otra ruta, incluso una parecida, sigue con 16 KB.
    for (const otra of ['/citas', `${ruta}-otra`, `/suscripcion/pagos/${iniciado.body.pago.id}`]) {
      const respuesta = await porNginx(otra, {
        method: 'POST',
        headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ relleno: 'x'.repeat(20 * 1024) }),
      });
      expect({ otra, estado: respuesta.status }).toEqual({ otra, estado: 413 });
    }
  });

  // Va al final: los cortes cuentan como fallos de backend-1 para max_fails (3 en 10 s).
  it('réplica que cae a mitad de una solicitud (T065): un GET se reintenta en la otra y da 200; un POST no se reenvía', async () => {
    const lecturas = [];
    for (let i = 0; i < 2; i += 1) lecturas.push(await porNginx('/prueba-corte'));
    for (const lectura of lecturas) {
      expect(lectura.status).toBe(200);
      expect(lectura.headers.get('x-instancia')).toBe('backend-2');
    }

    const escrituras = [];
    for (let i = 0; i < 2; i += 1) {
      const respuesta = await porNginx('/prueba-corte', { method: 'POST' });
      escrituras.push({
        estado: respuesta.status,
        cuerpo: await respuesta.text(),
        instancia: respuesta.headers.get('x-instancia'),
      });
    }
    // Un POST que llegó a backend-1 no se reintenta (proxy_next_upstream sin non_idempotent): 503 propio.
    const atendida = (e: { estado: number }) => e.estado >= 200 && e.estado < 300; // Nest responde 201 a un POST
    const cortadas = escrituras.filter((e) => !atendida(e));
    expect(cortadas.length).toBeGreaterThanOrEqual(1);
    for (const cortada of cortadas) {
      expect(cortada.estado).toBe(503);
      expect(JSON.parse(cortada.cuerpo).codigo).toBe('SERVICIO_NO_DISPONIBLE');
    }
    for (const e of escrituras.filter(atendida)) expect(e.instancia).toBe('backend-2');

    // El registro de Nginx muestra el reintento: la lectura pasó por las dos réplicas.
    const registros = await nginx.registros();
    expect(registros).toMatch(
      /GET \/api\/v1\/prueba-corte .*upstream=[^ ]+:\d+, [^ ]+:\d+ estado_upstream=502, 200/,
    );
  });
});

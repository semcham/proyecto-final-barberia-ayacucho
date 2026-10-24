import { randomUUID } from 'node:crypto';
import { ConsultarHorarios } from '../../../src/modules/catalogo-citas/catalogo/application/consultar-horarios';
import { CatalogoPublicoQuery } from '../../../src/modules/catalogo-citas/catalogo/application/ports/catalogo-publico-query';
import { TenantId } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  sembrarBarbero,
  sembrarBloqueo,
  sembrarCita,
  sembrarCliente,
  sembrarDisponibilidad,
} from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
  SEMANA_COMPLETA,
} from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T066 · Horarios libres (RF11, FR-017): la vía pública y la autenticada calculan lo mismo y reflejan al
// instante los bloqueos y las citas nuevas. Humo de rendimiento de R18.

interface HoraLibre {
  inicio: string;
  barberoIds: string[];
}

describe('Horarios libres', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let tokenCliente: string;
  const fecha = fechaEnDias(5);

  const publicos = (consulta = `servicio=${e.servicioId}&fecha=${fecha}`) =>
    prueba.agente.get(`/api/v1/publico/${e.barberia.slug}/horarios?${consulta}`).expect(200);
  const iniciosDe = (horas: HoraLibre[], barberoId: string) =>
    horas.filter((h) => h.barberoIds.includes(barberoId)).map((h) => h.inicio);

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    tokenCliente = (await sesionCliente(e.barberia.tenantId)).token;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('la respuesta trae fecha, zonaHoraria, calculadoEn y por hora los barberos libres', async () => {
    const { body } = await publicos();
    expect(body).toMatchObject({ fecha, zonaHoraria: 'America/Lima', servicioId: e.servicioId });
    expect(Number.isNaN(Date.parse(body.calculadoEn))).toBe(false);
    expect(body.calculadoEn).toMatch(/-05:00$/);
    // 09:00 a 19:00 con un servicio de 30 min: inicios de 09:00 a 18:30 cada 15 min, con los dos barberos.
    expect(body.horas).toHaveLength(39);
    expect(body.horas[0]).toEqual({
      inicio: horaLima(fecha, '09:00'),
      barberoIds: expect.arrayContaining([e.barberoId, e.otroBarberoId]),
    });
    expect(body.horas.at(-1).inicio).toBe(horaLima(fecha, '18:30'));
  });

  it('un bloqueo nuevo y una cita nueva desaparecen de los horarios en la consulta siguiente (FR-017)', async () => {
    const antes: HoraLibre[] = (await publicos()).body.horas;
    expect(iniciosDe(antes, e.barberoId)).toEqual(
      expect.arrayContaining([horaLima(fecha, '14:00'), horaLima(fecha, '15:00')]),
    );

    await sembrarBloqueo({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      inicio: new Date(horaLima(fecha, '14:00')),
      fin: new Date(horaLima(fecha, '14:30')),
    });
    await prueba.agente
      .post('/api/v1/citas')
      .set({ Authorization: `Bearer ${tokenCliente}`, 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fecha, '15:00') })
      .expect(201);

    const despues: HoraLibre[] = (await publicos()).body.horas;
    const delBarbero = iniciosDe(despues, e.barberoId);
    for (const ocupada of ['13:45', '14:00', '14:15', '14:45', '15:00', '15:15']) {
      expect(delBarbero).not.toContain(horaLima(fecha, ocupada));
    }
    expect(delBarbero).toContain(horaLima(fecha, '14:30'));
    expect(delBarbero).toContain(horaLima(fecha, '15:30'));
    // El otro barbero sigue libre a esas horas.
    expect(iniciosDe(despues, e.otroBarberoId)).toContain(horaLima(fecha, '14:00'));
  });

  it('GET /horarios con el token de un cliente da el mismo resultado que la vía pública', async () => {
    for (const consulta of [
      `servicio=${e.servicioId}&fecha=${fecha}`,
      `servicio=${e.servicioId}&fecha=${fecha}&barbero=${e.otroBarberoId}`,
      `servicio=${e.servicioId}&fecha=${fechaEnDias(40)}`,
    ]) {
      const publico = await publicos(consulta);
      const autenticado = await prueba.agente
        .get(`/api/v1/horarios?${consulta}`)
        .set({ Authorization: `Bearer ${tokenCliente}` })
        .expect(200);
      // calculadoEn es el instante de cada cálculo: lo único que puede variar.
      expect({ ...autenticado.body, calculadoEn: null }).toEqual({ ...publico.body, calculadoEn: null });
    }
  });

  it('fuera del horizonte, en el pasado o con un servicio de otra barbería no hay horarios', async () => {
    expect((await publicos(`servicio=${e.servicioId}&fecha=${fechaEnDias(40)}`)).body.horas).toEqual([]);
    expect((await publicos(`servicio=${e.servicioId}&fecha=${fechaEnDias(-1)}`)).body.horas).toEqual([]);
    const otra = await barberiaParaReservar();
    expect((await publicos(`servicio=${otra.servicioId}&fecha=${fecha}`)).body.horas).toEqual([]);
  });

  it('006 (T035): la fuente con el catálogo en caché y la fuente completa dan los mismos horarios', async () => {
    const g = await barberiaParaReservar();
    const dia = fechaEnDias(7);
    const tenantId = TenantId.de(g.barberia.tenantId);
    // Un barbero sin el servicio, uno con disponibilidad parcial, un bloqueo y una cita.
    await sembrarBarbero({ tenantId: g.barberia.tenantId, nombre: 'Beto', servicios: [] });
    const { barberoId: parcial } = await sembrarBarbero({
      tenantId: g.barberia.tenantId,
      nombre: 'Carla',
      servicios: [g.servicioId],
    });
    await sembrarDisponibilidad(
      g.barberia.tenantId,
      parcial,
      SEMANA_COMPLETA.map((t) => ({ ...t, inicio: '13:00', fin: '17:00' })),
    );
    await sembrarBloqueo({
      tenantId: g.barberia.tenantId,
      barberoId: g.barberoId,
      inicio: new Date(horaLima(dia, '10:00')),
      fin: new Date(horaLima(dia, '11:15')),
    });
    const cliente = await sembrarCliente({ tenantId: g.barberia.tenantId });
    await sembrarCita({
      tenantId: g.barberia.tenantId,
      barberoId: g.barberoId,
      servicioId: g.servicioId,
      clienteId: cliente.clienteId,
      inicio: new Date(horaLima(dia, '16:00')),
    });

    const consulta = prueba.app.get(CatalogoPublicoQuery);
    const consultar = prueba.app.get(ConsultarHorarios);
    const catalogo = await consulta.catalogo(tenantId);
    for (const barberoId of [undefined, g.barberoId, parcial]) {
      for (const servicioId of [g.servicioId, randomUUID()]) {
        const pedido = { servicioId, fecha: dia, barberoId };
        const conCache = await consultar.ejecutar(
          consulta.fuenteDelDia(tenantId, catalogo),
          'America/Lima',
          pedido,
        );
        const completa = await consultar.ejecutar(consulta.fuenteCompleta(tenantId), 'America/Lima', pedido);
        expect(conCache.horas).toEqual(completa.horas);
        if (servicioId === g.servicioId) expect(completa.horas.length).toBeGreaterThan(0);
      }
    }
  });

  it('humo de rendimiento: un día con 5 barberos y 60 citas se calcula en menos de 200 ms', async () => {
    const f = await barberiaParaReservar();
    const barberos = [f.barberoId, f.otroBarberoId];
    for (let i = 0; i < 3; i += 1) {
      const { barberoId } = await sembrarBarbero({
        tenantId: f.barberia.tenantId,
        servicios: [f.servicioId],
      });
      await sembrarDisponibilidad(f.barberia.tenantId, barberoId, SEMANA_COMPLETA);
      barberos.push(barberoId);
    }
    const dia = fechaEnDias(6);
    // 12 citas de 30 min por barbero, de 09:00 a 15:00.
    for (const barberoId of barberos) {
      for (let j = 0; j < 12; j += 1) {
        const cliente = await sembrarCliente({ tenantId: f.barberia.tenantId, conCuenta: false });
        const minutos = 9 * 60 + j * 30;
        const hora = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
        await sembrarCita({
          tenantId: f.barberia.tenantId,
          barberoId,
          servicioId: f.servicioId,
          clienteId: cliente.clienteId,
          inicio: new Date(horaLima(dia, hora)),
        });
      }
    }
    const ruta = `/api/v1/publico/${f.barberia.slug}/horarios?servicio=${f.servicioId}&fecha=${dia}`;
    await prueba.agente.get(ruta).expect(200); // calentamiento (conexiones y planes)
    const tiempos: number[] = [];
    let horas: HoraLibre[] = [];
    for (let i = 0; i < 5; i += 1) {
      const inicio = performance.now();
      horas = (await prueba.agente.get(ruta).expect(200)).body.horas;
      tiempos.push(performance.now() - inicio);
    }
    tiempos.sort((x, y) => x - y);
    expect(horas[0].inicio).toBe(horaLima(dia, '15:00'));
    expect(horas[0].barberoIds).toHaveLength(5);
    expect(tiempos[2]).toBeLessThan(200); // mediana
  });
});

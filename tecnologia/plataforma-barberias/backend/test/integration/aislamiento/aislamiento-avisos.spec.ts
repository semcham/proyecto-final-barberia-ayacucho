import { KyselyUnitOfWork } from '../../../src/shared';
import { CitaRepository } from '../../../src/modules/catalogo-citas/citas/application/ports/cita-repository';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { citaConEnlaces, emitirEnlace, filaDeCita, ipUnica, solicitudDeEnlace } from '../../helpers/enlaces';
import { barberiaParaReservar } from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T082 · Aislamiento de los enlaces (PR09; FR-027, FR-034; SC-011; constitución 1.4.1, cuarta excepción). La
// barbería sale SOLO del dato firmado del enlace:
// - un enlace firmado para la barbería A con la cita de B se rechaza (con el tenant A, RLS no ve la cita de B);
// - un token alterado se rechaza ANTES de abrir una transacción con barbería: no se lee ningún dato de negocio
//   (solo se anota el rechazo en la tabla técnica action_link_attempt, que no tiene barbería);
// - las rutas de enlaces ignoran el token de sesión aunque llegue, también el de otra barbería.

describe('Aislamiento de los enlaces (T082, PR09)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('un enlace firmado para la barbería A con la cita de B → 410 y la cita de B no cambia', async () => {
    const a = await barberiaParaReservar();
    const b = await barberiaParaReservar();
    const deB = await citaConEnlaces(prueba, b, 300);
    const cruzado = emitirEnlace(prueba, {
      tenantId: a.barberia.tenantId,
      citaId: deB.citaId,
      accion: 'CANCELAR',
      venceEn: deB.inicio,
    });
    const ip = ipUnica();
    expect((await solicitudDeEnlace(prueba, 'consultar', cruzado, ip)).status).toBe(410);
    expect((await solicitudDeEnlace(prueba, 'cancelar', cruzado, ip)).status).toBe(410);
    expect((await filaDeCita(deB.citaId)).status).toBe('CONFIRMADA');
  });

  it('un token alterado se rechaza sin abrir ninguna transacción con barbería ni leer la cita', async () => {
    const a = await barberiaParaReservar();
    const c = await citaConEnlaces(prueba, a, 330);
    const token = c.enlace('CONFIRMAR');
    const alterado = `${token.slice(0, 10)}${token[10] === 'x' ? 'y' : 'x'}${token.slice(11)}`;

    const uow = prueba.app.get(KyselyUnitOfWork);
    const citas = prueba.app.get(CitaRepository);
    const conTenant = jest.spyOn(uow, 'ejecutar');
    const lecturas = [jest.spyOn(citas, 'buscarParaActualizar'), jest.spyOn(citas, 'buscarPorId')];
    try {
      for (const accion of ['consultar', 'confirmar', 'cancelar', 'reprogramar'] as const) {
        const respuesta = await solicitudDeEnlace(prueba, accion, alterado, ipUnica(), {
          inicio: c.inicio.toISOString(),
        });
        expect(respuesta.status).toBe(410);
      }
      expect(conTenant).not.toHaveBeenCalled();
      for (const lectura of lecturas) expect(lectura).not.toHaveBeenCalled();
    } finally {
      conTenant.mockRestore();
      for (const lectura of lecturas) lectura.mockRestore();
    }
    expect((await filaDeCita(c.citaId)).client_confirmed_at).toBeNull();
  });

  it('el token de sesión de otra barbería se ignora: manda solo el enlace', async () => {
    const a = await barberiaParaReservar();
    const b = await barberiaParaReservar();
    const c = await citaConEnlaces(prueba, a, 360);
    const sesionDeB = await tokenPara(b.barberia.tenantId, b.barberia.propietarioId, 'PROPIETARIO');
    const respuesta = await prueba.agente
      .post('/api/v1/enlaces/accion/confirmar')
      .set({
        'X-Enlace-Accion': c.enlace('CONFIRMAR'),
        'X-Forwarded-For': ipUnica(),
        Authorization: `Bearer ${sesionDeB}`,
      })
      .send({});
    expect(respuesta.status).toBe(200);
    expect((await filaDeCita(c.citaId)).client_confirmed_at).not.toBeNull();

    // Y un token de sesión sin enlace no sirve para nada en estas rutas.
    const sinEnlace = await prueba.agente
      .get('/api/v1/enlaces/accion')
      .set({ Authorization: `Bearer ${sesionDeB}`, 'X-Forwarded-For': ipUnica() });
    expect(sinEnlace.status).toBe(410);
  });
});

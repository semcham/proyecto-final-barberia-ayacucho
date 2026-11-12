import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia } from '../../helpers/fixtures';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T103 · Canal de aviso del cliente: GET, PUT y DELETE /clientes/yo/aviso (RF33; PR18; US4-1 a US4-4 y US4-6;
// FR-016 a FR-018). El número de WhatsApp se propone con el teléfono de contacto y es un campo propio (no cambia
// el teléfono); WhatsApp exige aceptar el texto vigente; el retiro deja la fecha y el canal vuelve a correo; cada
// barbería tiene su propio canal y su propio consentimiento.

const RUTA = '/api/v1/clientes/yo/aviso';
const NUMERO = '+51 987 654 321';
const OTRO = '+51 900 111 222';

async function consentimientosDe(tenantId: string, clienteId: string) {
  const { rows } = await poolDe('seed').query(
    `SELECT number, text_version, accepted_at, withdrawn_at FROM whatsapp_consent
      WHERE tenant_id = $1 AND customer_id = $2 ORDER BY accepted_at`,
    [tenantId, clienteId],
  );
  return rows as { number: string; text_version: string; accepted_at: Date; withdrawn_at: Date | null }[];
}

describe('Canal de aviso del cliente (T103, US4)', () => {
  let prueba: AppDePrueba;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const aceptar = (numero = NUMERO) => ({
    canal: 'WHATSAPP',
    numeroWhatsapp: numero,
    aceptaWhatsapp: true,
    versionTexto: '2026-11',
  });

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('GET por defecto: correo, el número propuesto con el teléfono y el texto vigente con la barbería', async () => {
    const barberia = await sembrarBarberia({ nombre: 'Barbería Huamanga' });
    const c = await sesionCliente(barberia.tenantId);
    const { body } = await prueba.agente.get(RUTA).set(como(c.token)).expect(200);
    expect(body).toEqual({
      canal: 'CORREO',
      numeroWhatsapp: null,
      numeroPropuesto: c.cliente.telefono,
      consentimientoVigente: false,
      aceptadoEn: null,
      textoConsentimiento: { version: '2026-11', texto: expect.stringContaining('Barbería Huamanga') },
    });
    expect(body.textoConsentimiento.texto).toMatch(/puedo retirar este permiso/i);
  });

  it('US4-1: elegir WhatsApp aceptando: canal WhatsApp y consentimiento con número, versión y fecha; el teléfono no cambia', async () => {
    const barberia = await sembrarBarberia();
    const c = await sesionCliente(barberia.tenantId);
    const { body } = await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar()).expect(200);
    expect(body).toMatchObject({
      canal: 'WHATSAPP',
      numeroWhatsapp: NUMERO,
      consentimientoVigente: true,
      aceptadoEn: expect.any(String),
    });
    const [consentimiento] = await consentimientosDe(barberia.tenantId, c.cliente.clienteId);
    expect(consentimiento).toMatchObject({ number: NUMERO, text_version: '2026-11', withdrawn_at: null });
    const { rows } = await poolDe('seed').query('SELECT phone FROM customer_profile WHERE id = $1', [
      c.cliente.clienteId,
    ]);
    expect(rows[0].phone).toBe(c.cliente.telefono);
  });

  it('US4-2: elegir WhatsApp sin aceptar → 422 CONSENTIMIENTO_REQUERIDO y el canal sigue siendo el anterior', async () => {
    const barberia = await sembrarBarberia();
    const c = await sesionCliente(barberia.tenantId);
    const sinAceptar = await prueba.agente
      .put(RUTA)
      .set(como(c.token))
      .send({ canal: 'WHATSAPP', numeroWhatsapp: NUMERO })
      .expect(422);
    expect(sinAceptar.body.codigo).toBe('CONSENTIMIENTO_REQUERIDO');
    const otraVersion = await prueba.agente
      .put(RUTA)
      .set(como(c.token))
      .send({ ...aceptar(), versionTexto: '2026-10' })
      .expect(422);
    expect(otraVersion.body.codigo).toBe('CONSENTIMIENTO_REQUERIDO');
    const invalido = await prueba.agente
      .put(RUTA)
      .set(como(c.token))
      .send({ ...aceptar('12-34') })
      .expect(422);
    expect(invalido.body.codigo).toBe('VALIDACION');
    expect((await prueba.agente.get(RUTA).set(como(c.token)).expect(200)).body.canal).toBe('CORREO');
    expect(await consentimientosDe(barberia.tenantId, c.cliente.clienteId)).toEqual([]);
  });

  it('US4-3: retirar el consentimiento deja la fecha y el canal vuelve a correo; volver al correo no retira', async () => {
    const barberia = await sembrarBarberia();
    const c = await sesionCliente(barberia.tenantId);
    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar()).expect(200);

    const alCorreo = await prueba.agente.put(RUTA).set(como(c.token)).send({ canal: 'CORREO' }).expect(200);
    expect(alCorreo.body).toMatchObject({ canal: 'CORREO', consentimientoVigente: true });

    await prueba.agente.delete(`${RUTA}/consentimiento-whatsapp`).set(como(c.token)).expect(204);
    const { body } = await prueba.agente.get(RUTA).set(como(c.token)).expect(200);
    expect(body).toMatchObject({ canal: 'CORREO', consentimientoVigente: false, aceptadoEn: null });
    const [consentimiento] = await consentimientosDe(barberia.tenantId, c.cliente.clienteId);
    expect(consentimiento.withdrawn_at).toBeInstanceOf(Date);
    // Retirar otra vez (o sin consentimiento): 204 igual.
    await prueba.agente.delete(`${RUTA}/consentimiento-whatsapp`).set(como(c.token)).expect(204);
  });

  it('US4-4: cambiar el número exige aceptar de nuevo; al aceptar, el anterior queda retirado', async () => {
    const barberia = await sembrarBarberia();
    const c = await sesionCliente(barberia.tenantId);
    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar()).expect(200);

    await prueba.agente
      .put(RUTA)
      .set(como(c.token))
      .send({ canal: 'WHATSAPP', numeroWhatsapp: OTRO })
      .expect(422);
    expect((await prueba.agente.get(RUTA).set(como(c.token))).body).toMatchObject({
      numeroWhatsapp: NUMERO,
      consentimientoVigente: true,
    });

    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar(OTRO)).expect(200);
    const consentimientos = await consentimientosDe(barberia.tenantId, c.cliente.clienteId);
    expect(consentimientos.map((k) => [k.number, k.withdrawn_at === null])).toEqual([
      [NUMERO, false],
      [OTRO, true],
    ]);
  });

  it('US4-6: con membresía en dos barberías, cada una conserva su propio canal y consentimiento', async () => {
    const a = await sembrarBarberia();
    const b = await sembrarBarberia();
    const enA = await sesionCliente(a.tenantId);
    const enB = await sesionCliente(b.tenantId, { usuarioId: enA.cliente.usuarioId as string });
    await prueba.agente.put(RUTA).set(como(enA.token)).send(aceptar()).expect(200);
    const { body } = await prueba.agente.get(RUTA).set(como(enB.token)).expect(200);
    expect(body).toMatchObject({ canal: 'CORREO', consentimientoVigente: false });
    expect(await consentimientosDe(b.tenantId, enB.cliente.clienteId)).toEqual([]);
  });

  it('campos ajenos en el cuerpo (tenantId) → 400 sin cambios', async () => {
    const barberia = await sembrarBarberia();
    const c = await sesionCliente(barberia.tenantId);
    await prueba.agente
      .put(RUTA)
      .set(como(c.token))
      .send({ ...aceptar(), tenantId: barberia.tenantId })
      .expect(400);
    expect(await consentimientosDe(barberia.tenantId, c.cliente.clienteId)).toEqual([]);
  });
});

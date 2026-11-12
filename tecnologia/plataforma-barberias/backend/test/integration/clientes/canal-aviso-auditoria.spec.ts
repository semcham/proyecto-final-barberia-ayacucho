import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarBarberia } from '../../helpers/fixtures';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T104 · Auditoría del canal de aviso y del consentimiento (FR-035, FR-017, FR-018; data-model §6). En el
// audit_log de la barbería del cliente, con el cliente como actor y SIN el número completo (solo sus dos últimos
// dígitos):
//   cambiar el canal → CANAL_AVISO_CAMBIADO; aceptar → CONSENTIMIENTO_WHATSAPP_ACEPTADO (con la versión del texto);
//   retirar, o cambiar el número (que retira el anterior) → CONSENTIMIENTO_WHATSAPP_RETIRADO.
// Un PUT rechazado (sin aceptar) no deja ninguna entrada.

const RUTA = '/api/v1/clientes/yo/aviso';
const NUMERO = '+51 987 654 321';
const OTRO = '+51 900 111 222';
const ACCIONES = [
  'CANAL_AVISO_CAMBIADO',
  'CONSENTIMIENTO_WHATSAPP_ACEPTADO',
  'CONSENTIMIENTO_WHATSAPP_RETIRADO',
];

describe('Auditoría del canal de aviso (T104)', () => {
  let prueba: AppDePrueba;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const aceptar = (numero = NUMERO) => ({
    canal: 'WHATSAPP',
    numeroWhatsapp: numero,
    aceptaWhatsapp: true,
    versionTexto: '2026-11',
  });

  async function cliente() {
    const barberia = await sembrarBarberia();
    const c = await sesionCliente(barberia.tenantId);
    const entradas = async () =>
      (await filasDe('audit_log', barberia.tenantId)).filter((f) => ACCIONES.includes(f.action as string));
    return { barberia, c, entradas };
  }

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('elegir WhatsApp aceptando: CANAL_AVISO_CAMBIADO y CONSENTIMIENTO_WHATSAPP_ACEPTADO con la versión, sin el número', async () => {
    const { barberia, c, entradas } = await cliente();
    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar()).expect(200);
    const filas = await entradas();
    expect(filas.map((f) => f.action).sort()).toEqual([
      'CANAL_AVISO_CAMBIADO',
      'CONSENTIMIENTO_WHATSAPP_ACEPTADO',
    ]);
    for (const fila of filas) {
      expect(fila).toMatchObject({
        tenant_id: barberia.tenantId,
        actor_id: c.cliente.usuarioId,
        result: 'PERMITIDO',
      });
      expect(String(fila.resource)).toContain(`cliente:${c.cliente.clienteId}`);
      expect(JSON.stringify(fila)).not.toContain('987 654 321');
      expect(JSON.stringify(fila)).not.toContain('987654321');
    }
    const aceptado = filas.find((f) => f.action === 'CONSENTIMIENTO_WHATSAPP_ACEPTADO');
    expect(aceptado?.resource).toContain('version=2026-11');
    expect(aceptado?.resource).toContain('numero=*21');
    expect(filas.find((f) => f.action === 'CANAL_AVISO_CAMBIADO')?.resource).toContain('canal=WHATSAPP');
  });

  it('retirar: CONSENTIMIENTO_WHATSAPP_RETIRADO (y el cambio de canal a correo)', async () => {
    const { c, entradas } = await cliente();
    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar()).expect(200);
    const antes = (await entradas()).length;
    await prueba.agente.delete(`${RUTA}/consentimiento-whatsapp`).set(como(c.token)).expect(204);
    const nuevas = (await entradas()).slice(antes).map((f) => f.action);
    expect(nuevas.sort()).toEqual(['CANAL_AVISO_CAMBIADO', 'CONSENTIMIENTO_WHATSAPP_RETIRADO']);
  });

  it('cambiar el número aceptando: retira el anterior (RETIRADO) y acepta el nuevo (ACEPTADO); el canal no cambió', async () => {
    const { c, entradas } = await cliente();
    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar()).expect(200);
    const antes = (await entradas()).length;
    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar(OTRO)).expect(200);
    const nuevas = (await entradas()).slice(antes);
    expect(nuevas.map((f) => f.action).sort()).toEqual([
      'CONSENTIMIENTO_WHATSAPP_ACEPTADO',
      'CONSENTIMIENTO_WHATSAPP_RETIRADO',
    ]);
    expect(nuevas.find((f) => f.action === 'CONSENTIMIENTO_WHATSAPP_RETIRADO')?.resource).toContain(
      'numero=*21',
    );
    expect(nuevas.find((f) => f.action === 'CONSENTIMIENTO_WHATSAPP_ACEPTADO')?.resource).toContain(
      'numero=*22',
    );
  });

  it('volver al correo deja solo CANAL_AVISO_CAMBIADO', async () => {
    const { c, entradas } = await cliente();
    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar()).expect(200);
    const antes = (await entradas()).length;
    await prueba.agente.put(RUTA).set(como(c.token)).send({ canal: 'CORREO' }).expect(200);
    expect((await entradas()).slice(antes).map((f) => f.action)).toEqual(['CANAL_AVISO_CAMBIADO']);
  });

  it('un PUT rechazado (sin aceptar, o con un número inválido) no deja ninguna entrada', async () => {
    const { c, entradas } = await cliente();
    await prueba.agente
      .put(RUTA)
      .set(como(c.token))
      .send({ canal: 'WHATSAPP', numeroWhatsapp: NUMERO })
      .expect(422);
    await prueba.agente.put(RUTA).set(como(c.token)).send(aceptar('12')).expect(422);
    expect(await entradas()).toEqual([]);
  });
});

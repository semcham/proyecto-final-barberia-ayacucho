import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato011 } from '../helpers/contrato';
import { sembrarBarberia, sembrarUsuario } from '../helpers/fixtures';
import { tokenPara } from '../helpers/sesiones';
import { cerrarPools, poolDe } from '../helpers/test-db';

// T016 de 011 · Contrato (specs/011-carga-masiva-catalogo/contracts/openapi.yaml) de la carga de servicios en lote.

describe('Contrato 011: servicios en lote', () => {
  let prueba: AppDePrueba;
  let propietario: string;
  let barbero: string;
  let tenantId: string;

  const con = (t: string, clave?: string) => ({
    Authorization: `Bearer ${t}`,
    ...(clave ? { 'Idempotency-Key': clave } : {}),
  });
  const sin = (cuerpo: unknown, ruta: string, estado: number) =>
    expect(erroresDeContrato011(ruta, 'post', estado, cuerpo)).toEqual([]);
  const fila = (nombre: string, precio = '25') => ({ nombre, duracionMinutos: 30, precio });

  beforeAll(async () => {
    prueba = await crearApp();
    const b = await sembrarBarberia();
    tenantId = b.tenantId;
    propietario = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    const u = await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    barbero = await tokenPara(b.tenantId, u.usuarioId, 'BARBERO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('POST /servicios/lote/revision: 200 con y sin errores, 400 y 403', async () => {
    const ruta = '/api/v1/servicios/lote/revision';
    const ok = await prueba.agente
      .post(ruta)
      .set(con(propietario))
      .send({ filas: [fila('Corte')] })
      .expect(200);
    sin(ok.body, '/servicios/lote/revision', 200);
    const conErrores = await prueba.agente
      .post(ruta)
      .set(con(propietario))
      .send({ filas: [fila('M', '')] })
      .expect(200);
    sin(conErrores.body, '/servicios/lote/revision', 200);
    expect(conErrores.body.errores.length).toBeGreaterThan(0);
    sin(
      (await prueba.agente.post(ruta).set(con(propietario)).send({ filas: [] }).expect(400)).body,
      '/servicios/lote/revision',
      400,
    );
    sin(
      (
        await prueba.agente
          .post(ruta)
          .set(con(barbero))
          .send({ filas: [fila('Corte')] })
          .expect(403)
      ).body,
      '/servicios/lote/revision',
      403,
    );
  });

  it('POST /servicios/lote: 201, 200 (reintento), 400 (CARGA_INVALIDA y VALIDACION), 403 y 422', async () => {
    const ruta = '/api/v1/servicios/lote';
    const clave = randomUUID();
    const filas = [fila('Corte'), fila('Barba')];
    sin(
      (await prueba.agente.post(ruta).set(con(propietario, clave)).send({ filas }).expect(201)).body,
      '/servicios/lote',
      201,
    );
    sin(
      (await prueba.agente.post(ruta).set(con(propietario, clave)).send({ filas }).expect(200)).body,
      '/servicios/lote',
      200,
    );
    const invalida = await prueba.agente
      .post(ruta)
      .set(con(propietario, randomUUID()))
      .send({ filas: [fila('Cejas', '')] })
      .expect(400);
    expect(invalida.body.codigo).toBe('CARGA_INVALIDA');
    sin(invalida.body, '/servicios/lote', 400);
    sin(
      (
        await prueba.agente
          .post(ruta)
          .set(con(propietario))
          .send({ filas: [fila('Cejas')] })
          .expect(400)
      ).body,
      '/servicios/lote',
      400,
    );
    sin(
      (await prueba.agente.post(ruta).set(con(barbero, randomUUID())).send({ filas }).expect(403)).body,
      '/servicios/lote',
      403,
    );
    const conflicto = await prueba.agente
      .post(ruta)
      .set(con(propietario, clave))
      .send({ filas: [fila('Otra cosa')] })
      .expect(422);
    sin(conflicto.body, '/servicios/lote', 422);
    // Un nombre que ya existe (sembrado aparte, con otras mayúsculas) es un error de su fila. El 409 NOMBRE_DUPLICADO
    // de la carrera real entre dos cargas lo cubre la prueba de concurrencia (US3).
    await poolDe('seed').query(
      `INSERT INTO service (id, tenant_id, name, price, duration_min, active) VALUES ($1, $2, 'Peinado', 10, 30, true)`,
      [randomUUID(), tenantId],
    );
    const repetido = await prueba.agente
      .post(ruta)
      .set(con(propietario, randomUUID()))
      .send({ filas: [fila('peinado')] })
      .expect(400);
    expect(repetido.body.detalles).toEqual([{ fila: 1, campo: 'nombre', problema: 'ya_existe' }]);
  });
});

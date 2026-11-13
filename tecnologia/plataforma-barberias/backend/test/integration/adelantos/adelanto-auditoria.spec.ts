import {
  activarAdelanto,
  archivosDeAdelanto,
  cambiarConfiguracion,
  confirmarAdelanto,
  numeroDeOperacion,
  rechazarPago,
  registrarPago,
  reservar,
  subirQr,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { png } from '../../helpers/comprobantes';
import { filasDe, sembrarUsuario } from '../../helpers/fixtures';
import { barberiaEnPrueba } from '../../helpers/pagos';
import { barberiaParaReservar, fechaEnDias, horaLima } from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T014 de 008 · Auditoría del adelanto (FR-029, research R13). Cada acción deja una entrada en la barbería, con su
// actor y sin datos sensibles: nunca el número de operación, el contenido ni el hash de un archivo, ni el id del
// QR. Las fases siguientes suman aquí sus acciones (pago registrado, confirmado, rechazado, vencido, devuelto y
// resuelto).

async function auditoriaDel(tenantId: string, accion: string) {
  return (await filasDe('audit_log', tenantId)).filter((f) => f.action === accion);
}

describe('Auditoría del adelanto (T014)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('ADELANTO_CONFIGURADO (US1)', () => {
    it('una entrada por cambio guardado (subir el QR, activar, cambiar, desactivar), con la barbería y el actor', async () => {
      const b = await barberiaEnPrueba();
      await subirQr(prueba, b.token, png()).expect(200);
      await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
      }).expect(200);
      await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'PORCENTAJE',
        porcentaje: 20,
        plazoMinutos: 30,
      }).expect(200);
      await cambiarConfiguracion(prueba, b.token, { activo: false }).expect(200);

      const entradas = await auditoriaDel(b.tenantId, 'ADELANTO_CONFIGURADO');
      expect(entradas).toHaveLength(4);
      for (const entrada of entradas) {
        expect(entrada).toMatchObject({
          tenant_id: b.tenantId,
          actor_id: b.propietarioId,
          result: 'PERMITIDO',
          reason: null,
        });
      }
      expect(entradas.map((e) => e.resource)).toEqual([
        'adelanto:QR',
        'adelanto:ACTIVO',
        'adelanto:ACTIVO',
        'adelanto:INACTIVO',
      ]);
    });

    it('sin datos del QR: ni el id del archivo, ni su hash, ni su contenido', async () => {
      const b = await barberiaEnPrueba();
      await subirQr(prueba, b.token, png()).expect(200);
      const [archivo] = await archivosDeAdelanto(b.tenantId);
      const [entrada] = await auditoriaDel(b.tenantId, 'ADELANTO_CONFIGURADO');
      const texto = JSON.stringify(entrada);
      expect(texto).not.toContain(archivo.id as string);
      expect(texto).not.toContain(archivo.sha256 as string);
    });

    it('un cambio rechazado (rango, sin QR o tipo de archivo) no deja entrada', async () => {
      const b = await barberiaEnPrueba();
      await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
      }).expect(422);
      await subirQr(prueba, b.token, Buffer.from('no es una imagen')).expect(422);
      await subirQr(prueba, b.token, png()).expect(200);
      await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 5,
        plazoMinutos: 30,
      }).expect(422);
      expect(await auditoriaDel(b.tenantId, 'ADELANTO_CONFIGURADO')).toHaveLength(1);
    });

    it('un barbero que lo intenta deja ACCESO_DENEGADO_ROL y ninguna configuración', async () => {
      const b = await barberiaEnPrueba();
      const barbero = await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
      const token = await tokenPara(b.tenantId, barbero.usuarioId, 'BARBERO');
      await cambiarConfiguracion(prueba, token, { activo: false }).expect(403);
      expect(await auditoriaDel(b.tenantId, 'ADELANTO_CONFIGURADO')).toEqual([]);
      const denegadas = await auditoriaDel(b.tenantId, 'ACCESO_DENEGADO_ROL');
      expect(denegadas).toHaveLength(1);
      expect(denegadas[0]).toMatchObject({ actor_id: barbero.usuarioId, result: 'DENEGADO' });
    });
  });

  // T026 · Fase 3 (US2): el registro del pago del cliente.
  describe('ADELANTO_PAGO_REGISTRADO (US2)', () => {
    async function citaPendiente() {
      const e = await barberiaParaReservar();
      await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
      const cliente = await sesionCliente(e.barberia.tenantId);
      const { body } = await reservar(prueba, cliente.token, {
        servicioId: e.servicioId,
        barberoId: e.barberoId,
        inicio: horaLima(fechaEnDias(3), '10:00'),
      }).expect(201);
      return { e, cliente, citaId: body.id as string };
    }

    it('una entrada con el cliente como actor y el estado nuevo, sin el número ni la captura', async () => {
      const { e, cliente, citaId } = await citaPendiente();
      const numero = numeroDeOperacion();
      await registrarPago(prueba, cliente.token, citaId, { numero, captura: png() }).expect(201);
      const entradas = await auditoriaDel(e.barberia.tenantId, 'ADELANTO_PAGO_REGISTRADO');
      expect(entradas).toHaveLength(1);
      expect(entradas[0]).toMatchObject({
        tenant_id: e.barberia.tenantId,
        actor_id: cliente.cliente.usuarioId,
        resource: `cita:${citaId};POR_REVISAR`,
        result: 'PERMITIDO',
        reason: null,
      });
      const [captura] = (await archivosDeAdelanto(e.barberia.tenantId)).filter((a) => a.kind === 'CAPTURA');
      const texto = JSON.stringify(entradas[0]);
      expect(texto).not.toContain(numero);
      expect(texto).not.toContain(captura.id as string);
      expect(texto).not.toContain(captura.sha256 as string);
    });

    it('un registro rechazado (número repetido, fuera de formato o segundo registro) no deja entrada', async () => {
      const { e, cliente, citaId } = await citaPendiente();
      await registrarPago(prueba, cliente.token, citaId, { numero: '12' }).expect(422);
      await registrarPago(prueba, cliente.token, citaId).expect(201);
      await registrarPago(prueba, cliente.token, citaId).expect(409);
      expect(await auditoriaDel(e.barberia.tenantId, 'ADELANTO_PAGO_REGISTRADO')).toHaveLength(1);
    });
  });

  // T038 · Fase 4 (US3): confirmar y rechazar, con el propietario como actor.
  describe('ADELANTO_CONFIRMADO y ADELANTO_PAGO_RECHAZADO (US3)', () => {
    async function conPago() {
      const e = await barberiaParaReservar();
      await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
      const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
      const cliente = await sesionCliente(e.barberia.tenantId);
      const { body } = await reservar(prueba, cliente.token, {
        servicioId: e.servicioId,
        barberoId: e.barberoId,
        inicio: horaLima(fechaEnDias(3), '11:00'),
      }).expect(201);
      const numero = numeroDeOperacion();
      await registrarPago(prueba, cliente.token, body.id, { numero }).expect(201);
      return { e, propietario, cliente, citaId: body.id as string, numero };
    }

    it('confirmar deja una entrada con el estado nuevo; confirmar otra vez no deja otra', async () => {
      const { e, propietario, citaId, numero } = await conPago();
      await confirmarAdelanto(prueba, propietario, citaId).expect(200);
      await confirmarAdelanto(prueba, propietario, citaId).expect(200);
      const entradas = await auditoriaDel(e.barberia.tenantId, 'ADELANTO_CONFIRMADO');
      expect(entradas).toHaveLength(1);
      expect(entradas[0]).toMatchObject({
        actor_id: e.barberia.propietarioId,
        resource: `cita:${citaId};CONFIRMADO`,
        result: 'PERMITIDO',
        reason: null,
      });
      expect(JSON.stringify(entradas[0])).not.toContain(numero);
    });

    it('rechazar deja una entrada sin el motivo (queda en el registro de pago, como en 003) ni el número', async () => {
      const { e, propietario, citaId, numero } = await conPago();
      const motivo = 'El monto no coincide con el adelanto';
      await rechazarPago(prueba, propietario, citaId, motivo).expect(200);
      const entradas = await auditoriaDel(e.barberia.tenantId, 'ADELANTO_PAGO_RECHAZADO');
      expect(entradas).toHaveLength(1);
      expect(entradas[0]).toMatchObject({
        actor_id: e.barberia.propietarioId,
        resource: `cita:${citaId};POR_PAGAR`,
        result: 'PERMITIDO',
        reason: null,
      });
      const texto = JSON.stringify(await filasDe('audit_log', e.barberia.tenantId));
      expect(texto).not.toContain(motivo);
      expect(texto).not.toContain(numero);
    });

    it('un rechazo sin motivo o una confirmación sin pago no dejan entrada', async () => {
      const { e, propietario, citaId } = await conPago();
      await rechazarPago(prueba, propietario, citaId).expect(422);
      expect(await auditoriaDel(e.barberia.tenantId, 'ADELANTO_PAGO_RECHAZADO')).toEqual([]);
      expect(await auditoriaDel(e.barberia.tenantId, 'ADELANTO_CONFIRMADO')).toEqual([]);
    });
  });
});

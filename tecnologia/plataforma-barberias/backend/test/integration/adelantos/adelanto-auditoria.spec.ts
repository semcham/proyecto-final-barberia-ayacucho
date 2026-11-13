import { cambiarConfiguracion, archivosDeAdelanto, subirQr } from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { png } from '../../helpers/comprobantes';
import { filasDe, sembrarUsuario } from '../../helpers/fixtures';
import { barberiaEnPrueba } from '../../helpers/pagos';
import { tokenPara } from '../../helpers/sesiones';
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
});

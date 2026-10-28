import { randomUUID } from 'node:crypto';
import { PasarelaSimuladaAdapter } from '../../../src/modules/suscripciones-pagos/pagos/infrastructure/pasarela-simulada.adapter';
import { RelojDelSistema } from '../../../src/shared';
import { firmar } from '../../../simulador-pagos/firma';
import { probarContratoDePasarela } from '../../contract/payment-gateway.contract';
import { decidirEnSimulador, iniciarSimuladorDePrueba } from '../../helpers/simulador';

// T013 · PR20 contra el simulador (siempre, también en CI).

const TIEMPO_LIMITE_MS = 400;

probarContratoDePasarela('simulador por HTTP', async () => {
  const simulador = await iniciarSimuladorDePrueba();
  const secreto = process.env.PAGOS_SECRETO_FIRMA as string;
  const pasarela = new PasarelaSimuladaAdapter(
    {
      urlBase: simulador.url,
      llaveSecreta: process.env.PAGOS_LLAVE_SECRETA as string,
      secretoFirma: secreto,
      tiempoLimiteMs: TIEMPO_LIMITE_MS,
    },
    new RelojDelSistema(),
  );
  return {
    pasarela,
    tiempoLimiteMs: TIEMPO_LIMITE_MS,
    decidir: (referencia, accion) => decidirEnSimulador(simulador, referencia, accion, { notificar: false }),
    notificacionFirmada: ({ referencia, estado, importeCentimos, t }) => {
      const cuerpo = JSON.stringify({
        evento_id: `evt_${randomUUID().replace(/-/g, '')}`,
        tipo: 'pago.actualizado',
        referencia,
        estado,
        importe_centimos: importeCentimos,
        moneda: 'PEN',
        emitido_en: new Date(t * 1000).toISOString(),
      });
      return { cuerpo: Buffer.from(cuerpo), encabezados: { 'x-firma': firmar(secreto, cuerpo, t) } };
    },
    colgar: () => simulador.cambiarModo({ modo: 'colgado' }),
    restaurar: () => simulador.cambiarModo({ modo: 'normal' }),
    cerrar: () => simulador.cerrar(),
  };
});

import { Configuracion, RelojDelSistema } from '../../../src/shared';
import { crearPasarela } from '../../../src/modules/suscripciones-pagos/pagos/infrastructure/fabrica-pasarela';
import { probarContratoDePasarela } from '../../contract/payment-gateway.contract';

// T013 · PR20 contra el ambiente de pruebas del proveedor real (R15). Solo corre con las variables
// PAGOS_SANDBOX_* definidas (fuera de CI: necesitan credenciales de prueba y red externa). Sin ellas se
// salta con un aviso. La decisión del pagador y la firma de prueba dependen del proveedor: cuando exista su
// adaptador, se completan aquí con sus herramientas de prueba.

const VARIABLES = ['PAGOS_SANDBOX_URL_BASE', 'PAGOS_SANDBOX_LLAVE_SECRETA', 'PAGOS_SANDBOX_SECRETO_FIRMA'];
const definidas = VARIABLES.every((v) => Boolean(process.env[v]));

if (!definidas) {
  describe.skip(`PR20 · ambiente de pruebas del proveedor (sin ${VARIABLES.join(', ')}: se salta)`, () => {
    it('requiere credenciales de prueba del proveedor (R15)', () => undefined);
  });
} else {
  probarContratoDePasarela('ambiente de pruebas del proveedor', async () => {
    process.env.PAGOS_PROVEEDOR = 'culqi';
    process.env.PAGOS_URL_BASE = process.env.PAGOS_SANDBOX_URL_BASE;
    process.env.PAGOS_LLAVE_SECRETA = process.env.PAGOS_SANDBOX_LLAVE_SECRETA;
    process.env.PAGOS_SECRETO_FIRMA = process.env.PAGOS_SANDBOX_SECRETO_FIRMA;
    // Hasta que exista el adaptador real, la fábrica falla con "no disponible todavía (R15)": la prueba
    // lo muestra en lugar de pasar en falso.
    const pasarela = crearPasarela(new Configuracion(), new RelojDelSistema());
    const pendiente = () => Promise.reject(new Error('Falta la herramienta de prueba del proveedor'));
    return {
      pasarela,
      tiempoLimiteMs: new Configuracion().pagos.tiempoLimiteMs,
      decidir: pendiente,
      notificacionFirmada: () => {
        throw new Error('Falta la firma de prueba del proveedor');
      },
      colgar: pendiente,
      restaurar: () => Promise.resolve(),
      cerrar: () => Promise.resolve(),
    };
  });
}

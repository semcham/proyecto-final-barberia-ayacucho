import { ProveedorIAFalso } from '../../src/modules/asistente-reportes/asistente/infrastructure/proveedor-ia-falso';
import { probarContratoDeAIProvider } from './ai-provider.contract';

// T005 de 005 · PR20 contra el proveedor falso: sin red ni llave, el de las pruebas y la CI (ADR-027).

probarContratoDeAIProvider('proveedor falso', async () => {
  const proveedor = new ProveedorIAFalso();
  return {
    proveedor,
    hacerLento: () => proveedor.fijarModo({ tipo: 'lento', ms: 5000 }),
    forzarError: () => proveedor.fijarModo({ tipo: 'error', estado: 500 }),
    restaurar: () => proveedor.restaurar(),
  };
});

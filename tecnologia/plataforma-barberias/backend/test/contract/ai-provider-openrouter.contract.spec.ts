import { ProveedorIAOpenRouter } from '../../src/modules/asistente-reportes/asistente/infrastructure/proveedor-ia-openrouter';
import { probarContratoDeAIProvider } from './ai-provider.contract';

// T037 de 005 · PR20 contra OpenRouter REAL (solo desarrollo, ADR-027). Se omite sin IA_OPENROUTER_LLAVE, como
// gateway-sandbox en 003: la CI no tiene llave. Las pruebas no leen el .env: la llave tiene que estar en la consola de
// quien la corre, y la prueba con OpenRouter real es una tarea del responsable (T046).

const llave = process.env.IA_OPENROUTER_LLAVE;
const modelo = process.env.IA_OPENROUTER_MODELO;

if (llave && modelo) {
  probarContratoDeAIProvider('OpenRouter real (desarrollo)', async () => ({
    proveedor: new ProveedorIAOpenRouter({
      llave,
      modelo,
      urlBase: process.env.IA_OPENROUTER_URL_BASE ?? 'https://openrouter.ai/api/v1',
    }),
  }));
} else {
  describe.skip('PR20 · Contrato de AIProvider: OpenRouter real (sin IA_OPENROUTER_LLAVE e IA_OPENROUTER_MODELO)', () => {
    it('se omite sin llave', () => undefined);
  });
}

import { join } from 'node:path';
import { GenericContainer, type StartedTestContainer, TestContainers, Wait } from 'testcontainers';

/**
 * T018 · Nginx para las pruebas de integración de 006 (ADR-030), con **la misma configuración** que Docker
 * Compose: `nginx/nginx.conf` (worker_processes 1) y la plantilla `nginx/templates/default.conf.template`,
 * cuyos `BACKEND_1` y `BACKEND_2` apuntan aquí a dos instancias de la aplicación que corren en este proceso.
 *
 * Las instancias se exponen al contenedor con `TestContainers.exposeHostPorts` (túnel SSH de
 * Testcontainers): Nginx las alcanza en `host.testcontainers.internal:{puerto}` y ellas ven llegar las
 * conexiones desde loopback, de modo que las pruebas usan `PROXIES_CONFIABLES=loopback` (research.md R15).
 */

export const IMAGEN_NGINX = 'nginx:1.27-alpine';

const RAIZ_NGINX = join(__dirname, '..', '..', '..', 'nginx');

export interface NginxDePrueba {
  /** URL base publicada en el equipo, p. ej. `http://localhost:49153`. */
  url: string;
  /** Registros de Nginx (para diagnosticar una prueba fallida). */
  registros(): Promise<string>;
  cerrar(): Promise<void>;
}

export async function iniciarNginx(opciones: { backends: [number, number] }): Promise<NginxDePrueba> {
  const [puerto1, puerto2] = opciones.backends;
  await TestContainers.exposeHostPorts(puerto1, puerto2);
  const contenedor: StartedTestContainer = await new GenericContainer(IMAGEN_NGINX)
    .withCopyFilesToContainer([
      { source: join(RAIZ_NGINX, 'nginx.conf'), target: '/etc/nginx/nginx.conf' },
      {
        source: join(RAIZ_NGINX, 'templates', 'default.conf.template'),
        target: '/etc/nginx/templates/default.conf.template',
      },
    ])
    .withEnvironment({
      BACKEND_1: `host.testcontainers.internal:${puerto1}`,
      BACKEND_2: `host.testcontainers.internal:${puerto2}`,
    })
    .withExposedPorts(80)
    .withWaitStrategy(Wait.forHttp('/nginx-salud', 80).forStatusCode(200))
    .start();
  const url = `http://${contenedor.getHost()}:${contenedor.getMappedPort(80)}`;
  return {
    url,
    async registros() {
      const flujo = await contenedor.logs();
      return new Promise<string>((resolver) => {
        let texto = '';
        flujo.on('data', (parte: Buffer | string) => (texto += parte.toString()));
        setTimeout(() => {
          flujo.destroy();
          resolver(texto);
        }, 300);
      });
    },
    async cerrar() {
      await contenedor.stop();
    },
  };
}

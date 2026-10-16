/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En Docker Compose el backend se llama "backend"; fuera de Docker se puede cambiar con VITE_API_PROXY.
const destinoApi = process.env.VITE_API_PROXY ?? 'http://backend:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: destinoApi, changeOrigin: true } },
    // En Docker sobre Windows o macOS el volumen montado no avisa los cambios de archivos: se sondean.
    watch: process.env.VITE_SONDEO === 'true' ? { usePolling: true, interval: 300 } : undefined,
  },
  build: {
    rollupOptions: {
      output: {
        // Librerías en archivos propios: cambian poco, así el navegador las reutiliza entre despliegues.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'react';
          if (id.includes('@tanstack')) return 'consultas';
          if (/[\\/](zod|react-hook-form|@hookform)[\\/]/.test(id)) return 'formularios';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
    passWithNoTests: true,
    // Las esperas de Testing Library llegan a 5 s (test/setup.ts, pantallas con React.lazy): cada prueba
    // necesita más margen que esos 5 s para no cortarse en equipos o CI cargados.
    testTimeout: 15_000,
  },
});

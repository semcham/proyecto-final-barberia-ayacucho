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
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
    passWithNoTests: true,
  },
});

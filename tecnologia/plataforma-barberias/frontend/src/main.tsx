import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { SesionProvider } from './auth/SesionProvider';
import { RutasApp } from './routes';
import '@fontsource-variable/fraunces/wght.css';
import '@fontsource-variable/inter/wght.css';
import './styles/global.css';

const clienteConsultas = new QueryClient({
  defaultOptions: {
    // Conectividad variable (RC15): reintentos moderados y sin recargar al volver a la pestaña.
    queries: { retry: 2, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

const raiz = document.getElementById('root');
if (!raiz) throw new Error('No se encontró el elemento #root');

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <BrowserRouter>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

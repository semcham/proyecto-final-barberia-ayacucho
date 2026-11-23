import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { VERSION_POLITICA_DATOS, VERSION_TERMINOS } from '../../src/legal';
import { PRIVACIDAD } from '../../src/legal/privacidad';
import { TERMINOS } from '../../src/legal/terminos';
import { RutasApp } from '../../src/routes';

// T007 de 010 · Páginas públicas de los textos legales (US3; FR-024, FR-027): sin sesión, con título, versión, fecha de
// vigencia, marca de borrador e índice de secciones; la de privacidad, con el camino para ejercer los derechos y las
// cookies técnicas.

function renderizar(ruta: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Textos legales (/terminos y /privacidad)', () => {
  it.each([
    ['/terminos', 'Términos y condiciones', VERSION_TERMINOS],
    ['/privacidad', 'Política de privacidad y datos personales', VERSION_POLITICA_DATOS],
  ])(
    '%s se abre sin sesión con su título, versión, fecha y la marca de borrador',
    async (ruta, titulo, version) => {
      indicadorSesion.quitar();
      renderizar(ruta);
      expect(await screen.findByRole('heading', { level: 1, name: titulo })).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`Versión ${version}`))).toBeInTheDocument();
      expect(screen.getByText(/vigente desde/i)).toBeInTheDocument();
      expect(screen.getByText(/borrador pendiente de revisión/i)).toBeInTheDocument();
      // Nunca lleva al ingreso del personal ni pide sesión.
      expect(screen.queryByRole('heading', { name: /ingresa a tu barbería/i })).not.toBeInTheDocument();
    },
  );

  it.each([
    ['/terminos', TERMINOS],
    ['/privacidad', PRIVACIDAD],
  ])('%s tiene un índice que enlaza a cada sección', async (ruta, documento) => {
    indicadorSesion.quitar();
    renderizar(ruta);
    const indice = await screen.findByRole('navigation', { name: /contenido/i });
    const enlaces = within(indice).getAllByRole('link');
    expect(enlaces).toHaveLength(documento.secciones.length);
    for (const seccion of documento.secciones) {
      expect(within(indice).getByRole('link', { name: seccion.titulo })).toHaveAttribute(
        'href',
        `#${seccion.id}`,
      );
      expect(screen.getByRole('heading', { level: 2, name: seccion.titulo })).toHaveAttribute(
        'id',
        seccion.id,
      );
    }
  });

  it('la versión de cada página es la que se acepta en los formularios', () => {
    expect(TERMINOS.version).toBe(VERSION_TERMINOS);
    expect(PRIVACIDAD.version).toBe(VERSION_POLITICA_DATOS);
    // 2026-10 se aceptó sin texto publicado: los textos publicados son una versión nueva (research R10).
    expect(TERMINOS.version).not.toBe('2026-10');
    expect(PRIVACIDAD.version).not.toBe('2026-10');
  });

  it('la política explica cómo ejercer los derechos (Mis datos) y declara las cookies técnicas', async () => {
    indicadorSesion.quitar();
    renderizar('/privacidad');
    await screen.findByRole('heading', { level: 1, name: 'Política de privacidad y datos personales' });
    expect(screen.getByRole('heading', { level: 2, name: /tus derechos/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /mis datos/i })).toHaveAttribute('href', '/mis-datos');
    for (const cookie of ['rt', 'rtp', 'hay_sesion']) {
      expect(screen.getByText(cookie, { selector: 'code' })).toBeInTheDocument();
    }
    expect(screen.getByText(/ley n\.° 29733/i)).toBeInTheDocument();
  });

  it('cada página enlaza a la otra y vuelve al inicio', async () => {
    indicadorSesion.quitar();
    renderizar('/terminos');
    await screen.findByRole('heading', { level: 1, name: 'Términos y condiciones' });
    expect(screen.getByRole('link', { name: /política de privacidad y datos personales/i })).toHaveAttribute(
      'href',
      '/privacidad',
    );
    expect(screen.getByRole('link', { name: /volver al inicio/i })).toHaveAttribute('href', '/');
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { FormularioUnion } from '../../src/pages/publico/Union';
import { RutasApp } from '../../src/routes';

// T008 de 010 · Enlaces a los textos legales desde los 6 lugares (US3; FR-024, FR-025, SC-008): la portada (pie), el
// pie del marco de acceso (ingreso y registro), el registro del propietario, el registro del cliente y la unión a otra
// barbería. Desde un formulario se abren en otra pestaña, avisando a los lectores de pantalla, sin perder lo escrito.

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

/** Un enlace a un texto legal que abre otra pestaña de forma segura y lo anuncia. */
function esEnlaceEnPestanaNueva(enlace: HTMLElement, destino: '/terminos' | '/privacidad') {
  expect(enlace).toHaveAttribute('href', destino);
  expect(enlace).toHaveAttribute('target', '_blank');
  expect(enlace.getAttribute('rel')).toMatch(/noopener/);
  expect(enlace).toHaveTextContent(/se abre en otra pestaña/i);
}

describe('Enlaces a los textos legales', () => {
  it('la portada enlaza a los dos textos en el pie, sin "(en preparación)"', async () => {
    indicadorSesion.quitar();
    renderizar('/');
    const pie = await screen.findByRole('contentinfo');
    expect(within(pie).getByRole('link', { name: /términos y condiciones/i })).toHaveAttribute(
      'href',
      '/terminos',
    );
    expect(within(pie).getByRole('link', { name: /política de privacidad/i })).toHaveAttribute(
      'href',
      '/privacidad',
    );
    expect(screen.queryByText(/en preparación/i)).not.toBeInTheDocument();
  });

  it.each(['/ingresar', '/registro'])('el pie de %s enlaza a los dos textos', async (ruta) => {
    indicadorSesion.quitar();
    renderizar(ruta);
    await screen.findByRole('heading', { level: 1 });
    const legales = screen.getByRole('navigation', { name: /textos legales/i });
    expect(within(legales).getByRole('link', { name: /términos y condiciones/i })).toHaveAttribute(
      'href',
      '/terminos',
    );
    expect(within(legales).getByRole('link', { name: /política de privacidad/i })).toHaveAttribute(
      'href',
      '/privacidad',
    );
  });

  it('en el registro del propietario, las casillas enlazan a cada texto en otra pestaña y conservan lo escrito', async () => {
    indicadorSesion.quitar();
    renderizar('/registro');
    const usuario = userEvent.setup();
    const nombre = await screen.findByLabelText(/nombre de la barbería/i);
    await usuario.type(nombre, 'Barbería Huamanga');

    const aceptaciones = screen.getByRole('group', { name: /aceptaciones/i });
    esEnlaceEnPestanaNueva(within(aceptaciones).getByRole('link', { name: /términos de uso/i }), '/terminos');
    esEnlaceEnPestanaNueva(
      within(aceptaciones).getByRole('link', { name: /política de tratamiento de datos/i }),
      '/privacidad',
    );
    // Las etiquetas de las casillas siguen nombrándolas igual (y siguen sin marcar).
    expect(screen.getByLabelText(/términos de uso/i)).not.toBeChecked();
    expect(screen.getByLabelText(/política de tratamiento de datos/i)).not.toBeChecked();
    // Nada del formulario se pierde: el enlace no navega dentro de la aplicación.
    expect(nombre).toHaveValue('Barbería Huamanga');
  });

  it('en el registro del cliente, la casilla de la política enlaza al texto en otra pestaña', async () => {
    indicadorSesion.quitar();
    renderizar('/b/barberia-huamanga/registro');
    const casilla = await screen.findByLabelText(/política de tratamiento de datos/i);
    expect(casilla).not.toBeChecked();
    esEnlaceEnPestanaNueva(
      screen.getByRole('link', { name: /política de tratamiento de datos/i }),
      '/privacidad',
    );
  });

  it('en la unión a otra barbería, la casilla de la política enlaza al texto en otra pestaña', () => {
    render(
      <MemoryRouter>
        <FormularioUnion
          mensaje="Para reservar aquí, acepta la política de datos."
          alUnirse={async () => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/política de tratamiento de datos/i)).not.toBeChecked();
    esEnlaceEnPestanaNueva(
      screen.getByRole('link', { name: /política de tratamiento de datos/i }),
      '/privacidad',
    );
  });
});

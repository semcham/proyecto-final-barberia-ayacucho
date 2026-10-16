import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Boton, EstadoVacio, EtiquetaEstado, ModalConfirmacion } from '../../src/components/ui';
import { aplicarTema, leerPreferenciaTema } from '../../src/tema';

// Componentes base del sistema de diseño: estados accesibles que las pantallas dan por hechos.

describe('Boton', () => {
  it('mientras carga queda deshabilitado, con aria-busy y el texto de carga', () => {
    render(
      <Boton cargando textoCargando="Guardando…">
        Guardar
      </Boton>,
    );
    const boton = screen.getByRole('button', { name: 'Guardando…' });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ModalConfirmacion', () => {
  function Prueba({ onConfirmar }: { onConfirmar: () => void }) {
    const [abierto, setAbierto] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setAbierto(true)}>
          Desactivar
        </button>
        <ModalConfirmacion
          abierto={abierto}
          onAbiertoCambia={setAbierto}
          titulo="¿Desactivar a Luis?"
          descripcion="Ya no podrá ingresar."
          textoConfirmar="Sí, desactivar"
          onConfirmar={onConfirmar}
        />
      </>
    );
  }

  it('es un alertdialog nombrado, con el foco inicial en Cancelar, y Escape lo cierra sin confirmar', async () => {
    const onConfirmar = vi.fn();
    const persona = userEvent.setup();
    render(<Prueba onConfirmar={onConfirmar} />);
    await persona.click(screen.getByRole('button', { name: 'Desactivar' }));

    const dialogo = await screen.findByRole('alertdialog', { name: '¿Desactivar a Luis?' });
    expect(dialogo).toHaveAccessibleDescription('Ya no podrá ingresar.');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    await persona.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onConfirmar).not.toHaveBeenCalled();
    // Radix devuelve el foco al control que abrió la ventana justo después de desmontarla.
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Desactivar' })).toHaveFocus());
  });

  it('el botón de confirmar ejecuta la acción', async () => {
    const onConfirmar = vi.fn();
    const persona = userEvent.setup();
    render(<Prueba onConfirmar={onConfirmar} />);
    await persona.click(screen.getByRole('button', { name: 'Desactivar' }));
    await persona.click(await screen.findByRole('button', { name: 'Sí, desactivar' }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });
});

describe('EtiquetaEstado y EstadoVacio', () => {
  it('el estado siempre se dice con texto, no solo con color', () => {
    render(
      <>
        <EtiquetaEstado tono="aviso">Pendiente de activar</EtiquetaEstado>
        <EstadoVacio titulo="No hay usuarios con este filtro" />
      </>,
    );
    expect(screen.getByText('Pendiente de activar')).toBeInTheDocument();
    expect(screen.getByText('No hay usuarios con este filtro')).toBeInTheDocument();
  });
});

describe('Tema', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('sin preferencia guardada sigue al sistema; claro y oscuro fijan data-theme', () => {
    expect(leerPreferenciaTema()).toBe('sistema');
    aplicarTema('oscuro');
    expect(document.documentElement.dataset.theme).toBe('dark');
    aplicarTema('claro');
    expect(document.documentElement.dataset.theme).toBe('light');
    aplicarTema('sistema');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

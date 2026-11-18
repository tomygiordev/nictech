import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { expect, it, vi } from 'vitest';
import NotFound from './NotFound';

vi.mock('@/components/layout/Layout', () => ({
  Layout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

it('muestra un 404 de producto visible en español y noindex', async () => {
  render(
    <MemoryRouter initialEntries={['/producto/no-existe']}>
      <HelmetProvider>
        <NotFound product />
      </HelmetProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Producto no encontrado' })).toBeVisible();
  expect(screen.getByText('Error 404')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Ir a la Tienda' })).toHaveAttribute('href', '/tienda');
  await waitFor(() => expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow'));
});

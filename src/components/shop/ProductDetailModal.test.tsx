import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ProductDetailModal } from './ProductDetailModal';

vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/integrations/supabase/types.extensions', () => ({
  storefrontSupabase: { from: () => ({
    select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }),
  }) },
}));
vi.mock('@/components/ui/carousel', () => ({
  Carousel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CarouselContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CarouselItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CarouselNext: () => null,
  CarouselPrevious: () => null,
}));

it('permite navegar y cerrar la galería aunque el modal bloquee el puntero en el body', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  render(<ProductDetailModal isOpen onClose={close} product={{
    id: 'producto-qa', name: 'Producto QA', price: 10000, stock: 2,
    image_url: '/foto1.webp', additional_images: ['/foto2.webp'], description: null,
  }} />);
  await user.click(screen.getByRole('button', { name: 'Ampliar imagen 1 de Producto QA' }));
  expect(document.body).toHaveStyle({ pointerEvents: 'none' });
  await user.click(screen.getByLabelText('Siguiente'));
  expect(screen.getByAltText('Imagen ampliada 2')).toHaveAttribute('src', '/foto2.webp');
  await user.click(screen.getByLabelText('Cerrar', { exact: true }));
  expect(screen.queryByAltText('Imagen ampliada 2')).not.toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
});

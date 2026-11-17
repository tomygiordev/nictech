import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductCard } from './ProductCard';

vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('@/config/storefront-offers', () => ({
  STOREFRONT_INSTALLMENTS: { count: 3, interestFree: true },
}));

describe('cuotas en la tarjeta', () => {
  it('usa el menor precio y el prefijo Desde cuando hay un rango', () => {
    render(<ProductCard id="one" name="Cable" price={100000} stock={2} category="Cables" hasVariants variantPrices={[100000, 120000]} />);
    expect(screen.getByText('Desde 3 cuotas sin interés de $ 33.334')).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductCard } from './ProductCard';

vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }));

describe('precio en la tarjeta', () => {
  const base = { id: 'one', name: 'Cable', price: 1000, stock: 2, category: 'Cables' };
  it('muestra desde el menor precio cuando hay variantes diferentes', () => {
    render(<ProductCard {...base} hasVariants variantPrices={[3499.99, 1000]} />);
    expect(screen.getByText(/Desde \$ 1\.000/)).toBeInTheDocument();
  });
  it('muestra precio unico para variantes iguales y conserva centavos', () => {
    render(<ProductCard {...base} hasVariants variantPrices={[3499.99, 3499.99]} />);
    expect(screen.getByText('$ 3.499,99')).toBeInTheDocument();
    expect(screen.queryByText(/Desde/)).not.toBeInTheDocument();
  });
  it('usa precio padre cuando no hay precios proyectados', () => {
    render(<ProductCard {...base} />);
    expect(screen.getByText('$ 1.000')).toBeInTheDocument();
  });

  it('no muestra precio anterior ni PROMO ni CYBERMONDAY cuando original_price <= price', () => {
    render(
      <ProductCard
        {...base}
        name="Motorola G23"
        price={184900}
        original_price={93390}
        tags={['CYBERMONDAY', 'Garantía']}
      />
    );
    expect(screen.getByText('$ 184.900')).toBeInTheDocument();
    expect(screen.queryByText('$ 93.390')).not.toBeInTheDocument();
    expect(screen.queryByText(/PROMO/)).not.toBeInTheDocument();
    expect(screen.queryByText('CYBERMONDAY')).not.toBeInTheDocument();
    expect(screen.getByText('Garantía')).toBeInTheDocument();
  });

  it('muestra precio anterior tachado, PROMO y tag promocional cuando original_price > price', () => {
    render(
      <ProductCard
        {...base}
        name="Motorola G23"
        price={115900}
        original_price={127500}
        tags={['CYBERMONDAY', 'Garantía']}
      />
    );
    expect(screen.getByText('$ 115.900')).toBeInTheDocument();
    expect(screen.getByText('$ 127.500')).toBeInTheDocument();
    expect(screen.getByText('PROMO')).toBeInTheDocument();
    expect(screen.getByText('CYBERMONDAY')).toBeInTheDocument();
  });

  it('no renderiza badge parpadeante ¡Últimos! aunque el stock sea bajo', () => {
    render(<ProductCard {...base} stock={2} />);
    expect(screen.queryByText('¡Últimos!')).not.toBeInTheDocument();
    expect(screen.getByText('2 disp.')).toBeInTheDocument();
  });

  it('no aplica truncate al precio principal', () => {
    render(<ProductCard {...base} price={184900} />);
    const priceEl = screen.getByText('$ 184.900');
    expect(priceEl.className).not.toContain('truncate');
    expect(priceEl.className).toContain('whitespace-nowrap');
  });

  it('permite seleccionar texto en la tarjeta manteniendo select-none solo en el boton de carrito', () => {
    const { container } = render(<ProductCard {...base} />);
    const rootCard = container.firstElementChild as HTMLElement;
    const addToCartBtn = screen.getByTitle('Añadir a carrito');
    expect(rootCard.className).not.toContain('select-none');
    expect(addToCartBtn.className).toContain('select-none');
  });

  it('muestra badge de garantia para usados y beneficio por transferencia en ARS', () => {
    render(<ProductCard {...base} name="iPhone 13 (Usado)" condition="Usado" price={520000} />);
    expect(screen.getByText('Usado seleccionado · Garantía 90 días')).toBeInTheDocument();
    expect(screen.getByText('10% OFF por transferencia')).toBeInTheDocument();
  });

  it('no muestra badge de usado cuando el producto es nuevo', () => {
    render(<ProductCard {...base} condition="Nuevo" />);
    expect(screen.queryByText('Usado seleccionado · Garantía 90 días')).not.toBeInTheDocument();
  });
});

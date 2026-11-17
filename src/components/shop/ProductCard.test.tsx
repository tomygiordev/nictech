import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProductCard } from './ProductCard';
import { indexPromotionPrices } from '@/lib/promo-pricing';

const mockAddToCart = vi.fn();

vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart: mockAddToCart }) }));

describe('precio en la tarjeta', () => {
  const base = { id: 'one', name: 'Cable', price: 1000, stock: 2, category: 'Cables' };

  beforeEach(() => {
    mockAddToCart.mockClear();
  });
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

  it('con precio ERP y promo activa muestra precio efectivo, tachado, descuento y agrega ese precio al carrito', () => {
    const index = indexPromotionPrices([
      {
        product_id: 'one',
        variant_id: null,
        list_price: 200000,
        effective_price: 150000,
        promotion_id: 'promo-erp-1',
        promotion_ends_at: '2099-12-31T23:59:59.000Z',
      },
    ]);

    render(
      <ProductCard
        {...base}
        name="Samsung A55"
        price={200000}
        promotionIndex={index}
      />
    );

    expect(screen.getByText('$ 150.000')).toBeInTheDocument();
    expect(screen.getByText('$ 200.000')).toHaveClass('line-through');
    expect(screen.getByText('PROMO')).toBeInTheDocument();
    expect(screen.getByText('-25%')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Añadir a carrito'));
    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'one',
        price: 150000,
      })
    );
  });

  it('sin index (null) se ve idéntico a legacy y agrega precio legacy al carrito', () => {
    render(
      <ProductCard
        {...base}
        name="Motorola G23"
        price={115900}
        original_price={127500}
        sale_expires_at="2099-12-31T23:59:59.000Z"
        promotionIndex={null}
      />
    );

    expect(screen.getByText('$ 115.900')).toBeInTheDocument();
    expect(screen.getByText('$ 127.500')).toHaveClass('line-through');
    expect(screen.getByText('PROMO')).toBeInTheDocument();
    expect(screen.getByText('-9%')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Añadir a carrito'));
    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'one',
        price: 115900,
      })
    );
  });

  it('respeta estado legacy si la fila ERP tiene promotion_id null', () => {
    const index = indexPromotionPrices([
      {
        product_id: 'one',
        variant_id: null,
        list_price: 95000,
        effective_price: 95000,
        promotion_id: null,
        promotion_ends_at: null,
      },
    ]);

    render(
      <ProductCard
        {...base}
        price={95000}
        original_price={120000}
        promotionIndex={index}
      />
    );

    expect(screen.getByText('$ 95.000')).toBeInTheDocument();
    expect(screen.getByText('$ 120.000')).toHaveClass('line-through');
    expect(screen.getByText('PROMO')).toBeInTheDocument();
  });

  it('no muestra tachado ni PROMO cuando la promo ERP expiró', () => {
    const index = indexPromotionPrices([
      {
        product_id: 'one',
        variant_id: null,
        list_price: 100000,
        effective_price: 80000,
        promotion_id: 'promo-expired',
        promotion_ends_at: '2020-01-01T00:00:00.000Z',
      },
    ]);

    render(
      <ProductCard
        {...base}
        price={100000}
        promotionIndex={index}
      />
    );

    expect(screen.getByText('$ 80.000')).toBeInTheDocument();
    expect(screen.queryByText('$ 100.000')).not.toBeInTheDocument();
    expect(screen.queryByText('PROMO')).not.toBeInTheDocument();
  });
  it('muestra el fin de una promo válida', () => {
    render(<ProductCard {...base} original_price={1200} sale_expires_at="2099-12-31T23:59:59Z" />);
    expect(screen.getByText(/Promo válida hasta el/)).toBeInTheDocument();
  });

  it('no muestra fin de promo si no hay descuento válido', () => {
    render(<ProductCard {...base} original_price={1000} sale_expires_at="2099-12-31T23:59:59Z" />);
    expect(screen.queryByText(/Promo válida hasta el/)).not.toBeInTheDocument();
  });

  it('no muestra cuotas con la configuración predeterminada', () => {
    render(<ProductCard {...base} />);
    expect(screen.queryByText(/cuotas/i)).not.toBeInTheDocument();
  });

});

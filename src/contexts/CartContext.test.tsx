 
import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartProvider, useCart, CartItem } from './CartContext';

// ---------------------------------------------------------------------------
// Supabase mock — only needed for validateCart()
// ---------------------------------------------------------------------------
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '@/integrations/supabase/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeItem = (overrides: Partial<Omit<CartItem, 'quantity'>> = {}): Omit<CartItem, 'quantity'> => ({
  id: 'prod-1',
  name: 'iPhone 14',
  price: 500,
  maxStock: 5,
  ...overrides,
});

/** Renders a component that exposes every cart action via data-testid buttons/spans. */
const CartHarness = ({
  onAction,
  capture,
}: {
  onAction?: (cart: ReturnType<typeof useCart>) => void;
  capture?: (cart: ReturnType<typeof useCart>) => void;
}) => {
  const cart = useCart();
  capture?.(cart);

  return (
    <div>
      <span data-testid="total-items">{cart.totalItems}</span>
      <span data-testid="total-price">{cart.totalPrice}</span>
      <span data-testid="items">{JSON.stringify(cart.items)}</span>
      <span data-testid="is-validating">{String(cart.isValidating)}</span>
      <button data-testid="add-default" onClick={() => cart.addToCart(makeItem())} />
      <button data-testid="add-variant-red" onClick={() => cart.addToCart(makeItem({ variant: { id: 'var-red', color: 'Rojo' } }))} />
      <button data-testid="add-variant-blue" onClick={() => cart.addToCart(makeItem({ variant: { id: 'var-blue', color: 'Azul' } }))} />
      <button data-testid="remove" onClick={() => cart.removeFromCart('prod-1')} />
      <button data-testid="update-qty-3" onClick={() => cart.updateQuantity('prod-1', 3)} />
      <button data-testid="update-qty-0" onClick={() => cart.updateQuantity('prod-1', 0)} />
      <button data-testid="update-qty-99" onClick={() => cart.updateQuantity('prod-1', 99)} />
      <button data-testid="clear" onClick={() => cart.clearCart()} />
      <button data-testid="validate" onClick={() => cart.validateCart()} />
      {onAction && <button data-testid="custom" onClick={() => onAction(cart)} />}
    </div>
  );
};

const renderCart = (props?: { onAction?: (cart: ReturnType<typeof useCart>) => void }) => {
  let currentCart: ReturnType<typeof useCart> | undefined;
  const result = render(
    <CartProvider>
      <CartHarness {...props} capture={(cart) => { currentCart = cart; }} />
    </CartProvider>,
  );

  return {
    ...result,
    cart: () => {
      if (!currentCart) throw new Error('CartContext is not ready');
      return currentCart;
    },
  };
};

const totalItems = () => screen.getByTestId('total-items').textContent;
const totalPrice = () => screen.getByTestId('total-price').textContent;
const items = () => JSON.parse(screen.getByTestId('items').textContent!);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CartContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('estado inicial', () => {
    it('empieza con el carrito vacío', () => {
      renderCart();
      expect(totalItems()).toBe('0');
      expect(totalPrice()).toBe('0');
      expect(items()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // addToCart
  // -------------------------------------------------------------------------
  describe('addToCart()', () => {
    it('agrega un ítem nuevo con quantity 1', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      expect(totalItems()).toBe('1');
      expect(items()[0].quantity).toBe(1);
    });

    it('incrementa la cantidad si el mismo ítem ya existe', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('add-default'));
      expect(totalItems()).toBe('2');
      expect(items()).toHaveLength(1);
    });

    it('no supera maxStock al incrementar', async () => {
      renderCart();
      // maxStock is 5 — click 10 times
      for (let i = 0; i < 10; i++) {
        await userEvent.click(screen.getByTestId('add-default'));
      }
      expect(totalItems()).toBe('5');
      expect(items()[0].quantity).toBe(5);
    });

    it('trata variantes distintas del mismo producto como ítems separados', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-variant-red'));
      await userEvent.click(screen.getByTestId('add-variant-blue'));
      expect(items()).toHaveLength(2);
      expect(totalItems()).toBe('2');
    });

    it('incrementa solo la variante correcta al agregar la misma variante dos veces', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-variant-red'));
      await userEvent.click(screen.getByTestId('add-variant-red'));
      await userEvent.click(screen.getByTestId('add-variant-blue'));
      const cartItems = items();
      expect(cartItems).toHaveLength(2);
      const red = cartItems.find((i: CartItem) => i.variant?.color === 'Rojo');
      const blue = cartItems.find((i: CartItem) => i.variant?.color === 'Azul');
      expect(red.quantity).toBe(2);
      expect(blue.quantity).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // removeFromCart
  // -------------------------------------------------------------------------
  describe('removeFromCart()', () => {
    it('elimina el ítem del carrito', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('remove'));
      expect(totalItems()).toBe('0');
      expect(items()).toHaveLength(0);
    });

    it('no hace nada si el ítem no existe', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('remove'));
      expect(totalItems()).toBe('0');
    });

    it('elimina solo la variante indicada cuando se pasa variantId', async () => {
      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-variant-red'));
      await userEvent.click(screen.getByTestId('add-variant-blue'));

      act(() => {
        cart().removeFromCart('prod-1', 'var-red');
      });

      expect(items()).toHaveLength(1);
      expect(items()[0].variant?.id).toBe('var-blue');
    });
  });

  // -------------------------------------------------------------------------
  // updateQuantity
  // -------------------------------------------------------------------------
  describe('updateQuantity()', () => {
    it('actualiza la cantidad correctamente', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('update-qty-3'));
      expect(items()[0].quantity).toBe(3);
      expect(totalItems()).toBe('3');
    });

    it('elimina el ítem si la cantidad es 0', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('update-qty-0'));
      expect(totalItems()).toBe('0');
      expect(items()).toHaveLength(0);
    });

    it('no supera maxStock (5)', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('update-qty-99'));
      expect(items()[0].quantity).toBe(5);
    });

    it('actualiza solo la variante indicada cuando se pasa variantId', async () => {
      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-variant-red'));
      await userEvent.click(screen.getByTestId('add-variant-blue'));

      act(() => {
        cart().updateQuantity('prod-1', 3, 'var-red');
      });

      const red = items().find((i: CartItem) => i.variant?.id === 'var-red');
      const blue = items().find((i: CartItem) => i.variant?.id === 'var-blue');
      expect(red.quantity).toBe(3);
      expect(blue.quantity).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // clearCart
  // -------------------------------------------------------------------------
  describe('clearCart()', () => {
    it('vacía el carrito completamente', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('add-variant-red'));
      await userEvent.click(screen.getByTestId('clear'));
      expect(totalItems()).toBe('0');
      expect(items()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // totalItems & totalPrice
  // -------------------------------------------------------------------------
  describe('totalItems y totalPrice', () => {
    it('calcula totalItems sumando todas las cantidades', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));       // qty 1
      await userEvent.click(screen.getByTestId('add-default'));       // qty 2
      await userEvent.click(screen.getByTestId('add-variant-red'));   // qty 1 (separate)
      expect(totalItems()).toBe('3');
    });

    it('calcula totalPrice = sum(price * quantity)', async () => {
      // price = 500 per item
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));     // 500 * 1
      await userEvent.click(screen.getByTestId('add-default'));     // 500 * 2
      await userEvent.click(screen.getByTestId('add-variant-red')); // 500 * 1 (separate item)
      expect(totalPrice()).toBe('1500');
    });
  });

  // -------------------------------------------------------------------------
  // localStorage persistence
  // -------------------------------------------------------------------------
  describe('persistencia en localStorage', () => {
    it('guarda los ítems en localStorage al agregar', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));

      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem('cartItems') ?? '[]');
        expect(saved).toHaveLength(1);
        expect(saved[0].id).toBe('prod-1');
      });
    });

    it('borra cartItems de localStorage al limpiar el carrito', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));

      await waitFor(() => {
        expect(JSON.parse(localStorage.getItem('cartItems') ?? '[]')).toHaveLength(1);
      });

      await userEvent.click(screen.getByTestId('clear'));

      await waitFor(() => {
        expect(JSON.parse(localStorage.getItem('cartItems') ?? '[]')).toHaveLength(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  // validateCart (with Supabase mock)
  // -------------------------------------------------------------------------
  describe('validateCart()', () => {
    it('comparte la misma promesa cuando hay una validación en curso', async () => {
      let resolveQuery: (value: { data: { id: string; stock: number; name: string; price: number }[]; error: null }) => void = () => {};
      const query = new Promise<{ data: { id: string; stock: number; name: string; price: number }[]; error: null }>((resolve) => {
        resolveQuery = resolve;
      });
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue(query) }) }),
      } as unknown as ReturnType<typeof supabase.from>);
      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await act(async () => {
        const first = cart().validateCart();
        const second = cart().validateCart();
        expect(second).toBe(first);
        resolveQuery({ data: [{ id: 'prod-1', stock: 2, name: 'iPhone 14', price: 750 }], error: null });
        expect(await first).toEqual({ removedItems: [], adjustedItems: ['iPhone 14'] });
      });
      expect(items()[0].price).toBe(750);
    });

    it('conserva el precio autoritativo al revalidar una proyección sin cambios', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({
          data: [{ id: 'prod-1', stock: 5, name: 'iPhone 14', price: 500 }], error: null,
        }) }) }),
      } as unknown as ReturnType<typeof supabase.from>);
      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await act(async () => { await cart().validateCart(); });
      act(() => {
        expect(cart().applyAuthoritativePrices([{ product_id: 'prod-1', variant_id: null, unit_price: 450 }])).toBe(true);
      });
      expect(totalPrice()).toBe('450');
      await act(async () => {
        expect(await cart().validateCart()).toEqual({ removedItems: [], adjustedItems: [] });
      });
      expect(totalPrice()).toBe('450');
    });
    const mockFrom = (productData: { id: string; stock: number; name: string }[]) => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: productData, error: null }),
          }),
          in: vi.fn().mockResolvedValue({ data: productData, error: null }),
        }),
      } as unknown as ReturnType<typeof supabase.from>);
    };

    it.each([
      { variantPrice: 3499.99, expected: 3499.99 },
      { variantPrice: null, expected: 1000 },
      { variantPrice: undefined, expected: 1000 },
    ])('revalida precio de variante o usa el padre: $variantPrice', async ({ variantPrice, expected }) => {
      vi.mocked(supabase.from).mockImplementation(((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: table === 'products'
              ? [{ id: 'prod-1', stock: 5, name: 'iPhone 14', price: 1000 }]
              : [{ id: 'var-red', stock: 5, price: variantPrice }], error: null }),
          }),
        }),
      })) as unknown as typeof supabase.from);
      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-variant-red'));
      let result: Awaited<ReturnType<ReturnType<typeof useCart>['validateCart']>> | undefined;
      await act(async () => { result = await cart().validateCart(); });
      expect(result?.adjustedItems).toEqual(['iPhone 14']);
      expect(items()[0].price).toBe(expected);
      expect(Number(totalPrice())).toBe(expected);
    });

    it('no hace nada cuando el carrito está vacío', async () => {
      const { cart } = renderCart();
      await act(async () => {
        await cart().validateCart();
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('elimina ítems sin stock', async () => {
      mockFrom([{ id: 'prod-1', stock: 0, name: 'iPhone 14' }]);
      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-default'));

      await act(async () => {
        await cart().validateCart();
      });

      await waitFor(() => {
        expect(items()).toHaveLength(0);
      });
    });

    it('ajusta la cantidad cuando excede el stock disponible', async () => {
      mockFrom([{ id: 'prod-1', stock: 2, name: 'iPhone 14' }]);
      const { cart } = renderCart();
      // Add 3 items
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('add-default'));
      expect(items()[0].quantity).toBe(3);

      await act(async () => {
        await cart().validateCart();
      });

      await waitFor(() => {
        expect(items()[0].quantity).toBe(2);
      });
    });

    it('mantiene ítems cuya cantidad está dentro del stock disponible', async () => {
      mockFrom([{ id: 'prod-1', stock: 10, name: 'iPhone 14' }]);
      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('add-default'));

      await act(async () => {
        await cart().validateCart();
      });

      await waitFor(() => {
        expect(items()[0].quantity).toBe(2);
        expect(items()).toHaveLength(1);
      });
    });

    it.each([
      {
        label: 'datos iguales',
        productData: [{ id: 'prod-1', stock: 5, name: 'iPhone 14', price: 500 }],
        expectedQty: 1,
        expectedPrice: 500,
      },
      {
        label: 'datos ajustados',
        productData: [{ id: 'prod-1', stock: 3, name: 'iPhone 14', price: 750 }],
        expectedQty: 1,
        expectedPrice: 750,
      },
    ])('llama a supabase.from una sola vez al abrir el carrito con useEffect ($label)', async ({ productData, expectedQty, expectedPrice }) => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: productData, error: null }),
          }),
        }),
      } as unknown as ReturnType<typeof supabase.from>);

      const AutoValidateObserver = () => {
        const { isOpen, validateCart, addToCart, openCart, items: cartItems } = useCart();

        useEffect(() => {
          if (isOpen) {
            void validateCart();
          }
        }, [isOpen, validateCart]);

        return (
          <div>
            <span data-testid="observer-items">{JSON.stringify(cartItems)}</span>
            <button data-testid="observer-add" onClick={() => addToCart(makeItem())} />
            <button data-testid="observer-open" onClick={() => openCart()} />
          </div>
        );
      };

      render(
        <CartProvider>
          <AutoValidateObserver />
        </CartProvider>
      );

      await userEvent.click(screen.getByTestId('observer-add'));
      await userEvent.click(screen.getByTestId('observer-open'));

      await waitFor(() => {
        const parsed = JSON.parse(screen.getByTestId('observer-items').textContent ?? '[]') as CartItem[];
        expect(parsed).toHaveLength(1);
        expect(parsed[0].quantity).toBe(expectedQty);
        expect(parsed[0].price).toBe(expectedPrice);
      });

      // Give React a chance to run any extra effects if validateCart had an unstable reference
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(supabase.from).toHaveBeenCalledTimes(2);
      expect(supabase.from).toHaveBeenNthCalledWith(1, 'products');
      expect(supabase.from).toHaveBeenNthCalledWith(2, 'storefront_promotion_prices');
    });

    const mockTables = (handlers: {
      products: { data: unknown; error: unknown };
      product_variants?: { data: unknown; error: unknown };
      storefront_promotion_prices: { data: unknown; error: unknown };
    }) => {
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'storefront_promotion_prices') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue(handlers.storefront_promotion_prices),
            }),
          } as unknown as ReturnType<typeof supabase.from>;
        }
        const response = table === 'product_variants'
          ? (handlers.product_variants ?? { data: [], error: null })
          : handlers.products;
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue(response),
            }),
          }),
        } as unknown as ReturnType<typeof supabase.from>;
      });
    };

    it('con promo vigente, validateCart ajusta el precio del ítem al effective_price', async () => {
      mockTables({
        products: {
          data: [{ id: 'prod-1', stock: 5, name: 'iPhone 14', price: 500 }],
          error: null,
        },
        storefront_promotion_prices: {
          data: [
            {
              product_id: 'prod-1',
              variant_id: null,
              list_price: 500,
              effective_price: 420,
              promotion_id: 'promo-1',
              promotion_ends_at: '2026-12-01T00:00:00Z',
            },
          ],
          error: null,
        },
      });

      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-default'));

      let result: Awaited<ReturnType<ReturnType<typeof useCart>['validateCart']>> | undefined;
      await act(async () => {
        result = await cart().validateCart();
      });

      expect(result).toEqual({ removedItems: [], adjustedItems: ['iPhone 14'] });
      expect(items()[0].price).toBe(420);
      expect(totalPrice()).toBe('420');
    });

    it('con promo vigente en variante, validateCart ajusta el precio de la variante al effective_price', async () => {
      mockTables({
        products: {
          data: [{ id: 'prod-1', stock: 5, name: 'iPhone 14', price: 1000 }],
          error: null,
        },
        product_variants: {
          data: [{ id: 'var-red', stock: 5, price: 800 }],
          error: null,
        },
        storefront_promotion_prices: {
          data: [
            {
              product_id: 'prod-1',
              variant_id: 'var-red',
              list_price: 800,
              effective_price: 640,
              promotion_id: 'promo-var',
              promotion_ends_at: '2026-12-01T00:00:00Z',
            },
          ],
          error: null,
        },
      });

      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-variant-red'));

      let result: Awaited<ReturnType<ReturnType<typeof useCart>['validateCart']>> | undefined;
      await act(async () => {
        result = await cart().validateCart();
      });

      expect(result).toEqual({ removedItems: [], adjustedItems: ['iPhone 14'] });
      expect(items()[0].price).toBe(640);
      expect(totalPrice()).toBe('640');
    });

    it('si la vista de promociones da error, usa el precio legacy', async () => {
      mockTables({
        products: {
          data: [{ id: 'prod-1', stock: 5, name: 'iPhone 14', price: 650 }],
          error: null,
        },
        storefront_promotion_prices: {
          data: null,
          error: { code: 'PGRST205', message: 'Could not find the table' },
        },
      });

      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-default'));

      let result: Awaited<ReturnType<ReturnType<typeof useCart>['validateCart']>> | undefined;
      await act(async () => {
        result = await cart().validateCart();
      });

      expect(result).toEqual({ removedItems: [], adjustedItems: ['iPhone 14'] });
      expect(items()[0].price).toBe(650);
      expect(totalPrice()).toBe('650');
    });

    it('sin bucle: un 409 posterior con el mismo precio no vuelve a ajustar', async () => {
      mockTables({
        products: {
          data: [{ id: 'prod-1', stock: 5, name: 'iPhone 14', price: 500 }],
          error: null,
        },
        storefront_promotion_prices: {
          data: [
            {
              product_id: 'prod-1',
              variant_id: null,
              list_price: 500,
              effective_price: 420,
              promotion_id: 'promo-1',
              promotion_ends_at: '2026-12-01T00:00:00Z',
            },
          ],
          error: null,
        },
      });

      const { cart } = renderCart();
      await userEvent.click(screen.getByTestId('add-default'));

      await act(async () => {
        expect(await cart().validateCart()).toEqual({ removedItems: [], adjustedItems: ['iPhone 14'] });
      });
      expect(totalPrice()).toBe('420');

      act(() => {
        expect(cart().applyAuthoritativePrices([{ product_id: 'prod-1', variant_id: null, unit_price: 420 }])).toBe(true);
      });
      expect(totalPrice()).toBe('420');

      await act(async () => {
        expect(await cart().validateCart()).toEqual({ removedItems: [], adjustedItems: [] });
      });
      expect(items()[0].price).toBe(420);
      expect(totalPrice()).toBe('420');
    });
  });
});
 

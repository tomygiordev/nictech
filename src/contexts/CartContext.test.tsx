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
}: {
  onAction?: (cart: ReturnType<typeof useCart>) => void;
}) => {
  const cart = useCart();

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

const renderCart = (props?: { onAction?: (cart: ReturnType<typeof useCart>) => void }) =>
  render(
    <CartProvider>
      <CartHarness {...props} />
    </CartProvider>,
  );

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
      const saved = JSON.parse(localStorage.getItem('cartItems')!);
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe('prod-1');
    });

    it('borra cartItems de localStorage al limpiar el carrito', async () => {
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('clear'));
      const saved = JSON.parse(localStorage.getItem('cartItems')!);
      expect(saved).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // validateCart (with Supabase mock)
  // -------------------------------------------------------------------------
  describe('validateCart()', () => {
    const mockFrom = (productData: { id: string; stock: number; name: string }[]) => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: productData, error: null }),
        }),
      } as any);
    };

    it('no hace nada cuando el carrito está vacío', async () => {
      renderCart();
      await act(async () => {
        await userEvent.click(screen.getByTestId('validate'));
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('elimina ítems sin stock', async () => {
      mockFrom([{ id: 'prod-1', stock: 0, name: 'iPhone 14' }]);
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));

      await act(async () => {
        await userEvent.click(screen.getByTestId('validate'));
      });

      await waitFor(() => {
        expect(items()).toHaveLength(0);
      });
    });

    it('ajusta la cantidad cuando excede el stock disponible', async () => {
      mockFrom([{ id: 'prod-1', stock: 2, name: 'iPhone 14' }]);
      renderCart();
      // Add 3 items
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('add-default'));
      expect(items()[0].quantity).toBe(3);

      await act(async () => {
        await userEvent.click(screen.getByTestId('validate'));
      });

      await waitFor(() => {
        expect(items()[0].quantity).toBe(2);
      });
    });

    it('mantiene ítems cuya cantidad está dentro del stock disponible', async () => {
      mockFrom([{ id: 'prod-1', stock: 10, name: 'iPhone 14' }]);
      renderCart();
      await userEvent.click(screen.getByTestId('add-default'));
      await userEvent.click(screen.getByTestId('add-default'));

      await act(async () => {
        await userEvent.click(screen.getByTestId('validate'));
      });

      await waitFor(() => {
        expect(items()[0].quantity).toBe(2);
        expect(items()).toHaveLength(1);
      });
    });
  });
});

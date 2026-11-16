import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { storefrontSupabase } from '@/integrations/supabase/types.extensions';

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image_url?: string;
  maxStock: number;
  variant?: {
    id: string;
    color: string;
    image_url?: string;
  };
}

interface StockValidationResult {
  removedItems: string[];
  adjustedItems: string[];
  validationError?: string;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity'>) => void;
  removeFromCart: (id: string, variantId?: string) => void;
  updateQuantity: (id: string, quantity: number, variantId?: string) => void;
  clearCart: () => void;
  validateCart: () => Promise<StockValidationResult>;
  totalItems: number;
  totalPrice: number;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  isValidating: boolean;
}

const matchesCartItem = (item: CartItem, id: string, variantId?: string) =>
  variantId !== undefined
    ? item.id === id && item.variant?.id === variantId
    : item.id === id;

const hasCartChanged = (currentItems: CartItem[], nextItems: CartItem[]) =>
  nextItems.length !== currentItems.length ||
  nextItems.some((nextItem, index) => {
    const currentItem = currentItems[index];
    return (
      nextItem.id !== currentItem.id ||
      nextItem.variant?.id !== currentItem.variant?.id ||
      nextItem.price !== currentItem.price ||
      nextItem.quantity !== currentItem.quantity ||
      nextItem.maxStock !== currentItem.maxStock ||
      nextItem.name !== currentItem.name ||
      nextItem.image_url !== currentItem.image_url
    );
  });

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const savedItems = localStorage.getItem('cartItems');
      if (!savedItems) return [];
      const parsed = JSON.parse(savedItems);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem('cartItems');
        return [];
      }
      return parsed;
    } catch {
      localStorage.removeItem('cartItems');
      return [];
    }
  });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const validatingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  // Debounce localStorage writes to avoid blocking main thread on rapid cart updates
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem('cartItems', JSON.stringify(items));
      } catch {
        // localStorage full or unavailable
      }
    }, 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [items]);

  /**
   * Validates all cart items against current stock in the database.
   * - Removes items with 0 stock
   * - Adjusts quantity if it exceeds current stock
   * - Returns info about what changed for UI feedback
   */
  const validateCart = useCallback(async (): Promise<StockValidationResult> => {
    const currentItems = itemsRef.current;
    if (currentItems.length === 0 || validatingRef.current) {
      return { removedItems: [], adjustedItems: [] };
    }

    validatingRef.current = true;
    setIsValidating(true);
    const removedItems: string[] = [];
    const adjustedItems: string[] = [];

    try {
      // Get unique product IDs from cart
      const productIds = [...new Set(currentItems.map(item => item.id))];

      // Fetch current stock for all products in cart
      const { data: products, error: productsError } = await storefrontSupabase
        .from('products')
        .select('id, stock, name, price')
        .eq('is_active', true)
        .in('id', productIds);

      if (productsError) {
        console.error('Error validating cart stock:', productsError);
        return { removedItems, adjustedItems, validationError: 'No se pudo comprobar la disponibilidad del carrito' };
      }

      // Also fetch variant stocks if any cart items have variants
      const variantIds = currentItems
        .filter(item => item.variant?.id)
        .map(item => item.variant!.id);

      const variantStocks: Record<string, number> = {};
      const variantPrices: Record<string, number | null | undefined> = {};
      if (variantIds.length > 0) {
        const { data: variants, error: variantsError } = await storefrontSupabase
          .from('product_variants')
          .select('*')
          .eq('is_active', true)
          .in('id', variantIds);

        if (variantsError) {
          console.error('Error validating variant stock:', variantsError);
          return { removedItems, adjustedItems, validationError: 'No se pudo comprobar la disponibilidad de las variantes' };
        }

        if (variants) {
          variants.forEach(v => {
            variantStocks[v.id] = v.stock;
            variantPrices[v.id] = v.price;
          });
        }
      }

      const productLookup = new Map((products ?? []).map(product => [product.id, product]));
      const validItems: CartItem[] = [];
      for (const item of currentItems) {
        const product = productLookup.get(item.id);
        const currentStock = item.variant?.id
          ? (variantStocks[item.variant.id] ?? 0)
          : (product?.stock ?? 0);
        if (!product || currentStock <= 0) {
          removedItems.push(item.name);
          continue;
        }
        const currentPrice = (item.variant?.id ? variantPrices[item.variant.id] : null) ?? product.price ?? item.price;
        if (item.quantity > currentStock || item.price !== currentPrice) adjustedItems.push(item.name);
        validItems.push({ ...item, price: currentPrice, quantity: Math.min(item.quantity, currentStock), maxStock: currentStock });
      }
      if (itemsRef.current !== currentItems) {
        return { removedItems: [], adjustedItems: [], validationError: 'El carrito cambió durante la validación. Intentá de nuevo.' };
      }
      if (hasCartChanged(currentItems, validItems)) {
        setItems(validItems);
      }
    } catch (error) {
      console.error('Cart validation error:', error);
      return { removedItems, adjustedItems, validationError: 'No se pudo comprobar la disponibilidad del carrito' };
    } finally {
      validatingRef.current = false;
      setIsValidating(false);
    }

    return { removedItems, adjustedItems };
  }, []);

  const addToCart = useCallback((item: Omit<CartItem, 'quantity'>) => {
    setItems(prev => {
      // Find if item with same ID AND same variant exists
      const existingItemIndex = prev.findIndex(i =>
        i.id === item.id &&
        (i.variant?.id === item.variant?.id) // Match variant ID if present, or both undefined
      );

      if (existingItemIndex > -1) {
        const existingItem = prev[existingItemIndex];
        if (existingItem.quantity >= item.maxStock) {
          return prev;
        }

        const newItems = [...prev];
        newItems[existingItemIndex] = {
          ...existingItem,
          quantity: Math.min(existingItem.quantity + 1, item.maxStock)
        };
        return newItems;
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((id: string, variantId?: string) => {
    setItems(prev => prev.filter(item => !matchesCartItem(item, id, variantId)));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number, variantId?: string) => {
    if (quantity <= 0) {
      removeFromCart(id, variantId);
      return;
    }
    setItems(prev =>
      prev.map(item => {
        if (matchesCartItem(item, id, variantId)) {
          return { ...item, quantity: Math.min(quantity, item.maxStock) };
        }
        return item;
      })
    );
  }, [removeFromCart]);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const openCart = () => setIsOpen(true);
  const closeCart = () => setIsOpen(false);

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        validateCart,
        totalItems,
        totalPrice,
        isOpen,
        openCart,
        closeCart,
        isValidating,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};

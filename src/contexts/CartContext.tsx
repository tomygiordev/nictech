import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
}

interface CartContextType {
  items: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity'>) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  validateCart: () => Promise<StockValidationResult>;
  totalItems: number;
  totalPrice: number;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  isValidating: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>(() => {
    const savedItems = localStorage.getItem('cartItems');
    return savedItems ? JSON.parse(savedItems) : [];
  });
  const [isOpen, setIsOpen] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    localStorage.setItem('cartItems', JSON.stringify(items));
  }, [items]);

  /**
   * Validates all cart items against current stock in the database.
   * - Removes items with 0 stock
   * - Adjusts quantity if it exceeds current stock
   * - Returns info about what changed for UI feedback
   */
  const validateCart = useCallback(async (): Promise<StockValidationResult> => {
    if (items.length === 0) return { removedItems: [], adjustedItems: [] };

    setIsValidating(true);
    const removedItems: string[] = [];
    const adjustedItems: string[] = [];

    try {
      // Get unique product IDs from cart
      const productIds = [...new Set(items.map(item => item.id))];

      // Fetch current stock for all products in cart
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, stock, name')
        .in('id', productIds);

      if (productsError) {
        console.error('Error validating cart stock:', productsError);
        return { removedItems, adjustedItems };
      }

      // Also fetch variant stocks if any cart items have variants
      const variantIds = items
        .filter(item => item.variant?.id)
        .map(item => item.variant!.id);

      let variantStocks: Record<string, number> = {};
      if (variantIds.length > 0) {
        const { data: variants } = await supabase
          .from('product_variants' as any)
          .select('id, stock')
          .in('id', variantIds);

        if (variants) {
          (variants as any[]).forEach(v => {
            variantStocks[v.id] = v.stock;
          });
        }
      }

      // Build stock lookup
      const stockLookup: Record<string, number> = {};
      if (products) {
        products.forEach(p => {
          stockLookup[p.id] = p.stock;
        });
      }

      // Validate each cart item
      setItems(prevItems => {
        const validItems: CartItem[] = [];

        for (const item of prevItems) {
          // Check if product still exists and has stock
          const currentStock = item.variant?.id
            ? (variantStocks[item.variant.id] ?? 0)
            : (stockLookup[item.id] ?? 0);

          if (currentStock <= 0) {
            // Product is out of stock — remove it
            removedItems.push(item.name);
            continue;
          }

          if (item.quantity > currentStock) {
            // Quantity exceeds available stock — adjust it
            adjustedItems.push(item.name);
            validItems.push({
              ...item,
              quantity: currentStock,
              maxStock: currentStock,
            });
          } else {
            // Update maxStock to reflect current reality
            validItems.push({
              ...item,
              maxStock: currentStock,
            });
          }
        }

        return validItems;
      });
    } catch (error) {
      console.error('Cart validation error:', error);
    } finally {
      setIsValidating(false);
    }

    return { removedItems, adjustedItems };
  }, [items]);

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

  const removeFromCart = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(id);
      return;
    }
    setItems(prev =>
      prev.map(item => {
        if (item.id === id) {
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

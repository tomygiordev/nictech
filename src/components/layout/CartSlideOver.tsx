import { useEffect, useState } from 'react';
import { X, Plus, Minus, Trash2, ShoppingBag, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCart } from '@/contexts/CartContext';
import { toast } from 'sonner';

export const CartSlideOver = () => {
  const { items, isOpen, closeCart, updateQuantity, removeFromCart, totalPrice, clearCart, validateCart, isValidating } = useCart();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Validate stock every time the cart is opened
  useEffect(() => {
    if (isOpen && items.length > 0) {
      validateCart().then(({ removedItems, adjustedItems }) => {
        if (removedItems.length > 0) {
          toast.error(`Productos sin stock removidos: ${removedItems.join(', ')}`);
        }
        if (adjustedItems.length > 0) {
          toast.info(`Stock ajustado para: ${adjustedItems.join(', ')}`);
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-50 animate-fade-in"
        onClick={closeCart}
      />

      {/* Slide-over panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-background shadow-xl z-50 animate-slide-up">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-primary" />
              Tu Carrito
            </h2>
            <Button variant="ghost" size="icon" onClick={closeCart}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Validating indicator */}
          {isValidating && (
            <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-primary/10 text-sm text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando stock disponible...
            </div>
          )}

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-4">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <ShoppingBag className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground">Tu carrito está vacío</p>
                <Button variant="outline" className="mt-4" onClick={closeCart}>
                  Continuar Comprando
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <div
                    key={`${item.id}-${item.variant?.id || 'base'}`}
                    className="flex gap-4 p-3 rounded-xl bg-muted/50 animate-fade-in"
                  >
                    <div className="h-20 w-20 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <ShoppingBag className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm truncate">{item.name}</h4>
                      {item.variant && (
                        <p className="text-xs text-muted-foreground">Color: {item.variant.color}</p>
                      )}
                      <p className="text-primary font-semibold mt-1">
                        $ {item.price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      {/* Low stock warning */}
                      {item.maxStock <= 3 && item.maxStock > 0 && (
                        <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                          <AlertTriangle className="h-3 w-3" />
                          ¡Quedan solo {item.maxStock}!
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center text-sm font-medium">
                          {item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={item.quantity >= item.maxStock}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 ml-auto text-destructive hover:text-destructive"
                          onClick={() => removeFromCart(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="p-4 border-t border-border space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="text-xl font-bold text-primary">
                  $ {totalPrice.toLocaleString('es-AR')}
                </span>
              </div>
              <Button
                className="w-full"
                size="lg"
                disabled={isValidating}
                onClick={() => {
                  closeCart();
                  window.location.href = '/checkout';
                }}
              >
                {isValidating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  'Proceder al Pago'
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowClearConfirm(true)}
              >
                Vaciar Carrito
              </Button>

              <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Vaciar carrito</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se eliminarán todos los productos del carrito. Esta acción no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { clearCart(); setShowClearConfirm(false); }}>
                      Vaciar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

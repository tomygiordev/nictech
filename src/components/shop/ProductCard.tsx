import React from 'react';
import { ShoppingCart, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { toast } from 'sonner';
import { calculateOriginalUsdPrice } from '@/lib/pricing';

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  price_usd?: number | null;
  original_price?: number | null;
  stock: number;
  image_url?: string;
  description?: string;
  category: string;
  tags?: string[] | null;
}

const getTagStyle = (index: number) => {
  if (index % 2 === 0) {
    // Brand Blue
    return 'bg-secondary/10 text-secondary border-secondary/20';
  } else {
    // Brand Red
    return 'bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/20';
  }
};

export const ProductCard = React.memo(({
  id,
  name,
  price,
  price_usd,
  original_price,
  stock,
  image_url,
  description,
  category,
  tags,
}: ProductCardProps) => {
  const { addToCart } = useCart();
  const originalUsdPrice = calculateOriginalUsdPrice({
    price,
    priceUsd: price_usd,
    originalPrice: original_price,
  });

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart({
      id,
      name,
      price,
      maxStock: stock,
      image_url: image_url || null,
    });
    toast.success(`${name} se agregó a tu carrito`, { duration: 3500 });
  };

  return (
    <div className="group bg-card rounded-2xl border border-border overflow-hidden card-hover h-full flex flex-col transition-all duration-300 ease-out-default select-none">
      {/* Image */}
      <div className="relative aspect-square bg-white overflow-hidden p-1.5 sm:p-2">
        {image_url ? (
          <img
            src={image_url}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 ease-out-default group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Package className="h-10 w-10 sm:h-16 sm:w-16 text-muted-foreground/30" />
          </div>
        )}

        {/* Category badge */}
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 flex flex-col gap-1 z-10">
          <span className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-full bg-background/90 backdrop-blur-sm text-[9px] sm:text-xs font-medium text-foreground">
            {category}
          </span>
          {original_price != null && (
            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[8px] sm:text-[10px] font-bold w-fit shadow-sm">
              PROMO
            </span>
          )}
        </div>

        {/* Stock indicator */}
        {stock <= 5 && stock > 0 && (
          <div className="absolute top-2 right-2 sm:top-3 sm:right-3 max-w-[55%] z-10">
            <span className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full bg-red-600 text-white animate-pulse shadow-sm text-[8px] sm:text-[10px] font-bold leading-tight block text-center">
              ¡Últimos!
            </span>
          </div>
        )}
        {stock === 0 && (
          <div className="absolute inset-0 bg-foreground/45 flex items-center justify-center z-10">
            <span className="px-2.5 py-1 sm:px-4 sm:py-2 rounded-full bg-background text-foreground text-xs sm:font-medium shadow-sm">
              Agotado
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 sm:p-5 flex flex-col flex-1">
        <h3 className="font-semibold text-foreground text-sm sm:text-lg mb-1 line-clamp-2 group-hover:text-primary transition-colors duration-200">
          {name}
        </h3>
        <div className="mb-3 hidden h-10 sm:block">
          {description ? (
            <p className="h-full overflow-hidden text-sm leading-5 text-muted-foreground line-clamp-2">
              {description}
            </p>
          ) : null}
        </div>

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="flex-wrap gap-1.5 mb-3.5 hidden sm:flex">
            {tags.slice(0, 3).map((tag, index) => {
              const tagStyle = getTagStyle(index);
              return (
                <span key={index} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] uppercase font-bold tracking-wider border ${tagStyle}`}>
                  <span className="h-1 w-1 rounded-full bg-current mr-1 shrink-0" />
                  {tag}
                </span>
              );
            })}
            {tags.length > 3 && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-muted text-muted-foreground border border-border/40">+{tags.length - 3}</span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-2.5 sm:pt-4 border-t border-border/50">
          <div className="min-w-0 flex-1">
            {price_usd != null ? (
              <>
                {originalUsdPrice != null && (
                  <span className="text-[10px] sm:text-sm text-muted-foreground line-through block truncate">
                    USD {originalUsdPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                )}
                <span className="text-sm sm:text-2xl font-bold text-green-700 block truncate">
                  USD {price_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
                <p className="text-[9px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">
                  Precio en dólares
                </p>
              </>
            ) : (
              <>
                {original_price != null && (
                  <span className="text-[10px] sm:text-sm text-muted-foreground line-through block truncate">
                    $ {original_price.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </span>
                )}
                <span className="text-sm sm:text-2xl font-bold text-primary block truncate">
                  $ {price.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </span>
              </>
            )}
            <p className="text-[9px] sm:text-xs text-muted-foreground mt-0.5">
              {stock > 0 ? `${stock} disp.` : 'Sin stock'}
            </p>
          </div>

          <Button
            variant="default"
            size="icon"
            className="rounded-full h-7 w-7 sm:h-11 sm:w-11 shrink-0 ml-1.5 sm:ml-4 hover:bg-primary/90 shadow-sm transition-all duration-100 ease-out-default active:scale-[0.93] select-none"
            disabled={stock === 0}
            onClick={handleAddToCart}
            title="Añadir a carrito"
          >
            <ShoppingCart className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
});

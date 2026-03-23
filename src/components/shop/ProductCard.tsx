import React from 'react';
import { ShoppingCart, Package, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { toast } from 'sonner';

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  original_price?: number | null;
  stock: number;
  image_url?: string;
  description?: string;
  category: string;
  tags?: string[] | null;
}

export const ProductCard = React.memo(({
  id,
  name,
  price,
  original_price,
  stock,
  image_url,
  description,
  category,
  tags,
}: ProductCardProps) => {
  const { addToCart } = useCart();

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
    <div className="group bg-card rounded-2xl border border-border overflow-hidden card-hover h-full flex flex-col">
      {/* Image */}
      <div className="relative aspect-square bg-white overflow-hidden p-2">
        {image_url ? (
          <img
            src={image_url}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Package className="h-16 w-16 text-muted-foreground/30" />
          </div>
        )}

        {/* Category badge */}
        <div className="absolute top-3 left-3 flex flex-col gap-1">
          <span className="px-3 py-1 rounded-full bg-background/90 backdrop-blur-sm text-xs font-medium text-foreground">
            {category}
          </span>
          {original_price != null && (
            <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold w-fit">
              PROMO
            </span>
          )}
        </div>

        {/* Stock indicator */}
        {stock <= 5 && stock > 0 && (
          <div className="absolute top-3 right-3">
            <span className="px-3 py-1 rounded-full bg-red-600 text-white animate-pulse shadow-sm text-xs font-bold">
              ¡Últimas unidades!
            </span>
          </div>
        )}
        {stock === 0 && (
          <div className="absolute inset-0 bg-foreground/50 flex items-center justify-center">
            <span className="px-4 py-2 rounded-full bg-background text-foreground font-medium">
              Agotado
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-semibold text-foreground text-lg mb-1 line-clamp-1 group-hover:text-primary transition-colors">
          {name}
        </h3>
        {description && (
          <p className="text-muted-foreground text-sm line-clamp-2 mb-4">
            {description}
          </p>
        )}

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {tags.slice(0, 3).map((tag, index) => (
              <span key={index} className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-secondary/50 text-secondary-foreground border border-secondary">
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground">+{tags.length - 3}</span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-4 border-t border-border/50">
          <div>
            {original_price != null && (
              <span className="text-sm text-muted-foreground line-through block">
                $ {original_price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
            <span className="text-2xl font-bold text-primary">
              $ {price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              {stock > 0 ? `${stock} disponibles` : 'Sin stock'}
            </p>
          </div>

          <Button
            variant="default"
            size="icon"
            className="rounded-full h-11 w-11 shrink-0 ml-4 hover:bg-primary/90 shadow-sm"
            disabled={stock === 0}
            onClick={handleAddToCart}
            title="Añadir a carrito"
          >
            <ShoppingCart className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
});

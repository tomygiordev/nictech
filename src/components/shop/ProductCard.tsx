import { ShoppingCart, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { toast } from '@/hooks/use-toast';

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  stock: number;
  image_url?: string;
  description?: string;
  category: string;
}

export const ProductCard = ({
  id,
  name,
  price,
  stock,
  image_url,
  description,
  category,
}: ProductCardProps) => {
  const { addToCart } = useCart();

  const handleAddToCart = () => {
    addToCart({ id, name, price, image_url, maxStock: stock });
    toast({
      title: 'Producto agregado',
      description: `${name} se ha añadido al carrito.`,
    });
  };

  return (
    <div className="group bg-card rounded-2xl border border-border overflow-hidden card-hover">
      {/* Image */}
      <div className="relative aspect-square bg-muted overflow-hidden">
        {image_url ? (
          <img
            src={image_url}
            alt={name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Package className="h-16 w-16 text-muted-foreground/30" />
          </div>
        )}

        {/* Category badge */}
        <div className="absolute top-3 left-3">
          <span className="px-3 py-1 rounded-full bg-background/90 backdrop-blur-sm text-xs font-medium text-foreground">
            {category}
          </span>
        </div>

        {/* Stock indicator */}
        {stock <= 5 && stock > 0 && (
          <div className="absolute top-3 right-3">
            <span className="px-3 py-1 rounded-full bg-warning text-warning-foreground text-xs font-medium">
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
      <div className="p-5">
        <h3 className="font-semibold text-foreground text-lg mb-1 line-clamp-1 group-hover:text-primary transition-colors">
          {name}
        </h3>
        {description && (
          <p className="text-muted-foreground text-sm line-clamp-2 mb-4">
            {description}
          </p>
        )}

        <div className="flex items-center justify-between">
          <div>
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
            className="rounded-full h-11 w-11"
            disabled={stock === 0}
            onClick={handleAddToCart}
          >
            <ShoppingCart className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

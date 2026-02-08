import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShoppingCart, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Product {
    id: string;
    name: string;
    price: number;
    stock: number;
    image_url: string | null;
    additional_images: string[] | null;
    description: string | null;
    category?: { name: string };
}

interface ProductDetailModalProps {
    product: Product | null;
    isOpen: boolean;
    onClose: () => void;
}

export const ProductDetailModal = ({ product, isOpen, onClose }: ProductDetailModalProps) => {
    const { addToCart } = useCart();
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    if (!product) return null;

    const images = [product.image_url, ...(product.additional_images || [])].filter(Boolean) as string[];

    const handleNextImage = () => {
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    };

    const handlePrevImage = () => {
        setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
    };

    const handleAddToCart = () => {
        addToCart({
            id: product.id,
            name: product.name,
            price: product.price,
            image_url: product.image_url || undefined,
            maxStock: product.stock,
        });
        toast({
            title: 'Producto agregado',
            description: `${product.name} se ha añadido al carrito.`,
        });
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl p-0 overflow-hidden bg-card border-none shadow-2xl rounded-3xl">
                <div className="grid grid-cols-1 md:grid-cols-2 h-[80vh] md:h-auto">
                    {/* Image Gallery */}
                    <div className="relative bg-muted/30 flex items-center justify-center p-6 h-1/2 md:h-auto overflow-hidden">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-4 right-4 z-10 md:hidden bg-background/50 backdrop-blur-sm rounded-full"
                            onClick={onClose}
                        >
                            <X className="h-5 w-5" />
                        </Button>

                        {images.length > 0 ? (
                            <div className="relative h-full w-full flex items-center justify-center">
                                <img
                                    src={images[currentImageIndex]}
                                    alt={product.name}
                                    className="max-h-full max-w-full object-contain mix-blend-multiply transition-opacity duration-300"
                                />

                                {images.length > 1 && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/80"
                                            onClick={handlePrevImage}
                                        >
                                            <ChevronLeft className="h-5 w-5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/80"
                                            onClick={handleNextImage}
                                        >
                                            <ChevronRight className="h-5 w-5" />
                                        </Button>

                                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                                            {images.map((_, index) => (
                                                <button
                                                    key={index}
                                                    className={cn(
                                                        "w-2 h-2 rounded-full transition-all",
                                                        index === currentImageIndex
                                                            ? "bg-primary w-4"
                                                            : "bg-primary/30 hover:bg-primary/50"
                                                    )}
                                                    onClick={() => setCurrentImageIndex(index)}
                                                />
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center">
                                    <ShoppingCart className="h-8 w-8 opacity-50" />
                                </div>
                                <span className="text-sm">Sin imagen</span>
                            </div>
                        )}
                    </div>

                    {/* Product Info */}
                    <div className="p-8 flex flex-col h-1/2 md:h-[600px] overflow-y-auto">
                        <div className="flex-1">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-3">
                                        {product.category?.name || 'Producto'}
                                    </span>
                                    <h2 className="text-2xl font-bold text-foreground mb-2 leading-tight">
                                        {product.name}
                                    </h2>
                                </div>
                            </div>

                            <div className="text-3xl font-bold text-primary mb-6">
                                $ {product.price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>

                            <div className="prose prose-sm text-muted-foreground mb-8">
                                <p className="whitespace-pre-line">{product.description || 'Sin descripción disponible.'}</p>
                            </div>
                        </div>

                        <div className="mt-auto space-y-4 pt-6 border-t border-border">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Disponibilidad:</span>
                                <span className={cn(
                                    "font-medium",
                                    product.stock > 0 ? "text-green-600" : "text-destructive"
                                )}>
                                    {product.stock > 0 ? `${product.stock} unidades` : 'Agotado'}
                                </span>
                            </div>

                            <Button
                                className="w-full h-12 text-lg rounded-xl shadow-lg shadow-primary/20"
                                size="lg"
                                disabled={product.stock === 0}
                                onClick={handleAddToCart}
                            >
                                <ShoppingCart className="h-5 w-5 mr-2" />
                                {product.stock > 0 ? 'Agregar al Carrito' : 'Sin Stock'}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

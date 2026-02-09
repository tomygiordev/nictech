import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'; // Added imports
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

    if (!product) return null;

    const images = [product.image_url, ...(product.additional_images || [])].filter(Boolean) as string[];

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
            <DialogContent className="max-w-4xl p-0 gap-0 border-none shadow-2xl rounded-3xl max-h-[85vh] overflow-y-auto">
                {/* Accessibility Requirements */}
                <DialogTitle className="sr-only">Detalles del producto: {product.name}</DialogTitle>
                <DialogDescription className="sr-only">
                    Vista detallada del producto {product.name}, incluyendo precio, descripción y opciones de compra.
                </DialogDescription>

                <div className="flex flex-col md:grid md:grid-cols-2">
                    {/* Image Gallery */}
                    <div className="relative bg-muted/30 flex items-center justify-center p-6 aspect-square md:aspect-auto md:h-[600px] overflow-hidden shrink-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-4 right-4 z-10 md:hidden bg-background/50 backdrop-blur-sm rounded-full shadow-sm"
                            onClick={onClose}
                        >
                            <X className="h-5 w-5" />
                        </Button>

                        {images.length > 0 ? (
                            <Carousel className="w-full h-full flex items-center justify-center">
                                <CarouselContent>
                                    {images.map((image, index) => (
                                        <CarouselItem key={index} className="flex h-full items-center justify-center">
                                            <div className="relative w-full h-full flex items-center justify-center">
                                                <img
                                                    src={image}
                                                    alt={`${product.name} - Imagen ${index + 1}`}
                                                    className="max-h-full max-w-full object-contain mix-blend-multiply"
                                                />
                                            </div>
                                        </CarouselItem>
                                    ))}
                                </CarouselContent>
                                {images.length > 1 && (
                                    <>
                                        <CarouselPrevious className="left-2" />
                                        <CarouselNext className="right-2" />
                                    </>
                                )}
                            </Carousel>
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
                    <div className="p-6 md:p-8 flex flex-col h-auto md:h-[600px] md:overflow-y-auto">
                        <div className="flex-1">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-3">
                                        {product.category?.name || 'Producto'}
                                    </span>
                                    {/* Visual Title (h2) - The actual DialogTitle is hidden for accessibility but we keep visual hierarchy */}
                                    <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2 leading-tight">
                                        {product.name}
                                    </h2>
                                </div>
                            </div>

                            <div className="text-2xl md:text-3xl font-bold text-primary mb-6">
                                $ {product.price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>

                            <div className="prose prose-sm text-muted-foreground mb-8">
                                <p className="whitespace-pre-line">{product.description || 'Sin descripción disponible.'}</p>
                            </div>
                        </div>

                        <div className="mt-8 pt-6 border-t border-border bg-card pb-2 md:pb-0">
                            <div className="flex items-center justify-between text-sm mb-4">
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

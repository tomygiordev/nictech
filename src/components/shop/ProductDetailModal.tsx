import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShoppingCart, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from '@/components/ui/carousel';
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
    tags?: string[] | null;
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

    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    const openLightbox = (index: number) => {
        setCurrentImageIndex(index);
        setLightboxOpen(true);
    };

    const closeLightbox = () => {
        setLightboxOpen(false);
    };

    const nextImage = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    }, [images.length]);

    const prevImage = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
    }, [images.length]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!lightboxOpen) return;
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowRight') nextImage();
            if (e.key === 'ArrowLeft') prevImage();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightboxOpen, nextImage, prevImage]);

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
        <>
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="max-w-4xl p-0 gap-0 border-none shadow-2xl rounded-3xl max-h-[85vh] overflow-y-auto">
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
                                    <CarouselContent className="h-full">
                                        {images.map((image, index) => (
                                            <CarouselItem key={index} className="flex h-full items-center justify-center p-0">
                                                <div
                                                    className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black/5 cursor-zoom-in"
                                                    onClick={() => openLightbox(index)}
                                                >
                                                    {/* Blurred Background Layer */}
                                                    <div className="absolute inset-0 z-0">
                                                        <img
                                                            src={image}
                                                            alt=""
                                                            className="w-full h-full object-cover opacity-30 blur-xl scale-110"
                                                        />
                                                    </div>

                                                    {/* Main Image */}
                                                    <img
                                                        src={image}
                                                        alt={`${product.name} - Imagen ${index + 1}`}
                                                        className="relative z-10 max-h-full max-w-full object-contain shadow-sm"
                                                    />
                                                </div>
                                            </CarouselItem>
                                        ))}
                                    </CarouselContent>
                                    {images.length > 1 && (
                                        <>
                                            <CarouselPrevious className="left-2 bg-background/80 hover:bg-background border-none shadow-md" />
                                            <CarouselNext className="right-2 bg-background/80 hover:bg-background border-none shadow-md" />
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

                                {/* Tags */}
                                {product.tags && product.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-6">
                                        {product.tags.map((tag, index) => (
                                            <span key={index} className="px-2 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
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

            {/* Lightbox Overlay */}
            {lightboxOpen && (
                <div
                    className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center animate-in fade-in duration-200"
                    onClick={closeLightbox}
                >
                    <button
                        onClick={closeLightbox}
                        className="absolute top-4 right-4 text-white/70 hover:text-white p-2 hover:bg-white/10 rounded-full transition-colors z-[110]"
                    >
                        <X size={32} />
                    </button>

                    {images.length > 1 && (
                        <>
                            <button
                                onClick={prevImage}
                                className="absolute left-4 text-white/70 hover:text-white p-2 hover:bg-white/10 rounded-full transition-colors z-[110]"
                            >
                                <ChevronLeft size={40} />
                            </button>
                            <button
                                onClick={nextImage}
                                className="absolute right-4 text-white/70 hover:text-white p-2 hover:bg-white/10 rounded-full transition-colors z-[110]"
                            >
                                <ChevronRight size={40} />
                            </button>
                        </>
                    )}

                    <div
                        className="relative w-full h-full p-4 flex items-center justify-center"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={images[currentImageIndex]}
                            alt={`Imagen ${currentImageIndex + 1}`}
                            className="max-h-full max-w-full object-contain"
                        />
                        <div className="absolute bottom-4 left-0 right-0 text-center text-white/50 text-sm">
                            {currentImageIndex + 1} / {images.length}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

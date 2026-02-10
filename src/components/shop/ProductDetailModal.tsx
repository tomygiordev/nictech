import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShoppingCart, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from '@/components/ui/carousel';
import { useCart } from '@/contexts/CartContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';


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

    if (!product) return null;

    const [variants, setVariants] = useState<{ id: string, color: string, stock: number, image_url: string | null }[]>([]);
    const [selectedVariant, setSelectedVariant] = useState<{ id: string, color: string, stock: number, image_url: string | null } | null>(null);

    // Initial images from product
    const [images, setImages] = useState<string[]>([]);

    useEffect(() => {
        if (!product) return;

        const initialImages = [product.image_url, ...(product.additional_images || [])].filter(Boolean) as string[];
        setImages(initialImages);

        // Fetch variants if applicable (e.g. check logic or just always try)
        const fetchVariants = async () => {
            const { data } = await supabase
                .from('product_variants' as any)
                .select('*')
                .eq('product_id', product.id);

            if (data && data.length > 0) {
                // Cast data to match state type
                const typedData = data as { id: string, color: string, stock: number, image_url: string | null }[];
                setVariants(typedData);
                // Auto select first variant if stock available
                const firstAvailable = typedData.find(v => v.stock > 0);
                if (firstAvailable) setSelectedVariant(firstAvailable);
            }
        };

        fetchVariants();
    }, [product]);

    // Update images/lightbox when variant is selected
    useEffect(() => {
        if (selectedVariant && selectedVariant.image_url) {
            // Prepend variant image to images list
            const initialImages = [product.image_url, ...(product.additional_images || [])].filter(Boolean) as string[];
            setImages([selectedVariant.image_url, ...initialImages]);
            setCurrentImageIndex(0); // Jump to variant image
        } else if (!selectedVariant) {
            const initialImages = [product.image_url, ...(product.additional_images || [])].filter(Boolean) as string[];
            setImages(initialImages);
        }
    }, [selectedVariant, product]);


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
        // If has variants but none selected
        if (variants.length > 0 && !selectedVariant) {
            toast({
                title: 'Selecciona un color',
                description: 'Por favor elige una variante antes de agregar al carrito.',
                variant: 'destructive',
            });
            return;
        }

        addToCart({
            id: product.id,
            name: variants.length > 0 && selectedVariant ? `${product.name} - ${selectedVariant.color}` : product.name,
            price: product.price,
            image_url: (selectedVariant?.image_url || product.image_url) || undefined,
            maxStock: selectedVariant ? selectedVariant.stock : product.stock,
            variant: selectedVariant ? {
                id: selectedVariant.id,
                color: selectedVariant.color,
                image_url: selectedVariant.image_url || undefined
            } : undefined
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
                        <div className="relative bg-white flex items-center justify-center p-6 aspect-square md:aspect-auto md:h-[600px] overflow-hidden shrink-0">
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
                                    <CarouselContent className="h-full ml-0">
                                        {images.map((image, index) => (
                                            <CarouselItem key={index} className="flex h-full items-center justify-center p-0 basis-full">
                                                <div
                                                    className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-white cursor-zoom-in"
                                                    onClick={() => openLightbox(index)}
                                                >
                                                    {/* Main Image */}
                                                    <div className="relative z-10 w-full h-full flex items-center justify-center p-4">
                                                        <img
                                                            src={image}
                                                            alt={`${product.name} - Imagen ${index + 1}`}
                                                            className="max-h-full max-w-full object-contain"
                                                        />
                                                    </div>
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

                                {/* Variants Selector */}
                                {variants.length > 0 && (
                                    <div className="mb-8">
                                        <label className="text-sm font-medium mb-3 block text-muted-foreground">Color</label>
                                        <div className="flex flex-wrap gap-3">
                                            {variants.map(variant => (
                                                <button
                                                    key={variant.id}
                                                    onClick={() => setSelectedVariant(variant)}
                                                    className={cn(
                                                        "h-10 w-10 rounded-full border-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all shadow-sm flex items-center justify-center relative",
                                                        selectedVariant?.id === variant.id ? "ring-2 ring-primary border-primary scale-110" : "border-border hover:border-primary/50",
                                                        variant.stock === 0 && "opacity-50 grayscale cursor-not-allowed"
                                                    )}
                                                    disabled={variant.stock === 0}
                                                    title={`${variant.color} (${variant.stock})`}
                                                >
                                                    <span
                                                        className={cn(
                                                            "h-full w-full rounded-full",
                                                            variant.color === 'Blanco' ? 'bg-white' :
                                                                variant.color === 'Negro' ? 'bg-black' :
                                                                    variant.color === 'Azul' ? 'bg-blue-500' :
                                                                        variant.color === 'Rojo' ? 'bg-red-500' :
                                                                            variant.color === 'Verde' ? 'bg-green-500' :
                                                                                variant.color === 'Rosa' ? 'bg-pink-500' :
                                                                                    variant.color === 'Violeta' ? 'bg-purple-500' :
                                                                                        variant.color === 'Amarillo' ? 'bg-yellow-500' :
                                                                                            variant.color === 'Naranja' ? 'bg-orange-500' :
                                                                                                variant.color === 'Gris' ? 'bg-gray-500' :
                                                                                                    'bg-gradient-to-tr from-gray-200 to-gray-400'
                                                        )}
                                                    />
                                                    {selectedVariant?.id === variant.id && (
                                                        <span className="absolute inset-0 flex items-center justify-center">
                                                            <div className={cn("h-2 w-2 rounded-full", variant.color === 'Blanco' ? "bg-black" : "bg-white")} />
                                                        </span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-2 font-medium">
                                            {selectedVariant ? selectedVariant.color : 'Selecciona un color'}
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="mt-8 pt-6 border-t border-border bg-card pb-2 md:pb-0">
                                <div className="flex items-center justify-between text-sm mb-4">
                                    <span className="text-muted-foreground">Disponibilidad:</span>
                                    {variants.length > 0 ? (
                                        <span className={cn(
                                            "font-medium",
                                            selectedVariant && selectedVariant.stock > 0 ? "text-green-600" : "text-muted-foreground"
                                        )}>
                                            {selectedVariant
                                                ? (selectedVariant.stock > 0 ? `${selectedVariant.stock} unidades` : 'Agotado')
                                                : `Selecciona un color (${variants.reduce((acc, v) => acc + v.stock, 0)} total)`}
                                        </span>
                                    ) : (
                                        <span className={cn(
                                            "font-medium",
                                            product.stock > 0 ? "text-green-600" : "text-destructive"
                                        )}>
                                            {product.stock > 0 ? `${product.stock} unidades` : 'Agotado'}
                                        </span>
                                    )}
                                </div>

                                <Button
                                    className="w-full h-12 text-lg rounded-xl shadow-lg shadow-primary/20"
                                    size="lg"
                                    disabled={variants.length > 0 ? (!selectedVariant || selectedVariant.stock === 0) : product.stock === 0}
                                    onClick={handleAddToCart}
                                >
                                    <ShoppingCart className="h-5 w-5 mr-2" />
                                    {variants.length > 0
                                        ? (!selectedVariant ? 'Seleccionar Color' : selectedVariant.stock > 0 ? 'Agregar al Carrito' : 'Sin Stock')
                                        : (product.stock > 0 ? 'Agregar al Carrito' : 'Sin Stock')
                                    }
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

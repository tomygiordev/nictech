import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShoppingCart, ChevronLeft, ChevronRight, X, MessageCircle } from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext, type CarouselApi } from '@/components/ui/carousel';
import { useCart } from '@/contexts/CartContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';


interface Product {
    id: string;
    name: string;
    price: number;
    original_price?: number | null;
    sale_expires_at?: string | null;
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

const COLOR_MAP: Record<string, string> = {
    'blanco': '#FFFFFF',
    'negro': '#000000',
    'azul': '#3B82F6',
    'celeste': '#67E8F9',
    'rojo': '#EF4444',
    'verde': '#22C55E',
    'rosa': '#EC4899',
    'violeta': '#A855F7',
    'amarillo': '#EAB308',
    'naranja': '#F97316',
    'gris': '#6B7280',
    'marron': '#92400E',
    'marrón': '#92400E',
    'dorado': '#F59E0B',
    'plateado': '#D1D5DB',
    'beige': '#D4B896',
    'turquesa': '#14B8A6',
    'bordo': '#881337',
    'bordó': '#881337',
    'lila': '#C084FC',
    'magenta': '#E879F9',
};

const getVariantColor = (colorName: string): string =>
    COLOR_MAP[colorName.toLowerCase()] ?? '#9CA3AF';

const isLightColor = (colorName: string): boolean => {
    const lightColors = ['blanco', 'amarillo', 'beige', 'plateado'];
    return lightColors.includes(colorName.toLowerCase());
};

export const ProductDetailModal = ({ product, isOpen, onClose }: ProductDetailModalProps) => {
    const { addToCart } = useCart();

    const [variants, setVariants] = useState<{ id: string, color: string, stock: number, image_url: string | null }[]>([]);
    const [selectedVariant, setSelectedVariant] = useState<{ id: string, color: string, stock: number, image_url: string | null } | null>(null);

    // Initial images from product
    const [images, setImages] = useState<string[]>([]);

    useEffect(() => {
        if (!product) return;

        // Reset state when a new product is opened
        setVariants([]);
        setSelectedVariant(null);
        api?.scrollTo(0);
        setCurrentImageIndex(0);

        const initialImages = [product.image_url, ...(product.additional_images || [])].filter(Boolean) as string[];
        setImages(initialImages);

        // Fetch variants if applicable
        const fetchVariants = async () => {
            const { data } = await supabase
                .from('product_variants' as any)
                .select('*')
                .eq('product_id', product.id);

            if (data && data.length > 0) {
                // Cast data to match state type
                const typedData = data as unknown as { id: string, color: string, stock: number, image_url: string | null }[];
                setVariants(typedData);
                // Auto select first variant if stock available
                const firstAvailable = typedData.find(v => v.stock > 0);
                if (firstAvailable) setSelectedVariant(firstAvailable);
            }
        };

        fetchVariants();
    }, [product]);

    useEffect(() => {
        if (!product) return;
        const initialImages = [product.image_url, ...(product.additional_images || [])].filter(Boolean) as string[];

        if (selectedVariant && selectedVariant.image_url) {
            // Check if invariant image is already in initialImages to avoid duplicates
            if (!initialImages.includes(selectedVariant.image_url)) {
                setImages([selectedVariant.image_url, ...initialImages]);
            } else {
                // Even if it exists, we might want to rotate it to first? 
                // For now, just setting it as the list if it's not there, or keeping list if it is.
                // Actually, if it is there, we should probably just make sure it's selected or first.
                // Let's justdeduplicate.
                const uniqueImages = Array.from(new Set([selectedVariant.image_url, ...initialImages]));
                setImages(uniqueImages);
            }
            setCurrentImageIndex(0); // Jump to variant image (which is now first)
            api?.scrollTo(0);
        } else {
            setImages(initialImages);
        }
    }, [selectedVariant, product]);


    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [api, setApi] = useState<CarouselApi>();
    const [lightboxApi, setLightboxApi] = useState<CarouselApi>();

    useEffect(() => {
        if (isOpen) {
            setCurrentImageIndex(0);
            api?.scrollTo(0);
        } else {
            setLightboxOpen(false);
            setSelectedVariant(null);
        }
    }, [isOpen, api]);

    useEffect(() => {
        if (!lightboxApi) return;

        const onSelect = () => {
            setCurrentImageIndex(lightboxApi.selectedScrollSnap());
        };

        lightboxApi.on("select", onSelect);

        return () => {
            lightboxApi.off("select", onSelect);
        };
    }, [lightboxApi]);

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
            toast.error('Por favor elige un color antes de agregar al carrito', { duration: 3000 });
            return;
        }

        const productName = variants.length > 0 && selectedVariant ? `${product.name} - ${selectedVariant.color}` : product.name;
        const mappedImageUrl = selectedVariant && selectedVariant.image_url ? selectedVariant.image_url : (product.image_url || null);

        addToCart({
            id: product.id,
            name: productName,
            price: product.price,
            maxStock: selectedVariant ? selectedVariant.stock : product.stock,
            image_url: mappedImageUrl,
        });

        toast.success(`${productName} se agregó a tu carrito`, { duration: 2000 });

        onClose();
    };

    if (!product) return null;

    const renderAddToCartFooter = (isMobile: boolean) => (
        <div className={cn(
            "pt-4 md:pt-6 border-t border-border/50 bg-background shrink-0 shadow-[0_-10px_20px_-15px_rgba(0,0,0,0.1)]",
            isMobile ? "md:hidden p-4 pb-6 w-full z-20 sticky bottom-0" : "hidden md:block p-6 md:p-8"
        )}>
            <div className="flex items-center justify-between text-sm mb-4">
                <span className="text-muted-foreground">Disponibilidad:</span>
                {variants.length > 0 ? (
                    <span className={cn(
                        "font-medium",
                        variants.some(v => v.stock > 0) ? (selectedVariant && selectedVariant.stock > 0 ? "text-green-600" : "text-muted-foreground") : "text-destructive"
                    )}>
                        {!variants.some(v => v.stock > 0)
                            ? 'Agotado temporalmente'
                            : selectedVariant
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
                className="w-full h-12 text-lg rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90"
                size="lg"
                disabled={variants.length > 0 ? (!selectedVariant || selectedVariant.stock === 0) : product.stock === 0}
                onClick={handleAddToCart}
            >
                <ShoppingCart className="h-5 w-5 mr-2" />
                {variants.length > 0
                    ? (!selectedVariant ? 'Seleccionar Color' : selectedVariant.stock > 0 ? 'Añadir a carrito' : 'Sin Stock')
                    : (product.stock > 0 ? 'Añadir a carrito' : 'Sin Stock')
                }
            </Button>
        </div>
    );

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="max-w-4xl p-0 gap-0 border-none shadow-2xl rounded-3xl max-h-[95vh] md:max-h-[600px] flex flex-col md:block overflow-hidden [&>button:last-child]:hidden">
                    <DialogTitle className="sr-only">Detalles del producto: {product.name}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Vista detallada del producto {product.name}, incluyendo precio, descripción y opciones de compra.
                    </DialogDescription>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-4 right-4 z-[60] bg-background/50 backdrop-blur-sm rounded-full shadow-sm hover:bg-background/80"
                        onClick={onClose}
                    >
                        <X className="h-5 w-5" />
                    </Button>

                    {/* Mobile Scroll Area vs Desktop Grid Layout */}
                    <div className="flex-1 overflow-y-auto md:overflow-hidden flex flex-col md:grid md:grid-cols-2 h-full">
                        {/* Image Gallery */}
                        <div className="relative bg-white flex items-center justify-center p-6 aspect-square md:aspect-auto md:h-full overflow-hidden shrink-0">

                            {images.length > 0 ? (
                                <Carousel key={images.join('|')} setApi={setApi} className="w-full h-full">
                                    <CarouselContent className="h-full ml-0">
                                        {images.map((image, index) => (
                                            <CarouselItem key={`${image}-${index}`} className="flex h-full items-center justify-center p-0 basis-full">
                                                <button
                                                    className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-white cursor-zoom-in group"
                                                    onClick={() => openLightbox(index)}
                                                    aria-label={`Ampliar imagen ${index + 1} de ${product.name}`}
                                                >
                                                    {/* Main Image */}
                                                    <div className="relative z-10 w-full h-full flex items-center justify-center p-4">
                                                        <img
                                                            src={image}
                                                            alt={`${product.name} - Imagen ${index + 1}`}
                                                            className="max-h-full max-w-full object-contain"
                                                        />
                                                    </div>
                                                </button>
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
                        <div className="flex flex-col md:h-[600px] overflow-visible md:overflow-hidden bg-background">
                            <div className="flex-1 p-6 md:p-8 md:overflow-y-auto pb-4">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-3">
                                            {product.category?.name || 'Producto'}
                                        </span>
                                        <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2 leading-tight pr-4">
                                            {product.name}
                                        </h2>
                                    </div>
                                </div>

                                <div className="mb-6">
                                    {product.original_price != null &&
                                     (!product.sale_expires_at || new Date(product.sale_expires_at) > new Date()) && (
                                        <p className="text-base text-muted-foreground line-through">
                                            $ {product.original_price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                    )}
                                    <span className="text-2xl md:text-3xl font-bold text-primary">
                                        $ {product.price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
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
                                {variants.length > 0 && variants.some(v => v.stock > 0) && (
                                    <div className="mb-0">
                                        <h3 className="text-sm font-medium mb-3 block text-muted-foreground">Color</h3>
                                        <div className="flex flex-wrap gap-3">
                                            {variants.filter(v => v.stock > 0).map(variant => (
                                                <button
                                                    key={variant.id}
                                                    onClick={() => setSelectedVariant(variant)}
                                                    className={cn(
                                                        "h-10 w-10 rounded-full border-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all shadow-sm flex items-center justify-center relative",
                                                        selectedVariant?.id === variant.id ? "ring-2 ring-primary border-primary scale-110" : "border-border hover:border-primary/50"
                                                    )}
                                                    title={`${variant.color} (${variant.stock} diponibles)`}
                                                >
                                                    <span
                                                        className="h-full w-full rounded-full border border-black/10"
                                                        style={{ backgroundColor: getVariantColor(variant.color) }}
                                                    />
                                                    {selectedVariant?.id === variant.id && (
                                                        <span className="absolute inset-0 flex items-center justify-center">
                                                            <div className={cn("h-2 w-2 rounded-full", isLightColor(variant.color) ? "bg-black" : "bg-white")} />
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

                            {/* Desktop Footer Render */}
                            {renderAddToCartFooter(false)}
                        </div>
                    </div>

                    {/* Mobile Footer Render */}
                    {renderAddToCartFooter(true)}
                </DialogContent>
            </Dialog>

            {/* Lightbox Overlay */}
            {lightboxOpen && (
                <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col animate-in fade-in duration-200">
                    <button
                        onClick={closeLightbox}
                        className="absolute top-4 right-4 text-white/70 hover:text-white p-2 hover:bg-white/10 rounded-full transition-colors z-[110]"
                        aria-label="Cerrar vista previa de imagen"
                    >
                        <X size={32} />
                    </button>

                    <div className="flex-1 flex items-center justify-center w-full relative">
                        {images.length > 0 && (
                            <Carousel
                                setApi={setLightboxApi}
                                opts={{ startIndex: currentImageIndex, loop: true }}
                                className="w-full h-full max-w-7xl mx-auto flex items-center justify-center"
                            >
                                <CarouselContent className="h-full ml-0">
                                    {images.map((image, index) => (
                                        <CarouselItem key={`lightbox-${image}-${index}`} className="flex h-full w-full items-center justify-center p-4 basis-full">
                                            <div className="relative w-full h-full flex items-center justify-center" onClick={closeLightbox}>
                                                <img
                                                    src={image}
                                                    alt={`Imagen ampliada ${index + 1}`}
                                                    className="max-h-full max-w-full object-contain cursor-zoom-out"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        </CarouselItem>
                                    ))}
                                </CarouselContent>
                                {images.length > 1 && (
                                    <>
                                        <CarouselPrevious className="left-4 bg-white/10 text-white hover:bg-white/20 hover:text-white border-none z-[110] hidden md:flex" />
                                        <CarouselNext className="right-4 bg-white/10 text-white hover:bg-white/20 hover:text-white border-none z-[110] hidden md:flex" />
                                    </>
                                )}
                            </Carousel>
                        )}
                    </div>

                    <div className="pb-8 text-center text-white/50 text-sm z-[110] pointer-events-none">
                        {currentImageIndex + 1} / {images.length}
                    </div>
                </div>
            )}
        </>
    );
};

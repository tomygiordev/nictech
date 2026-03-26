import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Tag, Search, X, Percent, DollarSign, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Product {
  id: string;
  name: string;
  price: number;
  original_price: number | null;
  sale_expires_at: string | null;
  image_url: string | null;
  category?: { name: string } | null;
}

type DiscountMode = 'percent' | 'fixed';

export const PromoManagement = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Form state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [mode, setMode] = useState<DiscountMode>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('products' as any)
      .select('id, name, price, original_price, sale_expires_at, image_url, category:categories(name)')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      toast({ title: 'Error', description: 'No se pudieron cargar los productos.', variant: 'destructive' });
    } else {
      setProducts((data as unknown as Product[]) || []);
    }
    setLoading(false);
  };

  const activePromos = useMemo(
    () => products.filter(p => p.original_price != null),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.category as any)?.name?.toLowerCase().includes(q)
    );
  }, [products, search]);

  const computedNewPrice = useMemo(() => {
    if (!selectedProduct || !discountValue) return null;
    const val = parseFloat(discountValue);
    if (isNaN(val) || val <= 0) return null;
    if (mode === 'percent') {
      if (val >= 100) return null;
      // Use original_price as base when product already has a promo, to avoid compounding discounts
      const basePrice = selectedProduct.original_price ?? selectedProduct.price;
      return basePrice * (1 - val / 100);
    }
    return val;
  }, [selectedProduct, discountValue, mode]);

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setDiscountValue('');
    setExpiresAt('');
    // If already has a promo, pre-fill
    if (product.original_price != null) {
      const existingDiscount = ((product.original_price - product.price) / product.original_price * 100).toFixed(0);
      setMode('percent');
      setDiscountValue(existingDiscount);
      if (product.sale_expires_at) {
        // Convert to local datetime-local format
        const d = new Date(product.sale_expires_at);
        const pad = (n: number) => String(n).padStart(2, '0');
        setExpiresAt(
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
        );
      }
    }
  };

  const handleSave = async () => {
    if (!selectedProduct || computedNewPrice === null) return;
    if (computedNewPrice <= 0) {
      toast({ title: 'Precio inválido', description: 'El precio final debe ser mayor a 0.', variant: 'destructive' });
      return;
    }

    setSaving(true);

    // Use the base price (original_price if already has promo, else current price)
    const basePrice = selectedProduct.original_price ?? selectedProduct.price;

    const { error } = await supabase
      .from('products' as any)
      .update({
        original_price: basePrice,
        price: Math.round(computedNewPrice * 100) / 100,
        sale_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      } as any)
      .eq('id', selectedProduct.id);

    if (error) {
      toast({ title: 'Error', description: 'No se pudo guardar la promo.', variant: 'destructive' });
    } else {
      toast({ title: 'Promo aplicada', description: `Descuento aplicado a "${selectedProduct.name}".` });
      setSelectedProduct(null);
      setDiscountValue('');
      setExpiresAt('');
      fetchProducts();
    }
    setSaving(false);
  };

  const handleRemovePromo = async (product: Product) => {
    if (!product.original_price) return;
    setSaving(true);

    const { error } = await supabase
      .from('products' as any)
      .update({
        price: product.original_price,
        original_price: null,
        sale_expires_at: null,
      } as any)
      .eq('id', product.id);

    if (error) {
      toast({ title: 'Error', description: 'No se pudo eliminar la promo.', variant: 'destructive' });
    } else {
      toast({ title: 'Promo eliminada', description: `Precio restaurado en "${product.name}".` });
      if (selectedProduct?.id === product.id) setSelectedProduct(null);
      fetchProducts();
    }
    setSaving(false);
  };

  return (
    <div className="space-y-8">
      {/* Active Promos */}
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          Promos activas
          {activePromos.length > 0 && (
            <Badge variant="secondary">{activePromos.length}</Badge>
          )}
        </h3>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : activePromos.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No hay promos activas.</p>
        ) : (
          <div className="grid gap-3">
            {activePromos.map(product => {
              const discount = product.original_price
                ? Math.round((product.original_price - product.price) / product.original_price * 100)
                : 0;
              const expired = product.sale_expires_at && new Date(product.sale_expires_at) < new Date();
              return (
                <div
                  key={product.id}
                  className={cn(
                    "flex items-center justify-between gap-4 p-4 rounded-xl border bg-card",
                    expired && "border-destructive/40 bg-destructive/5"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {product.image_url && (
                      <img src={product.image_url} alt={product.name} className="h-10 w-10 rounded-lg object-cover shrink-0 bg-muted" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-muted-foreground line-through text-xs">
                          ${product.original_price?.toLocaleString('es-AR')}
                        </span>
                        <span className="text-primary font-bold text-sm">
                          ${product.price.toLocaleString('es-AR')}
                        </span>
                        <Badge className="text-[10px] px-1.5 py-0 bg-green-500/15 text-green-700 border-green-300">
                          -{discount}%
                        </Badge>
                        {expired && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Vencida</Badge>
                        )}
                      </div>
                      {product.sale_expires_at && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Vence: {new Date(product.sale_expires_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSelectProduct(product)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleRemovePromo(product)}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* Create / Edit Promo */}
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Product selector */}
        <div>
          <h3 className="text-lg font-semibold mb-4">
            {selectedProduct ? 'Producto seleccionado' : 'Seleccionar producto'}
          </h3>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar producto..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="border rounded-xl overflow-hidden max-h-80 overflow-y-auto">
            {filteredProducts.map(product => (
              <button
                key={product.id}
                onClick={() => handleSelectProduct(product)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/60 transition-colors border-b border-border/50 last:border-0",
                  selectedProduct?.id === product.id && "bg-primary/10 hover:bg-primary/10"
                )}
              >
                {product.image_url && (
                  <img src={product.image_url} alt={product.name} className="h-8 w-8 rounded object-cover shrink-0 bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ${product.price.toLocaleString('es-AR')}
                    {product.original_price && (
                      <span className="ml-2 text-green-600 font-medium">• Con promo</span>
                    )}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Promo form */}
        <div>
          <h3 className="text-lg font-semibold mb-4">Configurar promo</h3>
          {!selectedProduct ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground border-2 border-dashed rounded-xl">
              <Tag className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">Seleccioná un producto</p>
            </div>
          ) : (
            <div className="space-y-5 bg-card border rounded-xl p-5">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm truncate max-w-[200px]">{selectedProduct.name}</p>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedProduct(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Precio actual:{' '}
                <span className="font-semibold text-foreground">
                  ${selectedProduct.price.toLocaleString('es-AR')}
                </span>
                {selectedProduct.original_price && (
                  <span className="ml-2 text-muted-foreground line-through">
                    (original: ${selectedProduct.original_price.toLocaleString('es-AR')})
                  </span>
                )}
              </p>

              {/* Mode selector */}
              <div>
                <Label className="mb-2 block">Tipo de descuento</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setMode('percent'); setDiscountValue(''); }}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors",
                      mode === 'percent'
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted border-border text-muted-foreground"
                    )}
                  >
                    <Percent className="h-4 w-4" />
                    % Descuento
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('fixed'); setDiscountValue(''); }}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors",
                      mode === 'fixed'
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted border-border text-muted-foreground"
                    )}
                  >
                    <DollarSign className="h-4 w-4" />
                    Precio final
                  </button>
                </div>
              </div>

              {/* Value input */}
              <div>
                <Label htmlFor="discount-value" className="mb-1.5 block">
                  {mode === 'percent' ? 'Porcentaje de descuento (%)' : 'Nuevo precio ($)'}
                </Label>
                <Input
                  id="discount-value"
                  type="number"
                  min="0"
                  max={mode === 'percent' ? 99 : undefined}
                  placeholder={mode === 'percent' ? 'ej: 20' : 'ej: 15000'}
                  value={discountValue}
                  onChange={e => setDiscountValue(e.target.value)}
                />
                {computedNewPrice !== null && (
                  <p className="text-xs text-green-600 font-medium mt-1.5">
                    Precio con descuento: ${computedNewPrice.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>

              {/* Optional expiry */}
              <div>
                <Label htmlFor="expires-at" className="mb-1.5 block">
                  Vencimiento <span className="text-muted-foreground font-normal">(opcional)</span>
                </Label>
                <Input
                  id="expires-at"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                />
                {expiresAt && (
                  <button
                    type="button"
                    onClick={() => setExpiresAt('')}
                    className="text-xs text-muted-foreground hover:text-foreground mt-1"
                  >
                    Sin vencimiento
                  </button>
                )}
              </div>

              <Button
                className="w-full"
                disabled={computedNewPrice === null || saving}
                onClick={handleSave}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Tag className="h-4 w-4 mr-2" />}
                {selectedProduct.original_price ? 'Actualizar promo' : 'Aplicar promo'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2, Package, Wallet, CreditCard, Landmark, Percent } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { ProductCard } from '@/components/shop/ProductCard';
import { ProductDetailModal } from '@/components/shop/ProductDetailModal';
import { supabase } from '@/integrations/supabase/client';

interface Category {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  category_id: string;
  price: number;
  original_price?: number | null;
  sale_expires_at?: string | null;
  stock: number;
  image_url: string | null;
  additional_images: string[] | null;
  description: string | null;
  category?: Category;
  tags: string[] | null;
  price_usd?: number | null;
}

export const Promos = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  useEffect(() => {
    const fetchPromos = async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category_id, price, price_usd, stock, image_url, additional_images, description, tags, original_price, sale_expires_at, category:categories(id, name), product_variants(image_url)')
        .gt('stock', 0)
        .order('created_at', { ascending: false });

      if (data) {
        const formatted: Product[] = data.map((item) => ({
          id: item.id,
          name: item.name,
          category_id: item.category_id,
          price: item.price,
          stock: item.stock,
          image_url: item.image_url || item.product_variants?.[0]?.image_url || null,
          additional_images: item.additional_images || [],
          description: item.description,
          category: item.category,
          tags: item.tags || [],
          original_price: item.original_price ?? null,
          sale_expires_at: item.sale_expires_at ?? null,
          price_usd: item.price_usd ?? null,
        }));

        // Filter only items that have an active promo discount
        const promoProducts = formatted.filter(product => {
          return product.original_price != null &&
            (!product.sale_expires_at || new Date(product.sale_expires_at) > new Date());
        });

        setProducts(promoProducts);
      }
      setLoading(false);
    };

    fetchPromos();
  }, []);

  return (
    <>
      <Helmet>
        <title>Promociones - Nictech | Descuentos en Tecnología</title>
        <meta name="description" content="Aprovechá nuestras promociones y ofertas por tiempo limitado en celulares, auriculares y accesorios con garantía oficial." />
      </Helmet>
      <Layout>
        {/* Header */}
        <section className="bg-muted/30 py-6 sm:py-8 border-b border-border/50">
          <div className="container-main">
            <div className="text-center max-w-3xl mx-auto">
              <span className="inline-block px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-medium mb-3">
                Ofertas Exclusivas
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
                Promociones Destacadas
              </h1>
              <p className="text-muted-foreground text-sm max-w-xl mx-auto">
                Equipate con la mejor tecnología al mejor precio del mercado
              </p>

              {/* Compact Medios de Pago */}
              <div className="flex flex-wrap justify-center gap-x-6 gap-y-3 max-w-4xl mx-auto mt-6 bg-card border border-border p-3 rounded-2xl shadow-sm text-[11px] sm:text-xs">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-[#009ee3] flex-shrink-0" />
                  <span className="text-muted-foreground"><strong className="text-foreground">Mercado Pago:</strong> Crédito/débito</span>
                </div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-muted-foreground"><strong className="text-foreground">Tarjetas:</strong> Visa, Mastercard</span>
                </div>
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-secondary flex-shrink-0" />
                  <span className="text-muted-foreground"><strong className="text-foreground">Transferencia:</strong> CBU/CVU</span>
                </div>
                <div className="flex items-center gap-2 border-t sm:border-t-0 sm:border-l border-border pl-0 sm:pl-4 dark:border-border/50">
                  <Percent className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">10% OFF Efectivo / Transferencia</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Catalog */}
        <section className="py-8 bg-background">
          <div className="container-main max-w-5xl">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Package className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  No hay promociones activas hoy
                </h3>
                <p className="text-muted-foreground text-sm">
                  Estamos renovando nuestro catálogo de ofertas. ¡Volvé a consultar pronto!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-6">
                {products.map((product) => (
                  <div
                    key={product.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      supabase.from('product_clicks').insert({ product_id: product.id });
                      setSelectedProduct(product);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        supabase.from('product_clicks').insert({ product_id: product.id });
                        setSelectedProduct(product);
                      }
                    }}
                    className="cursor-pointer text-left w-full outline-none transition-all duration-100 ease-out-default active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-2xl"
                    aria-label={`Ver detalles de ${product.name}`}
                  >
                    <ProductCard
                      id={product.id}
                      name={product.name}
                      price={product.price}
                      price_usd={product.price_usd}
                      original_price={product.original_price}
                      stock={product.stock}
                      image_url={product.image_url || undefined}
                      description={product.description || undefined}
                      category={product.category?.name || 'Varios'}
                      tags={product.tags}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </Layout>

      <ProductDetailModal
        product={selectedProduct}
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />
    </>
  );
};

export default Promos;

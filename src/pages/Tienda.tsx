import { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Search, Loader2, Package } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { ProductCard } from '@/components/shop/ProductCard';
import { ProductFilters } from '@/components/shop/ProductFilters';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  image_url: string | null;
  description: string | null;
}

const Tienda = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 2500]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setProducts(data);
    }
    setLoading(false);
  };

  const categories = useMemo(() => {
    return [...new Set(products.map(p => p.category))];
  }, [products]);

  const maxPrice = useMemo(() => {
    return Math.max(...products.map(p => p.price), 2500);
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = !selectedCategory || product.category === selectedCategory;
      const matchesPrice = product.price >= priceRange[0] && product.price <= priceRange[1];
      return matchesSearch && matchesCategory && matchesPrice;
    });
  }, [products, searchQuery, selectedCategory, priceRange]);

  return (
    <>
      <Helmet>
        <title>Tienda - NicTech | Tecnología con Garantía</title>
        <meta name="description" content="Compra smartphones, laptops, tablets y accesorios con garantía. Las mejores marcas al mejor precio en Lima, Perú." />
      </Helmet>
      <Layout>
        {/* Header */}
        <section className="bg-muted/50 py-12">
          <div className="container-main">
            <div className="text-center max-w-2xl mx-auto">
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                Nuestra Tienda
              </h1>
              <p className="text-muted-foreground text-lg mb-8">
                Encuentra los mejores productos de tecnología con garantía
              </p>

              {/* Search */}
              <div className="relative max-w-md mx-auto">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Buscar productos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-12 h-12 rounded-xl"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Content */}
        <section className="py-12">
          <div className="container-main">
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Filters */}
              <ProductFilters
                categories={categories}
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
                priceRange={priceRange}
                maxPrice={maxPrice}
                onPriceChange={setPriceRange}
                isOpen={filtersOpen}
                onToggle={() => setFiltersOpen(!filtersOpen)}
              />

              {/* Products Grid */}
              <div className="flex-1">
                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Package className="h-16 w-16 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      No se encontraron productos
                    </h3>
                    <p className="text-muted-foreground">
                      Intenta ajustar los filtros o buscar otro término
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-muted-foreground mb-6">
                      {filteredProducts.length} producto{filteredProducts.length !== 1 && 's'} encontrado{filteredProducts.length !== 1 && 's'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                      {filteredProducts.map((product) => (
                        <ProductCard
                          key={product.id}
                          id={product.id}
                          name={product.name}
                          price={product.price}
                          stock={product.stock}
                          image_url={product.image_url || undefined}
                          description={product.description || undefined}
                          category={product.category}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Tienda;

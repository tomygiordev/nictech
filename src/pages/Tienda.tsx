import { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Search, Loader2, Package } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { ProductDetailModal } from '@/components/shop/ProductDetailModal';
import { ProductCard } from '@/components/shop/ProductCard';
import { ProductFilters } from '@/components/shop/ProductFilters';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  stock: number;
  image_url: string | null;
  additional_images: string[] | null;
  description: string | null;
  category?: Category;
  tags: string[] | null;
}

const Tienda = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 0]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'default'>('default');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    const [productsRes, categoriesRes] = await Promise.all([
      supabase.from('products').select('*, category:categories(*)').order('created_at', { ascending: false }),
      supabase.from('categories' as any).select('*').order('name', { ascending: true }),
    ]);

    if (productsRes.data) {
      // Manual mapping to match Product interface with joined category
      const formattedProducts: Product[] = productsRes.data.map((item: any) => ({
        id: item.id,
        name: item.name,
        category_id: item.category_id,
        price: item.price,
        stock: item.stock,
        image_url: item.image_url,
        additional_images: item.additional_images || [],
        description: item.description,
        category: item.category, // This comes from the join
        tags: item.tags || []
      }));
      setProducts(formattedProducts);

      // Dynamic price range
      if (formattedProducts.length > 0) {
        const max = Math.max(...formattedProducts.map(p => p.price));
        setPriceRange([0, max]);
      }
    }
    if (categoriesRes.data) setCategories(categoriesRes.data as unknown as Category[]);
    setLoading(false);
  };

  // Categories are now fetched from DB, so we don't need to derive them from products

  const maxPrice = useMemo(() => {
    if (products.length === 0) return 0;
    return Math.max(...products.map(p => p.price));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const result = products.filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = !selectedCategory || product.category_id === selectedCategory;
      const matchesPrice = product.price >= priceRange[0] && product.price <= priceRange[1];
      return matchesSearch && matchesCategory && matchesPrice;
    });

    return result.sort((a, b) => {
      if (sortOrder === 'asc') return a.price - b.price;
      if (sortOrder === 'desc') return b.price - a.price;
      return 0;
    });
  }, [products, searchQuery, selectedCategory, priceRange, sortOrder]);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  return (
    <>
      <Helmet>
        <title>Tienda - Nictech | Tecnología con Garantía</title>
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
              {/* Filters & Sorting */}
              <div className="flex flex-col gap-4">
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
              </div>

              {/* Products Grid */}
              <div className="flex-1">
                <div className="flex justify-between items-center mb-6">
                  <p className="text-muted-foreground">
                    {filteredProducts.length} producto{filteredProducts.length !== 1 && 's'} encontrado{filteredProducts.length !== 1 && 's'}
                  </p>

                  <Select value={sortOrder} onValueChange={(value: any) => setSortOrder(value)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Ordenar por" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Relevancia</SelectItem>
                      <SelectItem value="asc">Menor precio</SelectItem>
                      <SelectItem value="desc">Mayor precio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

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
                        <div key={product.id} onClick={() => setSelectedProduct(product)} className="cursor-pointer">
                          <ProductCard
                            id={product.id}
                            name={product.name}
                            price={product.price}
                            stock={product.stock}
                            image_url={product.image_url || undefined}
                            description={product.description || undefined}
                            category={product.category?.name || 'Varios'}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
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

export default Tienda;

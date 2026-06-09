import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Search, Loader2, Package, Gift, Percent, ChevronRight, Wallet, CreditCard, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  original_price?: number | null;
  sale_expires_at?: string | null;
  stock: number;
  image_url: string | null;
  additional_images: string[] | null;
  description: string | null;
  category?: Category;
  tags: string[] | null;
  model_id?: string;
  brand_id?: string;
  condition?: string;
  price_usd?: number | null;
}

interface SmartphoneModel {
  id: string;
  name: string;
  brand_id: string;
}

interface Brand {
  id: string;
  name: string;
}

const Tienda = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 0]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'default' | 'popular'>('popular');
  const [clickCounts, setClickCounts] = useState<Map<string, number>>(new Map());

  // Pagination State
  const INITIAL_VISIBLE_COUNT = 15;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  // filter State
  const [models, setModels] = useState<SmartphoneModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);

  // Check category relationships
  const isSmartphoneCategory = useMemo(() => {
    if (!selectedCategory) return false;
    const cat = categories.find(c => c.id === selectedCategory);
    if (!cat) return false;
    const name = cat.name.toLowerCase();
    return name.includes('celular') || name.includes('smartphone') || name.includes('iphone');
  }, [selectedCategory, categories]);

  const isFundaCategory = useMemo(() => {
    if (!selectedCategory) return false;
    const cat = categories.find(c => c.id === selectedCategory);
    return !!cat && cat.name.toLowerCase().includes('funda');
  }, [selectedCategory, categories]);

  useEffect(() => {
    fetchProducts();
  }, []);

  // Apply ?q= URL param (from global search) to set searchQuery on load
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setSearchQuery(q);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Apply ?nombre= and ?marca= URL params when data is loaded
  useEffect(() => {
    const nombre = searchParams.get('nombre');
    const marca = searchParams.get('marca');
    if (!nombre && !marca) return;
    if (categories.length === 0) return;

    let applied = false;
    if (nombre) {
      if (nombre.toLowerCase() === 'promos') {
        setSelectedCategory('__promos__');
        applied = true;
      } else {
        const match = categories.find(c => c.name.toLowerCase() === nombre.toLowerCase());
        if (match) { setSelectedCategory(match.id); applied = true; }
      }
    }
    if (marca && brands.length > 0) {
      const match = brands.find(b => b.name.toLowerCase() === marca.toLowerCase());
      if (match) { setSelectedBrand(match.id); applied = true; }
    }
    if (applied) setSearchParams({}, { replace: true });
  }, [categories, brands, searchParams, setSearchParams]);

  const fetchProducts = async () => {
    const [productsRes, categoriesRes, modelsRes, brandsRes] = await Promise.all([
      supabase.from('products')
        .select('id, name, category_id, price, price_usd, stock, image_url, additional_images, description, tags, model_id, brand_id, condition, original_price, sale_expires_at, category:categories(id, name), product_variants(image_url)')
        .gt('stock', 0)
        .order('created_at', { ascending: false }),
      supabase.from('categories' as any).select('id, name').order('name', { ascending: true }),
      supabase.from('models' as any).select('id, name, brand_id, brand:brands(name)'),
      supabase.from('brands' as any).select('id, name').order('name', { ascending: true }),
    ]);

    if (productsRes.data) {
      const formattedProducts: Product[] = productsRes.data.map((item: any) => ({
        id: item.id,
        name: item.name,
        category_id: item.category_id,
        price: item.price,
        stock: item.stock,
        image_url: item.image_url || (item.product_variants as any[])?.[0]?.image_url || null,
        additional_images: item.additional_images || [],
        description: item.description,
        category: item.category,
        tags: item.tags || [],
        model_id: item.model_id,
        brand_id: item.brand_id,
        condition: item.condition,
        original_price: item.original_price ?? null,
        sale_expires_at: item.sale_expires_at ?? null,
        price_usd: item.price_usd ?? null,
      }));
      setProducts(formattedProducts);

      if (formattedProducts.length > 0) {
        const max = Math.max(...formattedProducts.map(p => p.price));
        setPriceRange([0, max]);
      }
    }

    if (categoriesRes.data) {
      setCategories(categoriesRes.data as unknown as Category[]);
    }

    if (modelsRes.data) {
      const formattedModels = (modelsRes.data as any[]).map((m: any) => ({
        id: m.id,
        name: `${m.brand?.name} ${m.name}`,
        brand_id: m.brand_id,
      })).sort((a, b) => a.name.localeCompare(b.name));
      setModels(formattedModels);
    }

    if (brandsRes.data) {
      setBrands(brandsRes.data as unknown as Brand[]);
    }

    // Fetch product click counts for "Más buscados" sort
    const { data: clickData } = await supabase.rpc('get_product_click_counts');
    if (clickData) {
      const map = new Map<string, number>();
      (clickData as any[]).forEach((row: any) => {
        map.set(row.product_id, row.click_count);
      });
      setClickCounts(map);
    }

    setLoading(false);
  };

  const maxPrice = useMemo(() => {
    if (products.length === 0) return 0;
    return Math.max(...products.map(p => p.original_price ?? p.price));
  }, [products]);

  const normalizeText = (text: string) => {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  };

  // Map model_id → brand_id
  const modelBrandMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) map.set(m.id, m.brand_id);
    return map;
  }, [models]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = normalizeText(searchQuery);
    const searchTerms = normalizedQuery.split(/\s+/).filter(Boolean);

    const getPropensityScore = (product: Product) => {
      let score = clickCounts.get(product.id) || 0;

      // 1. Promo boost: offers have higher sales propensity (boost by 5 points)
      const hasActivePromo = product.original_price != null &&
        (!product.sale_expires_at || new Date(product.sale_expires_at) > new Date());
      if (hasActivePromo) {
        score += 5;
      }

      // 2. Scarcity/Sales Velocity boost: low stock (1-5 units) implies high demand or urgency
      if (product.stock > 0 && product.stock <= 5) {
        score += (6 - product.stock);
      }

      // 3. Visual boost: products with images have much higher conversion propensity (boost by 3 points)
      if (product.image_url) {
        score += 3;
      }

      // 4. Category Value Boost: prioritize high-ticket items (Smartphones, PCs, Audio) over cheap accessories
      const categoryName = product.category?.name.toLowerCase() || '';
      if (categoryName.includes('smartphone') || categoryName.includes('celular') || categoryName.includes('iphone')) {
        score += 15;
      } else if (categoryName.includes('computadora') || categoryName.includes('pc') || categoryName.includes('notebook') || categoryName.includes('laptop')) {
        score += 12;
      } else if (categoryName.includes('parlante') || categoryName.includes('audio') || categoryName.includes('auricular')) {
        score += 8;
      } else if (categoryName.includes('entretenimiento') || categoryName.includes('consola')) {
        score += 6;
      }

      return score;
    };

    const result = products.filter(product => {
      const normalizedName = normalizeText(product.name);
      const normalizedDescription = normalizeText(product.description || '');
      const normalizedTags = (product.tags || []).map(tag => normalizeText(tag));

      const matchesSearch = searchTerms.every(term =>
        normalizedName.includes(term) ||
        normalizedDescription.includes(term) ||
        normalizedTags.some(tag => tag.includes(term))
      );

      let matchesCategory = true;
      if (selectedCategory) {
        const isPromos = selectedCategory === '__promos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'promos';
        const isCombos = selectedCategory === '__combos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'combos';

        if (isPromos) {
          const hasActivePromo = product.original_price != null &&
            (!product.sale_expires_at || new Date(product.sale_expires_at) > new Date());
          matchesCategory = hasActivePromo;
        } else if (isCombos) {
          matchesCategory = product.category?.name.toLowerCase() === 'combos';
        } else {
          matchesCategory = product.category_id === selectedCategory;
        }
      }

      const matchesModel = !selectedModel || product.model_id === selectedModel;
      const matchesBrand = !selectedBrand || (
        product.brand_id === selectedBrand ||
        (product.model_id != null && modelBrandMap.get(product.model_id) === selectedBrand)
      );
      const matchesCondition = !selectedCondition || product.condition === selectedCondition;
      const matchesTag = !selectedTag || (product.tags || []).includes(selectedTag);

      const matchesPrice = product.price >= priceRange[0] && product.price <= priceRange[1];

      return matchesSearch && matchesCategory && matchesPrice && matchesModel && matchesBrand && matchesCondition && matchesTag;
    });

    return result.sort((a, b) => {
      if (sortOrder === 'asc') return a.price - b.price;
      if (sortOrder === 'desc') return b.price - a.price;
      if (sortOrder === 'popular') {
        const scoreA = getPropensityScore(a);
        const scoreB = getPropensityScore(b);
        return scoreB - scoreA;
      }
      return 0;
    });
  }, [products, searchQuery, selectedCategory, priceRange, sortOrder, selectedModel, selectedBrand, selectedCondition, selectedTag, modelBrandMap, categories, clickCounts]);

  // Tags available for funda category
  const availableTags = useMemo(() => {
    if (!isFundaCategory) return [];
    const tagSet = new Set<string>();
    for (const p of products) {
      if (p.category_id === selectedCategory)
        (p.tags || []).forEach(t => tagSet.add(t));
    }
    return Array.from(tagSet).sort();
  }, [products, selectedCategory, isFundaCategory]);

  // Models filtered by selected brand and stock availability in the selected category
  const filteredModels = useMemo(() => {
    const activeModelIds = new Set<string>();
    
    for (const p of products) {
      if (selectedCategory) {
        const isPromos = selectedCategory === '__promos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'promos';
        const isCombos = selectedCategory === '__combos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'combos';

        let matchesCategory = true;
        if (isPromos) {
          const hasActivePromo = p.original_price != null &&
            (!p.sale_expires_at || new Date(p.sale_expires_at) > new Date());
          matchesCategory = hasActivePromo;
        } else if (isCombos) {
          matchesCategory = p.category?.name.toLowerCase() === 'combos';
        } else {
          matchesCategory = p.category_id === selectedCategory;
        }

        if (!matchesCategory) continue;
      }

      if (p.model_id) {
        activeModelIds.add(p.model_id);
      }
    }

    return models.filter(m => {
      if (!activeModelIds.has(m.id)) return false;
      if (selectedBrand && m.brand_id !== selectedBrand) return false;
      return true;
    });
  }, [models, products, selectedCategory, selectedBrand, categories]);

  // Brands filtered by stock availability in the selected category
  const filteredBrands = useMemo(() => {
    const activeBrandIds = new Set<string>();
    for (const p of products) {
      if (selectedCategory) {
        const isPromos = selectedCategory === '__promos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'promos';
        const isCombos = selectedCategory === '__combos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'combos';

        let matchesCategory = true;
        if (isPromos) {
          const hasActivePromo = p.original_price != null &&
            (!p.sale_expires_at || new Date(p.sale_expires_at) > new Date());
          matchesCategory = hasActivePromo;
        } else if (isCombos) {
          matchesCategory = p.category?.name.toLowerCase() === 'combos';
        } else {
          matchesCategory = p.category_id === selectedCategory;
        }

        if (!matchesCategory) continue;
      }

      if (p.brand_id) {
        activeBrandIds.add(p.brand_id);
      } else if (p.model_id) {
        const brandId = modelBrandMap.get(p.model_id);
        if (brandId) activeBrandIds.add(brandId);
      }
    }

    return brands.filter(b => activeBrandIds.has(b.id));
  }, [brands, products, selectedCategory, categories, modelBrandMap]);

  // Reset sub-filters when category changes
  useEffect(() => {
    setSelectedModel(null);
    setSelectedBrand(null);
    setSelectedCondition(null);
    setSelectedTag(null);
  }, [selectedCategory]);

  // Reset pagination when any filter changes
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [searchQuery, selectedCategory, priceRange, sortOrder, selectedModel, selectedBrand, selectedCondition, selectedTag]);

  const displayedProducts = useMemo(() => {
    return filteredProducts.slice(0, visibleCount);
  }, [filteredProducts, visibleCount]);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const showBanner = !selectedCategory && !selectedBrand && !selectedModel && !searchQuery && !selectedTag;

  return (
    <>
      <Helmet>
        <title>Tienda - Nictech | Tecnología con Garantía</title>
        <meta name="description" content="Compra smartphones, laptops, tablets y accesorios con garantía. Las mejores marcas al mejor precio." />
      </Helmet>
      <Layout>
        {/* Header */}
        <section className="shop-header-surface relative isolate overflow-hidden bg-muted/50 py-6 sm:py-8">
          <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
            <div className="shop-header-bottom-glow absolute inset-x-0 bottom-0 h-32 sm:h-36" />
            <div className="shop-header-grid absolute inset-0" />
            <div className="shop-header-corner-glow absolute -left-20 -top-24 h-72 w-72 rounded-full" />
            <div className="shop-header-warm-glow absolute -right-24 -top-20 h-72 w-72 rounded-full" />
            <div className="shop-header-noise absolute inset-0" />
          </div>

          <div className="container-main relative z-10">
            <div className="text-center max-w-2xl mx-auto">
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                Nuestra Tienda
              </h1>
              <p className="text-muted-foreground text-lg mb-6">
                Encuentra los mejores productos de tecnología con garantía
              </p>

              {/* Search bar */}
              <div className="relative max-w-md mx-auto mb-8 group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-300 pointer-events-none" />
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors duration-200" />
                  <Input
                    type="search"
                    placeholder="Buscar celulares, fundas, cargadores..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-12 h-12 rounded-xl bg-card/80 backdrop-blur-sm border-border hover:border-border/80 focus-visible:ring-primary focus-visible:border-primary/50 transition-all duration-200 shadow-sm"
                  />
                </div>
              </div>

              {/* Promos y Combos Quick Access (Emil Kowalski dynamic premium design) */}
              <div className="flex justify-center gap-4 mt-6">
                {/* Promos Link */}
                <Link
                  to="/promos"
                  className="group relative flex flex-col items-center justify-center w-28 h-28 rounded-2xl border bg-card/60 border-border backdrop-blur-sm text-muted-foreground hover:border-primary/30 hover:bg-muted/30 hover:text-foreground transition-all duration-250 ease-out-default active:scale-[0.96] shadow-sm select-none cursor-pointer outline-none overflow-hidden"
                >
                  <div className="flex items-center justify-center p-2.5 rounded-xl mb-2 transition-all duration-250 bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground">
                    <Percent className="h-5 w-5 transition-transform duration-250 group-hover:scale-110" />
                  </div>
                  <span className="text-xs tracking-wider uppercase font-semibold">Promos</span>
                </Link>

                {/* Combos Link */}
                <Link
                  to="/combos"
                  className="group relative flex flex-col items-center justify-center w-28 h-28 rounded-2xl border bg-card/60 border-border backdrop-blur-sm text-muted-foreground hover:border-primary/30 hover:bg-muted/30 hover:text-foreground transition-all duration-250 ease-out-default active:scale-[0.96] shadow-sm select-none cursor-pointer outline-none overflow-hidden"
                >
                  <div className="flex items-center justify-center p-2.5 rounded-xl mb-2 transition-all duration-250 bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground">
                    <Gift className="h-5 w-5 transition-transform duration-250 group-hover:scale-110" />
                  </div>
                  <span className="text-xs tracking-wider uppercase font-semibold">Combos</span>
                </Link>
              </div>

              {/* Medios de Pago representativos */}
              <div className="flex flex-wrap justify-center items-center gap-x-5 gap-y-2.5 mt-8 text-xs text-muted-foreground/80">
                <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">Medios de pago:</span>
                <div className="flex items-center gap-1.5 bg-card/40 backdrop-blur-sm border border-border/60 px-2.5 py-1 rounded-full">
                  <Wallet className="h-3.5 w-3.5 text-[#009ee3] flex-shrink-0" />
                  <span>Mercado Pago</span>
                </div>
                <div className="flex items-center gap-1.5 bg-card/40 backdrop-blur-sm border border-border/60 px-2.5 py-1 rounded-full">
                  <CreditCard className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span>Tarjetas</span>
                </div>
                <div className="flex items-center gap-1.5 bg-card/40 backdrop-blur-sm border border-border/60 px-2.5 py-1 rounded-full">
                  <Landmark className="h-3.5 w-3.5 text-secondary flex-shrink-0" />
                  <span>Transferencia</span>
                </div>
                <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
                  <Percent className="h-3.5 w-3.5 flex-shrink-0 animate-pulse" />
                  <span>10% OFF Transferencia</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Content */}
        <section className="py-12">
          <div className="container-main">

            {/* Tag filter pills for Fundas */}
            {isFundaCategory && availableTags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4 mb-8">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 outline-none ${
                    !selectedTag ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  Todos los tipos
                </button>
                {availableTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 outline-none ${
                      selectedTag === tag ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col lg:flex-row gap-8">
              {/* Filters Sidebar */}
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

                  models={(() => {
                    const catName = categories.find(c => c.id === selectedCategory)?.name.toLowerCase() || '';
                    return (catName.includes('funda') || catName.includes('vidrios') || catName.includes('protector') || catName.includes('cámara') || catName.includes('camara')) ? filteredModels : [];
                  })()}
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}

                  brands={isSmartphoneCategory || isFundaCategory ? filteredBrands : []}
                  selectedBrand={selectedBrand}
                  onBrandChange={(brandId) => { setSelectedBrand(brandId); setSelectedModel(null); }}

                  selectedCondition={selectedCondition}
                  onConditionChange={isSmartphoneCategory ? setSelectedCondition : undefined}
                />
              </div>

              {/* Products Grid */}
              <div className="flex-1">
                <div className="flex justify-between items-center mb-6">
                  <p className="text-muted-foreground">
                    {filteredProducts.length} producto{filteredProducts.length !== 1 && 's'} encontrado{filteredProducts.length !== 1 && 's'}
                  </p>

                  <Select value={sortOrder} onValueChange={(value: any) => setSortOrder(value)}>
                    <SelectTrigger className="w-[140px] sm:w-[180px]">
                      <SelectValue placeholder="Ordenar por" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Más recientes</SelectItem>
                      <SelectItem value="popular">Más buscados</SelectItem>
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-6">
                      {displayedProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => {
                            supabase.from('product_clicks').insert({ product_id: product.id });
                            setSelectedProduct(product);
                          }}
                          className="cursor-pointer text-left w-full outline-none transition-all duration-100 ease-out-default active:scale-[0.98]"
                          aria-label={`Ver detalles de ${product.name}`}
                        >
                          <ProductCard
                            id={product.id}
                            name={product.name}
                            price={product.price}
                            price_usd={product.price_usd}
                            original_price={
                              product.original_price != null &&
                              (!product.sale_expires_at || new Date(product.sale_expires_at) > new Date())
                                ? product.original_price
                                : null
                            }
                            stock={product.stock}
                            image_url={product.image_url || undefined}
                            description={product.description || undefined}
                            category={product.category?.name || 'Varios'}
                            tags={product.tags}
                          />
                        </button>
                      ))}
                    </div>

                    {visibleCount < filteredProducts.length && (
                      <div className="flex justify-center mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <button
                          onClick={() => setVisibleCount(prev => prev + INITIAL_VISIBLE_COUNT)}
                          className="px-8 py-3 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium transition-all shadow-sm flex items-center gap-2"
                        >
                          Cargar más productos
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    )}
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

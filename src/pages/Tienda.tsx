import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Search, Loader2, Package, LayoutGrid,
  Smartphone, Headphones, Cable, BatteryCharging,
  Gift, Monitor, ShieldCheck, Speaker, Layers,
  ChevronLeft, ChevronRight
} from 'lucide-react';
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

// Icon mapping for categories
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  smartphone: <Smartphone className="h-4 w-4" />,
  celular: <Smartphone className="h-4 w-4" />,
  iphone: <Smartphone className="h-4 w-4" />,
  auriculares: <Headphones className="h-4 w-4" />,
  'cables de datos': <Cable className="h-4 w-4" />,
  cables: <Cable className="h-4 w-4" />,
  cargadores: <BatteryCharging className="h-4 w-4" />,
  combos: <Gift className="h-4 w-4" />,
  computacion: <Monitor className="h-4 w-4" />,
  fundas: <ShieldCheck className="h-4 w-4" />,
  parlantes: <Speaker className="h-4 w-4" />,
  'vidrios templados': <Layers className="h-4 w-4" />,
};

const getCategoryIcon = (name: string) => {
  const lower = name.toLowerCase();
  return CATEGORY_ICONS[lower] || <Package className="h-4 w-4" />;
};

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
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'default' | 'popular'>('default');
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

  // Animated indicator state
  const categoryBarRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const updateIndicator = useCallback(() => {
    const key = selectedCategory || '__all__';
    const btn = buttonRefs.current.get(key);
    const bar = categoryBarRef.current;
    if (btn && bar) {
      const barRect = bar.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setIndicatorStyle({
        left: btnRect.left - barRect.left + bar.scrollLeft,
        width: btnRect.width,
      });
    }
  }, [selectedCategory]);

  useEffect(() => {
    // small delay to allow buttons to render
    const t = setTimeout(updateIndicator, 50);
    return () => clearTimeout(t);
  }, [selectedCategory, categories, updateIndicator]);

  // Scroll arrow visibility
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScrollArrows = useCallback(() => {
    const el = categoryBarRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 5);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 5);
  }, []);

  useEffect(() => {
    checkScrollArrows();
    const el = categoryBarRef.current;
    if (el) {
      el.addEventListener('scroll', checkScrollArrows, { passive: true });
      window.addEventListener('resize', checkScrollArrows);
      return () => {
        el.removeEventListener('scroll', checkScrollArrows);
        window.removeEventListener('resize', checkScrollArrows);
      };
    }
  }, [categories, checkScrollArrows]);

  const scrollCategories = useCallback((direction: 'left' | 'right') => {
    const el = categoryBarRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  }, []);

  // Check if selected category is smartphone related
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
        // @ts-ignore
        brand_id: item.brand_id,
        // @ts-ignore
        condition: item.condition,
        // @ts-ignore
        original_price: item.original_price ?? null,
        // @ts-ignore
        sale_expires_at: item.sale_expires_at ?? null,
        // @ts-ignore
        price_usd: item.price_usd ?? null,
      }));
      setProducts(formattedProducts);

      if (formattedProducts.length > 0) {
        const max = Math.max(...formattedProducts.map(p => p.price));
        setPriceRange([0, max]);
      }
    }

    if (categoriesRes.data) {
      let cats = categoriesRes.data as unknown as Category[];
      cats.sort((a, b) => {
        const aIsPhone = a.name.toLowerCase().includes('celular') || a.name.toLowerCase().includes('smartphone') || a.name.toLowerCase().includes('iphone');
        const bIsPhone = b.name.toLowerCase().includes('celular') || b.name.toLowerCase().includes('smartphone') || b.name.toLowerCase().includes('iphone');
        if (aIsPhone && !bIsPhone) return -1;
        if (!aIsPhone && bIsPhone) return 1;
        return a.name.localeCompare(b.name);
      });
      setCategories(cats);
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

  // Map model_id → brand_id para lookup O(1) — debe ir ANTES de filteredProducts
  const modelBrandMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) map.set(m.id, m.brand_id);
    return map;
  }, [models]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = normalizeText(searchQuery);
    const searchTerms = normalizedQuery.split(/\s+/).filter(Boolean);

    const result = products.filter(product => {
      const normalizedName = normalizeText(product.name);
      const normalizedDescription = normalizeText(product.description || '');
      const normalizedTags = (product.tags || []).map(tag => normalizeText(tag));

      const matchesSearch = searchTerms.every(term =>
        normalizedName.includes(term) ||
        normalizedDescription.includes(term) ||
        normalizedTags.some(tag => tag.includes(term))
      );

      // Filtro especial para "Promos" - mostrar solo productos con descuentos vigentes
      let matchesCategory = true;
      if (selectedCategory) {
        const isPromos = selectedCategory === '__promos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'promos';
        if (isPromos) {
          // Promos: solo productos con original_price y descuento no expirado
          const hasActivePromo = product.original_price != null &&
            (!product.sale_expires_at || new Date(product.sale_expires_at) > new Date());
          matchesCategory = hasActivePromo;
        } else {
          matchesCategory = product.category_id === selectedCategory;
        }
      }

      const matchesModel = !selectedModel || product.model_id === selectedModel;
      // Check brand directly (celulares) OR through model_id (fundas/vidrios/protectors)
      const matchesBrand = !selectedBrand || (
        product.brand_id === selectedBrand ||
        (product.model_id != null && modelBrandMap.get(product.model_id) === selectedBrand)
      );
      // @ts-ignore
      const matchesCondition = !selectedCondition || product.condition === selectedCondition;
      const matchesTag = !selectedTag || (product.tags || []).includes(selectedTag);

      const matchesPrice = product.price >= priceRange[0] && product.price <= priceRange[1];

      return matchesSearch && matchesCategory && matchesPrice && matchesModel && matchesBrand && matchesCondition && matchesTag;
    });

    return result.sort((a, b) => {
      if (sortOrder === 'asc') return a.price - b.price;
      if (sortOrder === 'desc') return b.price - a.price;
      if (sortOrder === 'popular') {
        const aClicks = clickCounts.get(a.id) || 0;
        const bClicks = clickCounts.get(b.id) || 0;
        return bClicks - aClicks;
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

  // Models filtered by selected brand (for fundas/vidrios/protectors)
  const filteredModels = useMemo(() => {
    if (!selectedBrand) return models;
    return models.filter(m => m.brand_id === selectedBrand);
  }, [models, selectedBrand]);

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

  return (
    <>
      <Helmet>
        <title>Tienda - Nictech | Tecnología con Garantía</title>
        <meta name="description" content="Compra smartphones, laptops, tablets y accesorios con garantía. Las mejores marcas al mejor precio." />
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

            {/* ── Sticky Glassmorphism Category Bar ── */}
            <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 mb-8">
              <div className="backdrop-blur-xl bg-background/70 border-b border-border/50 rounded-b-2xl shadow-sm py-3">
                <div className="relative">
                  {/* Left Arrow */}
                  {canScrollLeft && (
                    <button
                      onClick={() => scrollCategories('left')}
                      className="absolute left-0 top-0 bottom-0 z-10 flex items-center pl-1 pr-4 bg-gradient-to-r from-background/90 via-background/60 to-transparent rounded-l-2xl transition-opacity duration-200"
                      aria-label="Desplazar categorías a la izquierda"
                    >
                      <ChevronLeft className="h-5 w-5 text-foreground/70 hover:text-foreground transition-colors" />
                    </button>
                  )}

                  {/* Right Arrow */}
                  {canScrollRight && (
                    <button
                      onClick={() => scrollCategories('right')}
                      className="absolute right-0 top-0 bottom-0 z-10 flex items-center pr-1 pl-4 bg-gradient-to-l from-background/90 via-background/60 to-transparent rounded-r-2xl transition-opacity duration-200"
                      aria-label="Desplazar categorías a la derecha"
                    >
                      <ChevronRight className="h-5 w-5 text-foreground/70 hover:text-foreground transition-colors" />
                    </button>
                  )}

                  <div
                    ref={categoryBarRef}
                    className="relative overflow-x-auto hide-scrollbar"
                  >
                    {/* Animated sliding indicator */}
                    <div
                      className="absolute bottom-0 h-[3px] bg-primary rounded-full transition-all duration-300 ease-out"
                      style={{
                        left: indicatorStyle.left,
                        width: indicatorStyle.width,
                      }}
                    />

                    <div className="flex gap-1 sm:gap-2 w-max px-8">
                      {/* "Todas" Button */}
                      <button
                        ref={(el) => {
                          if (el) buttonRefs.current.set('__all__', el);
                        }}
                        onClick={() => setSelectedCategory(null)}
                        className={`
                          group relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                          transition-all duration-200 whitespace-nowrap select-none
                          focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 outline-none
                          ${!selectedCategory
                            ? 'text-primary bg-primary/10'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                          }
                        `}
                      >
                        <LayoutGrid className={`h-4 w-4 transition-transform duration-200 ${!selectedCategory ? 'scale-110' : 'group-hover:scale-110'}`} />
                        Todas
                      </button>

                      {categories.map((category) => {
                        const isActive = selectedCategory === category.id;
                        return (
                          <button
                            key={category.id}
                            ref={(el) => {
                              if (el) buttonRefs.current.set(category.id, el);
                            }}
                            onClick={() => setSelectedCategory(category.id)}
                            className={`
                              group relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                              transition-all duration-200 whitespace-nowrap select-none
                              focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 outline-none
                              ${isActive
                                ? 'text-primary bg-primary/10'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                              }
                            `}
                          >
                            <span className={`transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                              {getCategoryIcon(category.name)}
                            </span>
                            {category.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tag filter pills for Fundas */}
            {isFundaCategory && availableTags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
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

                  brands={isSmartphoneCategory || isFundaCategory ? brands : []}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                      {displayedProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => {
                            supabase.from('product_clicks').insert({ product_id: product.id });
                            setSelectedProduct(product);
                          }}
                          className="cursor-pointer text-left w-full"
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

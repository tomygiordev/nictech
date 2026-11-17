/* eslint-disable @typescript-eslint/no-explicit-any -- legacy storefront payload shape. */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Search,
  Loader2,
  Package,
  Gift,
  Percent,
  ChevronRight,
  Wallet,
  CreditCard,
  Landmark,
  ShoppingBag,
  Wrench,
  MapPin,
  Star,
  ClipboardList,
  MessageCircle,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { ProductDetailModal } from '@/components/shop/ProductDetailModal';
import { ProductCard } from '@/components/shop/ProductCard';
import { ProductFilters } from '@/components/shop/ProductFilters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from '@/integrations/supabase/client';
import { storefrontSupabase } from '@/integrations/supabase/types.extensions';
import { hasValidDiscount } from '@/lib/pricing';
import { useStorefrontPromotionPrices } from '@/hooks/use-storefront-promotion-prices';
import { resolveDisplayPrice } from '@/lib/promo-pricing';

interface Category {
  id: string;
  name: string;
}

interface ProductVariantSummary {
  id: string;
  price: number | null;
}

interface Product {
  id: string;
  name: string;
  category_id: string;
  price: number;
  legacy_price?: number;
  original_price?: number | null;
  legacy_original_price?: number | null;
  sale_expires_at?: string | null;
  legacy_sale_expires_at?: string | null;
  stock: number;
  image_url: string | null;
  additional_images: string[] | null;
  description: string | null;
  category?: Category;
  tags: string[] | null;
  model_id?: string;
  brand_id?: string;
  condition?: string | null;
  price_usd?: number | null;
  hasVariants?: boolean;
  variantPrices?: number[];
  activeVariants?: ProductVariantSummary[];
  hasPromo?: boolean;
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

const LOCAL_REVIEWS = [
  {
    id: 'maria-garcia',
    name: 'María García',
    role: 'Estudiante',
    content:
      'La verdad que me salvaron las papas. Se me murió la compu justo antes de una entrega y en un toque me la dejaron 0km. Super recomendables chicos.',
  },
  {
    id: 'carlos-lopez',
    name: 'Carlos López',
    role: 'Estudiante',
    content:
      'Un genio Nico. Le llevé mi PC para un upgrade y limpieza, quedó volando. Sin vueltas. Precio acorde.',
  },
  {
    id: 'ana-martinez',
    name: 'Ana Martínez',
    role: 'Cliente',
    content:
      'Pensé que había perdido todas las fotos de mis nenes cuando el celular dejó de prender de la nada, pero por suerte pudieron recuperar todo el contenido. La atención de 10, muy amables y profesionales.',
  },
] as const;

const slugifyProductName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const buildProductPath = (product: { id: string; name: string }): string => {
  const slug = slugifyProductName(product.name);
  return slug ? `/producto/${slug}--${product.id}` : `/producto/${product.id}`;
};

const findProductByParam = (param: string, items: Product[]): Product | null => {
  const directMatch = items.find((p) => p.id === param);
  if (directMatch) return directMatch;

  const separatorIdx = param.lastIndexOf('--');
  if (separatorIdx !== -1) {
    const extractedId = param.slice(separatorIdx + 2);
    const byExtractedId = items.find((p) => p.id === extractedId);
    if (byExtractedId) return byExtractedId;
  }

  return items.find((p) => slugifyProductName(p.name) === param) ?? null;
};

const Tienda = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { productId } = useParams<{ productId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
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
      storefrontSupabase.from('products')
        .select('id, name, category_id, price, price_usd, stock, image_url, additional_images, description, tags, model_id, brand_id, condition, original_price, sale_expires_at, category:categories(id, name), product_variants(*)')
        .eq('is_active', true)
        .gt('stock', 0)
        .order('created_at', { ascending: false }),
      supabase.from('categories' as any).select('id, name').order('name', { ascending: true }),
      supabase.from('models' as any).select('id, name, brand_id, brand:brands(name)'),
      supabase.from('brands' as any).select('id, name').order('name', { ascending: true }),
    ]);

    if (productsRes.data) {
      const formattedProducts: Product[] = productsRes.data.map((item: any) => {
        const activeVariants: ProductVariantSummary[] = (item.product_variants ?? [])
          .filter((v: { is_active?: boolean }) => v.is_active)
          .map((v: { id: string; price?: number | null }) => ({
            id: v.id,
            price: v.price ?? null,
          }));

        return {
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
          model_id: item.model_id,
          brand_id: item.brand_id,
          condition: item.condition,
          original_price: item.original_price ?? null,
          sale_expires_at: item.sale_expires_at ?? null,
          price_usd: item.price_usd ?? null,
          hasVariants: (item.product_variants?.length ?? 0) > 0,
          variantPrices: activeVariants.map((v) => v.price ?? item.price),
          activeVariants,
        };
      });
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

  const productIds = useMemo(() => products.map((product) => product.id), [products]);
  const { index: promotionIndex } = useStorefrontPromotionPrices(productIds);

  const resolvedProducts = useMemo(() => {
    return products.map((product) => {
      const resolvedBase = resolveDisplayPrice(
        {
          productId: product.id,
          legacyPrice: product.price,
          legacyOriginalPrice: product.original_price,
          legacySaleExpiresAt: product.sale_expires_at,
        },
        promotionIndex,
      );
      const resolvedVariants = (product.activeVariants ?? []).map((variant) =>
        resolveDisplayPrice(
          {
            productId: product.id,
            variantId: variant.id,
            legacyPrice: variant.price ?? product.price,
            legacyOriginalPrice: product.original_price,
            legacySaleExpiresAt: product.sale_expires_at,
          },
          promotionIndex,
        ),
      );
      const variantPrices = resolvedVariants.map((variant) => variant.price);
      const cheapestVariant =
        resolvedVariants.length > 0
          ? resolvedVariants.reduce((min, curr) => (curr.price < min.price ? curr : min))
          : null;
      const hasVariantErpPromo =
        resolvedBase.source === 'legacy' && cheapestVariant?.source === 'erp';
      const resolvedOriginalPrice = hasVariantErpPromo
        ? cheapestVariant.originalPrice
        : hasValidDiscount(resolvedBase)
          ? resolvedBase.originalPrice
          : null;
      const resolvedSaleExpiresAt = hasVariantErpPromo
        ? cheapestVariant.saleExpiresAt
        : resolvedBase.saleExpiresAt;
      const discountCheckPrice = hasVariantErpPromo
        ? cheapestVariant.price
        : resolvedBase.price;

      return {
        ...product,
        legacy_price: product.price,
        legacy_original_price: product.original_price ?? null,
        legacy_sale_expires_at: product.sale_expires_at ?? null,
        price: resolvedBase.price,
        original_price: resolvedOriginalPrice,
        sale_expires_at: resolvedSaleExpiresAt,
        variantPrices,
        hasPromo: hasValidDiscount({
          price: discountCheckPrice,
          originalPrice: resolvedOriginalPrice,
          saleExpiresAt: resolvedSaleExpiresAt,
        }),
      };
    });
  }, [products, promotionIndex]);

  const maxPrice = useMemo(() => {
    if (resolvedProducts.length === 0) return 0;
    return Math.max(
      ...resolvedProducts.map((p) =>
        p.hasPromo
          ? (p.original_price ?? p.price)
          : p.price
      )
    );
  }, [resolvedProducts]);

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
      const hasActivePromo = Boolean(product.hasPromo);
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

    const result = resolvedProducts.filter(product => {
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
          matchesCategory = Boolean(product.hasPromo);
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
  }, [resolvedProducts, searchQuery, selectedCategory, priceRange, sortOrder, selectedModel, selectedBrand, selectedCondition, selectedTag, modelBrandMap, categories, clickCounts]);

  // Tags available for funda category
  const availableTags = useMemo(() => {
    if (!isFundaCategory) return [];
    const tagSet = new Set<string>();
    for (const p of resolvedProducts) {
      if (p.category_id === selectedCategory)
        (p.tags || []).forEach(t => tagSet.add(t));
    }
    return Array.from(tagSet).sort();
  }, [resolvedProducts, selectedCategory, isFundaCategory]);

  // Models filtered by selected brand and stock availability in the selected category
  const filteredModels = useMemo(() => {
    const activeModelIds = new Set<string>();
    
    for (const p of resolvedProducts) {
      if (selectedCategory) {
        const isPromos = selectedCategory === '__promos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'promos';
        const isCombos = selectedCategory === '__combos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'combos';

        let matchesCategory = true;
        if (isPromos) {
          matchesCategory = Boolean(p.hasPromo);
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
  }, [models, resolvedProducts, selectedCategory, selectedBrand, categories]);

  // Brands filtered by stock availability in the selected category
  const filteredBrands = useMemo(() => {
    const activeBrandIds = new Set<string>();
    for (const p of resolvedProducts) {
      if (selectedCategory) {
        const isPromos = selectedCategory === '__promos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'promos';
        const isCombos = selectedCategory === '__combos__' ||
          categories.find(c => c.id === selectedCategory)?.name.toLowerCase() === 'combos';

        let matchesCategory = true;
        if (isPromos) {
          matchesCategory = Boolean(p.hasPromo);
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
  }, [brands, resolvedProducts, selectedCategory, categories, modelBrandMap]);

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

  const resolvedSelectedProduct = useMemo(
    () =>
      selectedProduct
        ? resolvedProducts.find((product) => product.id === selectedProduct.id) ?? selectedProduct
        : null,
    [selectedProduct, resolvedProducts],
  );

  // Sincroniza el producto abierto con la URL /producto/:productId
  useEffect(() => {
    if (loading) return;

    if (!productId) {
      if (!location.pathname.startsWith('/producto/')) {
        setSelectedProduct(null);
      }
      return;
    }

    const matchedProduct = findProductByParam(productId, resolvedProducts);
    setSelectedProduct(matchedProduct);
  }, [productId, resolvedProducts, loading, location.pathname]);

  const handleOpenProduct = (product: Product, trackClick = true) => {
    if (trackClick) {
      supabase.from('product_clicks').insert({ product_id: product.id });
    }
    setSelectedProduct(product);
    navigate(`/producto/${product.id}`, { replace: false });
  };

  const handleCloseProduct = () => {
    setSelectedProduct(null);
    if (location.pathname.startsWith('/producto/')) {
      navigate('/tienda', { replace: false });
    }
  };

  const selectedProductDescription = resolvedSelectedProduct
    ? (resolvedSelectedProduct.description?.trim() ||
      `${resolvedSelectedProduct.name} disponible en Nictech con garantía escrita en Urdinarrain y Gilbert, Entre Ríos. Envíos a todo el país.`)
    : '';

  const productJsonLd = resolvedSelectedProduct
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: resolvedSelectedProduct.name,
        description: selectedProductDescription,
        ...(resolvedSelectedProduct.image_url ? { image: [resolvedSelectedProduct.image_url] } : {}),
        offers: {
          '@type': 'Offer',
          priceCurrency: 'ARS',
          price: resolvedSelectedProduct.price,
          availability:
            resolvedSelectedProduct.stock > 0
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
          url: `https://nictech.com.ar/producto/${resolvedSelectedProduct.id}`,
        },
      }
    : null;

  const catalogJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Catálogo Nictech',
    itemListElement: displayedProducts.slice(0, 10).map((product, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `https://nictech.com.ar/producto/${product.id}`,
      name: product.name,
    })),
  };

  return (
    <>
      <Helmet>
        {selectedProduct ? (
          <>
            <title>{`${selectedProduct.name} | Tienda Nictech`}</title>
            <meta name="description" content={selectedProductDescription} />
            <meta property="og:title" content={`${selectedProduct.name} | Tienda Nictech`} />
            <meta property="og:description" content={selectedProductDescription} />
            <meta property="og:type" content="product" />
            <meta property="og:url" content={`https://nictech.com.ar/producto/${selectedProduct.id}`} />
            {selectedProduct.image_url && (
              <meta property="og:image" content={selectedProduct.image_url} />
            )}
            <script type="application/ld+json">{JSON.stringify(productJsonLd)}</script>
          </>
        ) : (
          <>
            <title>Nictech | Tienda de Celulares, Accesorios y Servicio Técnico en Urdinarrain y Gilbert</title>
            <meta
              name="description"
              content="Comprá celulares nuevos y usados seleccionados con garantía escrita, accesorios y computación, o repará tu equipo en nuestro servicio técnico en Urdinarrain y Gilbert, Entre Ríos. Envíos a todo el país."
            />
            <meta property="og:title" content="Nictech | Tienda de Tecnología y Servicio Técnico" />
            <meta
              property="og:description"
              content="Celulares con garantía escrita, accesorios y servicio técnico especializado en Urdinarrain y Gilbert, Entre Ríos. Envíos a todo el país."
            />
            <script type="application/ld+json">{JSON.stringify(catalogJsonLd)}</script>
          </>
        )}
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
            <div className="max-w-4xl mx-auto text-center">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground mb-3">
                Nictech: Tienda y Servicio Técnico
              </h1>

              {/* Indicador visible de sucursales locales */}
              <p className="inline-flex flex-wrap items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-card/85 border border-border text-xs sm:text-sm text-foreground/90 mb-6 shadow-sm">
                <MapPin className="h-4 w-4 text-primary shrink-0" />
                <span>
                  Sucursales en <strong>Urdinarrain</strong> (Héroes de Malvinas 08) y{' '}
                  <strong>Gilbert</strong> (C.5 y C.19), Entre Ríos · Retiro gratis o envíos a todo el país
                </span>
              </p>

              {/* Bloque dual: Tienda + Servicio Técnico */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 text-left mb-7">
                <div className="bg-card/90 border border-border rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                        <ShoppingBag className="h-4 w-4" />
                      </div>
                      <h2 className="text-base sm:text-lg font-semibold text-foreground leading-snug">
                        Comprá tecnología con garantía
                      </h2>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      Celulares nuevos y usados seleccionados con 90 días de garantía escrita, accesorios y computación · 10% OFF por transferencia.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href="#catalogo-tienda"
                      className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-xs sm:text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Ver catálogo
                    </a>
                    <Link
                      to="/promos"
                      className="inline-flex items-center justify-center min-h-[44px] px-3.5 rounded-xl border border-border bg-background text-foreground text-xs sm:text-sm font-medium hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Promos
                    </Link>
                  </div>
                </div>

                <div className="bg-card/90 border border-border rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary/10 text-secondary dark:text-sky-300 shrink-0">
                        <Wrench className="h-4 w-4" />
                      </div>
                      <h2 className="text-base sm:text-lg font-semibold text-foreground leading-snug">
                        Reparamos tu equipo
                      </h2>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      Cambio de pantalla, batería, pin de carga y microelectrónica en Urdinarrain y Gilbert.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Link
                      to="/servicios"
                      className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl bg-secondary text-secondary-foreground text-xs sm:text-sm font-medium hover:bg-secondary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Cotizar reparación
                    </Link>
                    <Link
                      to="/seguimiento"
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border border-border bg-background text-foreground text-xs sm:text-sm font-medium hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                      Seguimiento de equipo
                    </Link>
                  </div>
                </div>
              </div>

              {/* Search bar */}
              <div id="catalogo-tienda" className="relative max-w-md mx-auto mb-6 group scroll-mt-20">
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

              {/* Promos y Combos Quick Access */}
              <div className="flex justify-center gap-4 mt-5">
                {/* Promos Link */}
                <Link
                  to="/promos"
                  className="group relative flex flex-col items-center justify-center w-28 h-24 rounded-2xl border bg-card/60 border-border backdrop-blur-sm text-muted-foreground hover:border-primary/30 hover:bg-muted/30 hover:text-foreground transition-all duration-250 ease-out-default active:scale-[0.96] shadow-sm select-none cursor-pointer outline-none overflow-hidden"
                >
                  <div className="flex items-center justify-center p-2 rounded-xl mb-1.5 transition-all duration-250 bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground">
                    <Percent className="h-5 w-5 transition-transform duration-250 group-hover:scale-110" />
                  </div>
                  <span className="text-xs tracking-wider uppercase font-semibold">Promos</span>
                </Link>

                {/* Combos Link */}
                <Link
                  to="/combos"
                  className="group relative flex flex-col items-center justify-center w-28 h-24 rounded-2xl border bg-card/60 border-border backdrop-blur-sm text-muted-foreground hover:border-primary/30 hover:bg-muted/30 hover:text-foreground transition-all duration-250 ease-out-default active:scale-[0.96] shadow-sm select-none cursor-pointer outline-none overflow-hidden"
                >
                  <div className="flex items-center justify-center p-2 rounded-xl mb-1.5 transition-all duration-250 bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground">
                    <Gift className="h-5 w-5 transition-transform duration-250 group-hover:scale-110" />
                  </div>
                  <span className="text-xs tracking-wider uppercase font-semibold">Combos</span>
                </Link>
              </div>

              {/* Medios de Pago representativos */}
              <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2.5 mt-6 text-xs text-muted-foreground">
                <span className="text-[10px] uppercase tracking-wider font-semibold">Medios de pago:</span>
                <div className="flex items-center gap-1.5 bg-card/60 border border-border/60 px-2.5 py-1 rounded-full">
                  <Wallet className="h-3.5 w-3.5 text-[#009ee3] flex-shrink-0" />
                  <span>Mercado Pago</span>
                </div>
                <div className="flex items-center gap-1.5 bg-card/60 border border-border/60 px-2.5 py-1 rounded-full">
                  <CreditCard className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span>Tarjetas</span>
                </div>
                <div className="flex items-center gap-1.5 bg-card/60 border border-border/60 px-2.5 py-1 rounded-full">
                  <Landmark className="h-3.5 w-3.5 text-secondary flex-shrink-0" />
                  <span>Transferencia</span>
                </div>
                <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
                  <Percent className="h-3.5 w-3.5 flex-shrink-0" />
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
                        <div
                          key={product.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOpenProduct(product, true)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleOpenProduct(product, true);
                            }
                          }}
                          className="cursor-pointer text-left w-full outline-none transition-all duration-100 ease-out-default active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-2xl"
                          aria-label={`Ver detalles de ${product.name}`}
                        >
                          <ProductCard
                            id={product.id}
                            name={product.name}
                            price={product.price}
                            variantPrices={product.variantPrices}
                            price_usd={product.price_usd}
                            original_price={product.original_price}
                            sale_expires_at={product.sale_expires_at}
                            stock={product.stock}
                            image_url={product.image_url || undefined}
                            description={product.description || undefined}
                            category={product.category?.name || 'Varios'}
                            tags={product.tags}
                            condition={product.condition}
                            hasVariants={product.hasVariants}
                            onSelectVariant={() => handleOpenProduct(product, false)}
                          />
                        </div>
                      ))}
                    </div>

                    {visibleCount < filteredProducts.length && (
                      <div className="flex justify-center mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <Button
                          variant="secondary"
                          size="lg"
                          onClick={() => setVisibleCount(prev => prev + INITIAL_VISIBLE_COUNT)}
                          className="rounded-full px-8 gap-2 font-medium shadow-sm transition-all active:scale-[0.97]"
                        >
                          Cargar más productos
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Confianza local y opiniones de clientes */}
        <section className="py-10 sm:py-12 border-t border-border bg-muted/30">
          <div className="container-main">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-1.5">
                  Confianza local y opiniones de clientes
                </h2>
                <p className="text-sm text-muted-foreground">
                  Atención presencial y servicio técnico propio en Urdinarrain y Gilbert, Entre Ríos.
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button asChild variant="outline" className="min-h-[44px] rounded-xl gap-2 text-xs sm:text-sm">
                  <Link to="/contacto">
                    <MapPin className="h-4 w-4 text-primary shrink-0" />
                    Ver ubicaciones y horarios
                  </Link>
                </Button>
                <Button asChild variant="outline" className="min-h-[44px] rounded-xl gap-2 text-xs sm:text-sm">
                  <a
                    href="https://wa.me/5493446353769"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    Consultar por WhatsApp
                  </a>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8">
              {LOCAL_REVIEWS.map((review) => (
                <article
                  key={review.id}
                  className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-1 mb-3" aria-label="Calificación de 5 estrellas">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-warning text-warning" />
                      ))}
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">
                      "{review.content}"
                    </p>
                  </div>
                  <div className="pt-3 border-t border-border/60">
                    <p className="text-sm font-semibold text-foreground">{review.name}</p>
                    <p className="text-xs text-muted-foreground">{review.role}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="rounded-2xl bg-card border border-border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm text-muted-foreground">
              <div className="flex items-start sm:items-center gap-2.5">
                <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5 sm:mt-0" />
                <span>
                  <strong className="text-foreground font-medium">Urdinarrain:</strong> Héroes de Malvinas 08 ·{' '}
                  <strong className="text-foreground font-medium">Gilbert:</strong> C.5 y C.19, Entre Ríos
                </span>
              </div>
              <Link
                to="/contacto"
                className="text-primary font-medium hover:underline inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 shrink-0"
              >
                Cómo llegar y contacto
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </Layout>

      <ProductDetailModal
        product={resolvedSelectedProduct}
        isOpen={!!resolvedSelectedProduct}
        onClose={handleCloseProduct}
        promotionIndex={promotionIndex}
      />
    </>
  );
};

export default Tienda;

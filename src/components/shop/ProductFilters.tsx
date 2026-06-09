import { SlidersHorizontal, X, Percent, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface Category {
  id: string;
  name: string;
}

interface ProductFiltersProps {
  categories: Category[];
  selectedCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  priceRange: [number, number];
  maxPrice: number;
  onPriceChange: (range: [number, number]) => void;
  models?: { id: string; name: string }[];
  selectedModel?: string | null;
  onModelChange?: (modelId: string | null) => void;
  brands?: { id: string; name: string }[];
  selectedBrand?: string | null;
  onBrandChange?: (brandId: string | null) => void;
  selectedCondition?: string | null;
  onConditionChange?: (condition: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const ProductFilters = ({
  categories,
  selectedCategory,
  onCategoryChange,
  priceRange,
  maxPrice,
  onPriceChange,
  models = [],
  selectedModel,
  onModelChange,
  brands = [],
  selectedBrand,
  onBrandChange,
  selectedCondition,
  onConditionChange,
  isOpen,
  onToggle,
}: ProductFiltersProps) => {
  const clearFilters = () => {
    onCategoryChange(null);
    if (onModelChange) onModelChange(null);
    if (onBrandChange) onBrandChange(null);
    if (onConditionChange) onConditionChange(null);
    onPriceChange([0, maxPrice]);
  };

  return (
    <>
      {/* Mobile Filter Toggle */}
      <div className="lg:hidden mb-4">
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={onToggle}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
          </span>
          {(selectedCategory || priceRange[0] > 0 || priceRange[1] < maxPrice) && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              !
            </span>
          )}
        </Button>
      </div>

      {/* Filters Sidebar */}
      <aside
        className={cn(
          "lg:block lg:w-64 lg:flex-shrink-0",
          isOpen ? "block" : "hidden"
        )}
      >
        <div className="bg-card rounded-2xl border border-border p-6 lg:sticky lg:top-24">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
            </h3>
            {(selectedCategory || priceRange[0] > 0 || priceRange[1] < maxPrice || selectedModel || selectedBrand || selectedCondition) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={clearFilters}
              >
                <X className="h-4 w-4 mr-1" />
                Limpiar
              </Button>
            )}
          </div>

          {/* Categories Filter */}
          <div className="mb-8">
            <h4 className="text-sm font-medium text-foreground mb-3">Categorías</h4>
            <div className="space-y-1 max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
              <button
                onClick={() => onCategoryChange(null)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none",
                  !selectedCategory
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Todas las categorías
              </button>
              
              <button
                onClick={() => onCategoryChange('__promos__')}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none flex items-center gap-2",
                  selectedCategory === '__promos__'
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Percent className="h-3.5 w-3.5" />
                Promociones
              </button>

              <button
                onClick={() => onCategoryChange('__combos__')}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none flex items-center gap-2",
                  selectedCategory === '__combos__'
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Gift className="h-3.5 w-3.5" />
                Combos
              </button>

              {categories
                .filter(category => {
                  const name = category.name.toLowerCase();
                  return name !== 'promos' && name !== 'promociones' && name !== 'combos';
                })
                .map((category) => (
                  <button
                    key={category.id}
                    onClick={() => onCategoryChange(category.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none",
                      selectedCategory === category.id
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {category.name}
                  </button>
                ))
              }
            </div>
          </div>

          {/* Brand Filter - shown first */}
          {brands && brands.length > 0 && onBrandChange && (
            <div className="mb-8">
              <h4 className="text-sm font-medium text-foreground mb-3">Marca</h4>
              <div className="space-y-2">
                <button
                  onClick={() => onBrandChange(null)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none",
                    !selectedBrand
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  Todas las marcas
                </button>
                <div className="max-h-[200px] overflow-y-auto pr-2 custom-scrollbar space-y-1">
                  {brands.map((brand) => (
                    <button
                      key={brand.id}
                      onClick={() => onBrandChange(brand.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none",
                        selectedBrand === brand.id
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {brand.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Model Filter - shown after brand */}
          {models.length > 0 && onModelChange && (
            <div className="mb-8">
              <h4 className="text-sm font-medium text-foreground mb-3">Modelo</h4>
              <div className="space-y-2">
                <button
                  onClick={() => onModelChange(null)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none",
                    !selectedModel
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  Todos los modelos
                </button>
                <div className="max-h-[200px] overflow-y-auto pr-2 custom-scrollbar space-y-1">
                  {models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => onModelChange(model.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none",
                        selectedModel === model.id
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {model.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Condition Filter */}
          {onConditionChange && (
            <div className="mb-8">
              <h4 className="text-sm font-medium text-foreground mb-3">Estado</h4>
              <div className="space-y-2">
                <button
                  onClick={() => onConditionChange(null)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none",
                    !selectedCondition
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  Todos los estados
                </button>
                {['Nuevo', 'Usado', 'Reacondicionado'].map((condition) => (
                  <button
                    key={condition}
                    onClick={() => onConditionChange(condition)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-100 ease-out-default active:scale-[0.98] select-none",
                      selectedCondition === condition
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {condition}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Price Range */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">Rango de Precio</h4>
            <div className="px-2">
              <Slider
                value={priceRange}
                min={0}
                max={maxPrice}
                step={50}
                onValueChange={(value) => onPriceChange(value as [number, number])}
                className="mb-4"
              />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  $ {priceRange[0].toLocaleString('es-AR')}
                </span>
                <span className="text-sm font-medium">
                  $ {priceRange[1].toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface ProductFiltersProps {
  categories: string[];
  selectedCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  priceRange: [number, number];
  maxPrice: number;
  onPriceChange: (range: [number, number]) => void;
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
  isOpen,
  onToggle,
}: ProductFiltersProps) => {
  const clearFilters = () => {
    onCategoryChange(null);
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
            {(selectedCategory || priceRange[0] > 0 || priceRange[1] < maxPrice) && (
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

          {/* Categories */}
          <div className="mb-8">
            <h4 className="text-sm font-medium text-foreground mb-3">Categorías</h4>
            <div className="space-y-2">
              <button
                onClick={() => onCategoryChange(null)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  !selectedCategory
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Todas las categorías
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => onCategoryChange(category)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                    selectedCategory === category
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

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
                  S/ {priceRange[0]}
                </span>
                <span className="text-muted-foreground">
                  S/ {priceRange[1]}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

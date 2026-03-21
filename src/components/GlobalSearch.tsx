import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Wrench } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';

interface ProductResult {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
}

interface RepairResult {
  tracking_code: string;
  client_name: string;
  device_model: string;
  status: string;
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const GlobalSearch = ({ open, onOpenChange }: GlobalSearchProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<ProductResult[]>([]);
  const [repairs, setRepairs] = useState<RepairResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setProducts([]);
      setRepairs([]);
      return;
    }
    setLoading(true);
    try {
      const [productsRes, repairsRes] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, price, image_url')
          .ilike('name', `%${q}%`)
          .gt('stock', 0)
          .limit(6),
        supabase
          .from('repairs')
          .select('tracking_code, client_name, device_model, status')
          .or(`tracking_code.ilike.%${q}%,client_name.ilike.%${q}%,device_model.ilike.%${q}%`)
          .limit(4),
      ]);
      setProducts((productsRes.data as ProductResult[]) || []);
      setRepairs((repairsRes.data as RepairResult[]) || []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery('');
      setProducts([]);
      setRepairs([]);
    }
  }, [open]);

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpenChange]);

  const handleProductSelect = (product: ProductResult) => {
    onOpenChange(false);
    navigate('/tienda');
  };

  const handleRepairSelect = (repair: RepairResult) => {
    onOpenChange(false);
    navigate(`/seguimiento?codigo=${repair.tracking_code}`);
  };

  const hasResults = products.length > 0 || repairs.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Buscar productos, reparaciones... (Ctrl+K)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {!loading && query.trim().length >= 2 && !hasResults && (
          <CommandEmpty>Sin resultados para "{query}"</CommandEmpty>
        )}
        {query.trim().length < 2 && (
          <CommandEmpty>Escribe al menos 2 caracteres...</CommandEmpty>
        )}
        {loading && (
          <CommandEmpty>Buscando...</CommandEmpty>
        )}

        {products.length > 0 && (
          <CommandGroup heading="Productos">
            {products.map((product) => (
              <CommandItem
                key={product.id}
                value={product.name}
                onSelect={() => handleProductSelect(product)}
                className="flex items-center gap-3 cursor-pointer"
              >
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="h-8 w-8 rounded object-contain shrink-0 bg-muted"
                  />
                ) : (
                  <Package className="h-5 w-5 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground">${product.price.toLocaleString()}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {repairs.length > 0 && (
          <CommandGroup heading="Reparaciones">
            {repairs.map((repair) => (
              <CommandItem
                key={repair.tracking_code}
                value={`${repair.tracking_code} ${repair.client_name}`}
                onSelect={() => handleRepairSelect(repair)}
                className="flex items-center gap-3 cursor-pointer"
              >
                <Wrench className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{repair.tracking_code}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {repair.client_name} · {repair.device_model} · {repair.status}
                  </p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
};

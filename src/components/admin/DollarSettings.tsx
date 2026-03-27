import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { DollarSign, RefreshCw, Clock, AlertTriangle, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DollarSettingsData {
  rate: number;
  dollar_type: string;
  last_updated: string;
}

const DOLLAR_TYPES = [
  { key: 'blue', label: 'Blue' },
  { key: 'oficial', label: 'Oficial' },
  { key: 'bolsa', label: 'MEP/Bolsa' },
  { key: 'cripto', label: 'Cripto' },
];

// Hook exportable para usar el rate en otras partes
export const useDollarRate = () => {
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from('dollar_settings')
      .select('rate')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) setRate(Number((data as any).rate));
      });
  }, []);

  return rate;
};

export const DollarSettings = () => {
  const [settings, setSettings] = useState<DollarSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [affectedCount, setAffectedCount] = useState(0);

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from('dollar_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (data) setSettings(data as unknown as DollarSettingsData);

    // Count USD-priced products
    const { count } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .not('price_usd', 'is', null);
    setAffectedCount(count || 0);
    setLoading(false);
  }, []);

  // Core refresh logic — accepts optional dollar_type override and silent mode
  const refreshRate = useCallback(async (type?: string, silent = false) => {
    const dollarType = type || settings?.dollar_type || 'blue';
    try {
      const res = await supabase.functions.invoke('get-dollar-rate', {
        body: { type: dollarType },
      });
      if (res.error) throw new Error(res.error.message || 'No se pudo conectar con DolarAPI');
      const json = res.data;
      const newRate = Number(json.venta);
      if (!newRate || isNaN(newRate)) throw new Error('Respuesta inválida de DolarAPI');

      await supabase
        .from('dollar_settings')
        .update({ rate: newRate, last_updated: new Date().toISOString() })
        .eq('id', 1);

      const { data: usdProducts } = await supabase
        .from('products')
        .select('id, price_usd')
        .not('price_usd', 'is', null) as any;

      if (usdProducts && usdProducts.length > 0) {
        for (const p of usdProducts) {
          await supabase
            .from('products')
            .update({ price: Math.round(p.price_usd * newRate) } as any)
            .eq('id', p.id);
        }
      }

      if (!silent) {
        toast({
          title: '✓ Cotización actualizada',
          description: `Dólar ${dollarType}: $${newRate.toLocaleString('es-AR')} · ${usdProducts?.length || 0} producto(s) actualizados`,
        });
      }

      return newRate;
    } catch (err: any) {
      if (!silent) toast({ title: 'Error al actualizar cotización', description: err.message, variant: 'destructive' });
      return null;
    }
  }, [settings?.dollar_type]);

  // Auto-refresh on mount if stale (>1h), then every 60 min
  useEffect(() => {
    if (!settings) return;
    const STALE_MS = 60 * 60 * 1000; // 1 hora
    const lastUpdated = settings.last_updated ? new Date(settings.last_updated).getTime() : 0;
    const isStale = Date.now() - lastUpdated > STALE_MS;

    if (isStale) {
      refreshRate(settings.dollar_type, true).then(() => fetchSettings());
    }

    const interval = setInterval(() => {
      refreshRate(settings.dollar_type, true).then(() => fetchSettings());
    }, STALE_MS);

    return () => clearInterval(interval);
  }, [settings?.last_updated, settings?.dollar_type]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshRate();
    await fetchSettings();
    setRefreshing(false);
  };

  const handleTypeChange = async (type: string) => {
    await supabase.from('dollar_settings').update({ dollar_type: type }).eq('id', 1);
    setSettings(prev => prev ? { ...prev, dollar_type: type } : prev);
  };

  if (loading) return null;

  const lastUpdated = settings?.last_updated
    ? new Date(settings.last_updated).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'Nunca';

  const isStale = settings?.last_updated
    ? (Date.now() - new Date(settings.last_updated).getTime()) > 1000 * 60 * 60 // 1h
    : true;

  return (
    <div className="flex flex-wrap items-center gap-4 p-3 rounded-xl border bg-muted/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <DollarSign className="h-4 w-4 text-green-600" />
        <span>Dólar</span>
        <span className="font-bold text-lg text-green-700">
          ${settings?.rate ? Number(settings.rate).toLocaleString('es-AR') : '—'}
        </span>
      </div>

      {/* Type selector */}
      <div className="flex gap-1">
        {DOLLAR_TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => handleTypeChange(t.key)}
            className={cn(
              'px-2 py-0.5 rounded text-xs font-medium border transition-colors',
              settings?.dollar_type === t.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:border-primary/50'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>Actualizado: {lastUpdated}</span>
        {isStale && <AlertTriangle className="h-3 w-3 text-yellow-500" title="Cotización desactualizada (más de 4hs)" />}
      </div>

      {affectedCount > 0 && (
        <Badge variant="outline" className="text-xs gap-1">
          <TrendingUp className="h-3 w-3" />
          {affectedCount} producto{affectedCount !== 1 ? 's' : ''} en USD
        </Badge>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={handleRefresh}
        disabled={refreshing}
        className="ml-auto gap-2"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        {refreshing ? 'Actualizando...' : 'Actualizar cotización'}
      </Button>
    </div>
  );
};

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { GripVertical, Plus, Trash2, Loader2, Image as ImageIcon, ExternalLink, Eye, EyeOff, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Banner {
  id: string;
  image_url: string;
  link_url: string | null;
  alt_text: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export const BannerManagement = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // New banner form
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newAltText, setNewAltText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Interval setting
  const [intervalSeconds, setIntervalSeconds] = useState(5.0);
  const [savingInterval, setSavingInterval] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchBanners();
    fetchIntervalSetting();
  }, []);

  const fetchIntervalSetting = async () => {
    const { data } = await supabase
      .from('carousel_settings')
      .select('interval_seconds')
      .eq('id', 1)
      .single();
    if (data) setIntervalSeconds((data as any).interval_seconds ?? 5);
  };

  const handleSaveInterval = async () => {
    const val = parseFloat(String(intervalSeconds));
    if (isNaN(val) || val < 0.5 || val > 60) {
      toast({ title: 'Valor inválido', description: 'El intervalo debe estar entre 0.5 y 60 segundos.', variant: 'destructive' });
      return;
    }
    setSavingInterval(true);
    const { error } = await supabase
      .from('carousel_settings')
      .upsert({ id: 1, interval_seconds: val });
    if (error) {
      toast({ title: 'Error', description: 'No se pudo guardar.', variant: 'destructive' });
    } else {
      toast({ title: 'Guardado', description: `Intervalo actualizado a ${val} segundos.` });
    }
    setSavingInterval(false);
  };

  const fetchBanners = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('hero_banners')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      toast({ title: 'Error', description: 'No se pudieron cargar los banners.', variant: 'destructive' });
    } else {
      setBanners((data as Banner[]) || []);
    }
    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Error', description: 'Solo se permiten archivos de imagen.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    const ext = file.name.split('.').pop();
    const fileName = `banner_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('product_images')
      .upload(fileName, file, { upsert: true });

    if (uploadError) {
      toast({ title: 'Error al subir', description: uploadError.message, variant: 'destructive' });
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from('product_images')
      .getPublicUrl(fileName);

    setNewImageUrl(urlData.publicUrl);
    setUploading(false);
  };

  const handleAddBanner = async () => {
    if (!newImageUrl.trim()) {
      toast({ title: 'Error', description: 'Se requiere una imagen.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const maxOrder = banners.length > 0 ? Math.max(...banners.map(b => b.sort_order)) + 1 : 0;

    const { error } = await supabase
      .from('hero_banners')
      .insert({
        image_url: newImageUrl.trim(),
        link_url: newLinkUrl.trim() || null,
        alt_text: newAltText.trim() || '',
        sort_order: maxOrder,
        is_active: true,
      });

    if (error) {
      toast({ title: 'Error', description: 'No se pudo agregar el banner.', variant: 'destructive' });
    } else {
      toast({ title: 'Banner agregado' });
      setNewImageUrl('');
      setNewLinkUrl('');
      setNewAltText('');
      fetchBanners();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este banner?')) return;
    const { error } = await supabase.from('hero_banners').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: 'No se pudo eliminar.', variant: 'destructive' });
    } else {
      toast({ title: 'Banner eliminado' });
      fetchBanners();
    }
  };

  const toggleActive = async (banner: Banner) => {
    const { error } = await supabase
      .from('hero_banners')
      .update({ is_active: !banner.is_active })
      .eq('id', banner.id);

    if (error) {
      toast({ title: 'Error', variant: 'destructive' });
    } else {
      setBanners(prev =>
        prev.map(b => b.id === banner.id ? { ...b, is_active: !b.is_active } : b)
      );
    }
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setOverIndex(index);
  }, []);

  const handleDrop = useCallback(async (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }

    const updated = [...banners];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(targetIndex, 0, moved);

    // Update sort_order for all
    const reordered = updated.map((b, i) => ({ ...b, sort_order: i }));
    setBanners(reordered);
    setDragIndex(null);
    setOverIndex(null);

    // Save new order to DB
    for (const b of reordered) {
      await supabase.from('hero_banners').update({ sort_order: b.sort_order }).eq('id', b.id);
    }
  }, [dragIndex, banners]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  return (
    <div className="space-y-8">
      {/* Interval setting */}
      <div className="flex items-end gap-4 p-4 rounded-xl border bg-muted/30">
        <Timer className="h-5 w-5 text-primary mb-2 shrink-0" />
        <div>
          <Label className="mb-1.5 block">Tiempo entre diapositivas (segundos)</Label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0.5}
              max={60}
              step={0.5}
              value={intervalSeconds}
              onChange={e => setIntervalSeconds(parseFloat(e.target.value))}
              className="w-24"
            />
            <Button onClick={handleSaveInterval} disabled={savingInterval} size="sm" variant="outline">
              {savingInterval ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
            </Button>
            <span className="text-xs text-muted-foreground">Mín: 0.5s — Máx: 60s</span>
          </div>
        </div>
      </div>

      <hr className="border-border" />

      {/* Add new banner */}
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          Agregar banner
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div className="sm:col-span-2 lg:col-span-1">
            <Label className="mb-1.5 block">Imagen</Label>
            <div className="flex gap-2">
              <Input
                placeholder="URL de imagen"
                value={newImageUrl}
                onChange={e => setNewImageUrl(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Subir imagen"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block">Link (opcional)</Label>
            <Input
              placeholder="https://..."
              value={newLinkUrl}
              onChange={e => setNewLinkUrl(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Texto alt (opcional)</Label>
            <Input
              placeholder="Descripción del banner"
              value={newAltText}
              onChange={e => setNewAltText(e.target.value)}
            />
          </div>
          <Button onClick={handleAddBanner} disabled={saving || !newImageUrl.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Agregar
          </Button>
        </div>

        {newImageUrl && (
          <div className="mt-3 rounded-lg overflow-hidden border bg-muted max-w-xs">
            <img src={newImageUrl} alt="Preview" className="w-full h-24 object-cover" />
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* Banner list */}
      <div>
        <h3 className="text-lg font-semibold mb-4">
          Banners ({banners.length})
          <span className="text-sm font-normal text-muted-foreground ml-2">
            Arrastrá para reordenar
          </span>
        </h3>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : banners.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No hay banners. Agregá uno arriba.</p>
        ) : (
          <div className="space-y-2">
            {banners.map((banner, index) => (
              <div
                key={banner.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={cn(
                  'flex items-center gap-4 p-3 rounded-xl border bg-card transition-all',
                  dragIndex === index && 'opacity-50 scale-[0.98]',
                  overIndex === index && dragIndex !== index && 'border-primary border-2',
                  !banner.is_active && 'opacity-60'
                )}
              >
                <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                  <GripVertical className="h-5 w-5" />
                </div>

                <img
                  src={banner.image_url}
                  alt={banner.alt_text || 'Banner'}
                  className="h-16 w-28 rounded-lg object-cover bg-muted shrink-0"
                />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {banner.alt_text || 'Sin descripción'}
                  </p>
                  {banner.link_url && (
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" />
                      {banner.link_url}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Orden: {banner.sort_order + 1}
                  </p>
                </div>

                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => toggleActive(banner)}
                    title={banner.is_active ? 'Desactivar' : 'Activar'}
                  >
                    {banner.is_active ? (
                      <Eye className="h-4 w-4 text-green-600" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(banner.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

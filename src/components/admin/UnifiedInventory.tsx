
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  Loader2, Plus, Save, Upload, X, Search, Filter,
  Smartphone, Package, Layers, Tag, Pencil, Trash2, Image as ImageIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSettings, useDollarRate } from './DollarSettings';
import { BrandModelSelector } from './BrandModelSelector';
import { CreatableAttributeSelector } from './CreatableAttributeSelector';
import { CreatableResourceSelector } from './CreatableResourceSelector';
import { getProductType, TYPE_META, PHONE_KEYWORDS, CASE_KEYWORDS, type ProductType } from '@/lib/productTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; }

interface ProductVariantRow { id: string; color: string; stock: number; image_url: string | null; }

interface InventoryProduct {
  id: string;
  name: string;
  category_id: string;
  price: number;
  price_usd: number | null;
  stock: number;
  image_url: string | null;
  additional_images: string[] | null;
  description: string | null;
  tags: string[] | null;
  is_active: boolean | null;
  brand_id: string | null;
  model_id: string | null;
  capacity: string | null;
  color: string | null;
  condition: string | null;
  brand_name: string | null;
  model_name: string | null;
  category: Category | null;
}

type ProductType = 'phone' | 'case' | 'variant' | 'generic';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  phone:   <Smartphone className="h-3 w-3" />,
  case:    <Layers className="h-3 w-3" />,
  variant: <Layers className="h-3 w-3" />,
  generic: <Package className="h-3 w-3" />,
};

const getType = (p: InventoryProduct, variantIds: Set<string>) =>
  getProductType(p.category?.name, variantIds, p.id);

// ─── Upload helper ────────────────────────────────────────────────────────────

async function uploadImageFile(file: File): Promise<string> {
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ALLOWED.includes(file.type)) throw new Error('Tipo de archivo no permitido.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Archivo demasiado grande (máx 5MB).');
  const ext = file.name.split('.').pop()?.toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('product_images').upload(fileName, file);
  if (error) throw error;
  return supabase.storage.from('product_images').getPublicUrl(fileName).data.publicUrl;
}

// ─── Price Toggle ─────────────────────────────────────────────────────────────

function PriceToggle({
  currency, onToggle, value, onChange, rate, placeholder
}: {
  currency: 'ARS' | 'USD';
  onToggle: (c: 'ARS' | 'USD') => void;
  value: string;
  onChange: (v: string) => void;
  rate: number | null;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <div className={`flex rounded-lg border-2 overflow-hidden transition-colors ${currency === 'USD' ? 'border-green-500' : 'border-border'}`}>
        <div className={`flex flex-col border-r ${currency === 'USD' ? 'border-green-500' : 'border-border'}`}>
          <button type="button" onClick={() => onToggle('ARS')}
            className={`flex-1 px-2 text-xs font-bold transition-colors ${currency === 'ARS' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
            ARS
          </button>
          <button type="button" onClick={() => onToggle('USD')}
            className={`flex-1 px-2 text-xs font-bold transition-colors ${currency === 'USD' ? 'bg-green-600 text-white' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
            USD
          </button>
        </div>
        <input type="number" step="0.01" min="0"
          placeholder={placeholder ?? (currency === 'USD' ? '0.00' : '0')}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 px-3 py-2 text-sm bg-background outline-none w-0 min-w-0"
        />
      </div>
      {currency === 'USD' && (
        <p className="text-xs text-green-700 dark:text-green-400 px-1">
          {value && rate
            ? `≈ $${Math.round(parseFloat(value) * rate).toLocaleString('es-AR')} ARS (cotiz. ${rate.toLocaleString('es-AR')})`
            : 'Ingresá monto en USD'}
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const UnifiedInventory = () => {
  const dollarRate = useDollarRate();

  // ── Data ──────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [variantIds, setVariantIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Edit mode ─────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ProductType | null>(null);
  const [saving, setSaving] = useState(false);

  // Phone edit state
  const [phoneEdit, setPhoneEdit] = useState({
    brand_id: '', brand_name: '', model_id: '', model_name: '',
    capacity: '', color: '', condition: 'Nuevo',
    priceCurrency: 'ARS' as 'ARS' | 'USD', price: '', price_usd: '',
    stock: '',
  });

  // Generic / case / variant product-level edit state (also used for ADD)
  const [form, setForm] = useState({
    name: '', category_id: '', description: '',
    priceCurrency: 'ARS' as 'ARS' | 'USD', price: '', price_usd: '',
    stock: '',
    image_url: '', image_file: null as File | null,
    additional_images: [] as string[], additional_image_files: [] as File[],
    tags: [] as string[], tagInput: '',
  });
  const [uploadingImage, setUploadingImage] = useState(false);

  // Variant stocks for case/variant editing
  const [editVariants, setEditVariants] = useState<ProductVariantRow[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [variantStockEdits, setVariantStockEdits] = useState<Record<string, string>>({});

  // ── Filters ───────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | ProductType>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStock, setFilterStock] = useState<'all' | 'low' | 'out'>('all');
  const [showFilters, setShowFilters] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    const [prodRes, varRes, catRes] = await Promise.all([
      (supabase as any).from('products')
        .select('*, category:categories(*), brands(name), models(name)')
        .order('created_at', { ascending: false }),
      (supabase as any).from('product_variants').select('product_id'),
      (supabase as any).from('categories').select('*').order('name'),
    ]);

    if (prodRes.data) {
      const mapped: InventoryProduct[] = prodRes.data.map((item: any) => ({
        id: item.id, name: item.name, category_id: item.category_id,
        price: item.price, price_usd: item.price_usd ?? null,
        stock: item.stock, image_url: item.image_url,
        additional_images: item.additional_images || [],
        description: item.description, tags: item.tags || [],
        is_active: item.is_active, brand_id: item.brand_id,
        model_id: item.model_id, capacity: item.capacity,
        color: item.color, condition: item.condition,
        brand_name: item.brands?.name ?? null,
        model_name: item.models?.name ?? null,
        category: item.category,
      }));
      setProducts(mapped);
    }
    if (varRes.data) setVariantIds(new Set((varRes.data as any[]).map((v: any) => v.product_id)));
    if (catRes.data) setCategories(catRes.data as Category[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Select product ────────────────────────────────────────────────────
  const selectProduct = async (p: InventoryProduct) => {
    const type = getType(p, variantIds);
    setSelectedId(p.id);
    setSelectedType(type);
    setEditVariants([]);
    setVariantStockEdits({});

    if (type === 'phone') {
      const hasUsd = p.price_usd != null;
      setPhoneEdit({
        brand_id: p.brand_id || '',
        brand_name: p.brand_name || '',
        model_id: p.model_id || '',
        model_name: p.model_name || '',
        capacity: p.capacity || '',
        color: p.color || '',
        condition: p.condition || 'Nuevo',
        priceCurrency: hasUsd ? 'USD' : 'ARS',
        price: hasUsd ? '' : p.price.toString(),
        price_usd: hasUsd ? p.price_usd!.toString() : '',
        stock: p.stock.toString(),
      });
    } else {
      const hasUsd = p.price_usd != null;
      setForm({
        name: p.name, category_id: p.category_id,
        description: p.description || '',
        priceCurrency: hasUsd ? 'USD' : 'ARS',
        price: hasUsd ? '' : p.price.toString(),
        price_usd: hasUsd ? p.price_usd!.toString() : '',
        stock: p.stock.toString(),
        image_url: p.image_url || '', image_file: null,
        additional_images: p.additional_images || [],
        additional_image_files: [],
        tags: p.tags || [], tagInput: '',
      });

      if (type === 'case' || type === 'variant') {
        setLoadingVariants(true);
        const { data } = await (supabase as any)
          .from('product_variants').select('id, color, stock, image_url')
          .eq('product_id', p.id).order('color');
        const rows = (data || []) as ProductVariantRow[];
        setEditVariants(rows);
        setVariantStockEdits(Object.fromEntries(rows.map(v => [v.id, v.stock.toString()])));
        setLoadingVariants(false);
      }
    }
  };

  const clearSelection = () => {
    setSelectedId(null);
    setSelectedType(null);
    setEditVariants([]);
    setVariantStockEdits({});
    setForm({
      name: '', category_id: '', description: '',
      priceCurrency: 'ARS', price: '', price_usd: '',
      stock: '', image_url: '', image_file: null,
      additional_images: [], additional_image_files: [],
      tags: [], tagInput: '',
    });
  };

  // ── Save phone ────────────────────────────────────────────────────────
  const savePhone = async () => {
    setSaving(true);
    try {
      const priceUsd = phoneEdit.priceCurrency === 'USD' ? parseFloat(phoneEdit.price_usd) || null : null;
      const price = phoneEdit.priceCurrency === 'ARS'
        ? parseFloat(phoneEdit.price) || 0
        : (priceUsd && dollarRate ? Math.round(priceUsd * dollarRate) : 0);
      const name = [phoneEdit.brand_name, phoneEdit.model_name, phoneEdit.capacity, phoneEdit.color, `(${phoneEdit.condition})`]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ');

      const { error } = await (supabase as any).from('products').update({
        name, price, price_usd: priceUsd,
        stock: parseInt(phoneEdit.stock) || 0,
        brand_id: phoneEdit.brand_id || null,
        model_id: phoneEdit.model_id || null,
        capacity: phoneEdit.capacity || null,
        color: phoneEdit.color || null,
        condition: phoneEdit.condition || null,
      }).eq('id', selectedId);
      if (error) throw error;
      toast({ title: 'Celular actualizado' });
      clearSelection(); fetchAll();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  // ── Save generic / case / variant product ────────────────────────────
  const saveGeneric = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      let finalImage = form.image_url;
      if (form.image_file) finalImage = await uploadImageFile(form.image_file);

      const existingUrls = form.additional_images.filter(u => !u.startsWith('blob:'));
      const newUrls = await Promise.all(form.additional_image_files.map(uploadImageFile));
      const allImages = [...existingUrls, ...newUrls];

      const priceUsd = form.priceCurrency === 'USD' ? parseFloat(form.price_usd) || null : null;
      const price = form.priceCurrency === 'ARS'
        ? parseFloat(form.price) || 0
        : (priceUsd && dollarRate ? Math.round(priceUsd * dollarRate) : 0);

      const payload: any = {
        name: form.name, category_id: form.category_id,
        price, price_usd: priceUsd,
        stock: parseInt(form.stock) || 0,
        description: form.description || null,
        image_url: finalImage || null,
        additional_images: allImages,
        tags: form.tags,
      };

      if (selectedId) {
        const { error } = await (supabase as any).from('products').update(payload).eq('id', selectedId);
        if (error) throw error;
        toast({ title: 'Producto actualizado' });
      } else {
        const { error } = await (supabase as any).from('products').insert(payload);
        if (error) throw error;
        toast({ title: 'Producto agregado' });
      }
      clearSelection(); fetchAll();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  // ── Save variant stock inline ─────────────────────────────────────────
  const saveVariantStock = async (variantId: string) => {
    const newStock = parseInt(variantStockEdits[variantId]) ?? 0;
    const { error } = await (supabase as any).from('product_variants')
      .update({ stock: newStock }).eq('id', variantId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    setEditVariants(prev => prev.map(v => v.id === variantId ? { ...v, stock: newStock } : v));
    toast({ title: 'Stock actualizado' });
  };

  // ── Image helpers ─────────────────────────────────────────────────────
  const handleMainImage = (e: React.ChangeEvent<HTMLInputElement>, isAdditional: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    const preview = URL.createObjectURL(file);
    if (!isAdditional) {
      setForm(f => ({ ...f, image_url: preview, image_file: file }));
    } else {
      setForm(f => ({ ...f, additional_images: [...f.additional_images, preview], additional_image_files: [...f.additional_image_files, file] }));
    }
    setUploadingImage(false);
  };

  // ── Delete product ────────────────────────────────────────────────────
  const deleteProduct = async (id: string) => {
    if (!window.confirm('¿Eliminar este producto permanentemente?')) return;
    const { error } = await (supabase as any).from('products').delete().eq('id', id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    if (selectedId === id) clearSelection();
    setProducts(prev => prev.filter(p => p.id !== id));
    toast({ title: 'Producto eliminado' });
  };

  // ── Filter logic ──────────────────────────────────────────────────────
  const filtered = products.filter(p => {
    const type = getType(p, variantIds);
    if (filterType !== 'all' && type !== filterType) return false;
    if (filterCategory !== 'all' && p.category_id !== filterCategory) return false;
    if (filterStock === 'out' && p.stock !== 0) return false;
    if (filterStock === 'low' && p.stock >= 5) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q)
      || (p.category?.name?.toLowerCase() || '').includes(q)
      || (p.tags || []).some(t => t.toLowerCase().includes(q));
  });

  // ─────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────

  const renderLeftPanel = () => {
    // ── Phone edit ───────────────────────────────────────────────────
    if (selectedType === 'phone') return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-blue-600" /> Editar Celular
          </h3>
          <Button variant="ghost" size="sm" onClick={clearSelection}><X className="h-4 w-4" /></Button>
        </div>

        <BrandModelSelector
          selectedBrandId={phoneEdit.brand_id}
          selectedModelId={phoneEdit.model_id}
          onBrandChange={(id, name) => setPhoneEdit(f => ({ ...f, brand_id: id, brand_name: name, model_id: '', model_name: '' }))}
          onModelChange={(id, name) => setPhoneEdit(f => ({ ...f, model_id: id, model_name: name }))}
        />

        <div className="grid grid-cols-2 gap-3">
          <CreatableAttributeSelector tableName="capacities" label="Capacidad"
            selectedValue={phoneEdit.capacity}
            onValueChange={v => setPhoneEdit(f => ({ ...f, capacity: v }))} placeholder="Ej: 128GB" />
          <CreatableAttributeSelector tableName="colors" label="Color"
            selectedValue={phoneEdit.color}
            onValueChange={v => setPhoneEdit(f => ({ ...f, color: v }))} placeholder="Ej: Negro" />
        </div>

        <div className="space-y-1">
          <Label>Estado</Label>
          <Select value={phoneEdit.condition} onValueChange={v => setPhoneEdit(f => ({ ...f, condition: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Nuevo">Nuevo</SelectItem>
              <SelectItem value="Usado">Usado</SelectItem>
              <SelectItem value="Reacondicionado">Reacondicionado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Precio</Label>
            <PriceToggle currency={phoneEdit.priceCurrency}
              onToggle={c => setPhoneEdit(f => ({ ...f, priceCurrency: c }))}
              value={phoneEdit.priceCurrency === 'USD' ? phoneEdit.price_usd : phoneEdit.price}
              onChange={v => setPhoneEdit(f => phoneEdit.priceCurrency === 'USD' ? { ...f, price_usd: v } : { ...f, price: v })}
              rate={dollarRate} />
          </div>
          <div className="space-y-1">
            <Label>Stock</Label>
            <Input type="number" min="0" value={phoneEdit.stock}
              onChange={e => setPhoneEdit(f => ({ ...f, stock: e.target.value }))} />
          </div>
        </div>

        <Button className="w-full" onClick={savePhone} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Guardar Cambios
        </Button>
      </div>
    );

    // ── Case / Variant edit ──────────────────────────────────────────
    if (selectedType === 'case' || selectedType === 'variant') return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-purple-600" />
            {selectedType === 'case' ? 'Editar Funda' : 'Editar Variante'}
          </h3>
          <Button variant="ghost" size="sm" onClick={clearSelection}><X className="h-4 w-4" /></Button>
        </div>

        <div className="space-y-1">
          <Label>Nombre</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Precio</Label>
            <PriceToggle currency={form.priceCurrency}
              onToggle={c => setForm(f => ({ ...f, priceCurrency: c }))}
              value={form.priceCurrency === 'USD' ? form.price_usd : form.price}
              onChange={v => setForm(f => form.priceCurrency === 'USD' ? { ...f, price_usd: v } : { ...f, price: v })}
              rate={dollarRate} />
          </div>
          <div className="space-y-1">
            <Label>Stock</Label>
            <Input type="number" min="0" value={form.stock}
              onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} />
          </div>
        </div>

        {/* Variant stocks */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Stock por variante</Label>
          {loadingVariants
            ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : editVariants.length === 0
              ? <p className="text-xs text-muted-foreground">Sin variantes</p>
              : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {editVariants.map(v => (
                    <div key={v.id} className="flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">{v.color}</span>
                      <Input type="number" min="0" className="w-20 h-7 text-xs"
                        value={variantStockEdits[v.id] ?? v.stock}
                        onChange={e => setVariantStockEdits(s => ({ ...s, [v.id]: e.target.value }))} />
                      <Button size="sm" variant="outline" className="h-7 px-2"
                        onClick={() => saveVariantStock(v.id)}>
                        <Save className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )
          }
        </div>

        <Button className="w-full" onClick={() => saveGeneric()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Guardar Producto
        </Button>
      </div>
    );

    // ── Generic: add or edit ─────────────────────────────────────────
    return (
      <form onSubmit={saveGeneric} className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Plus className="h-4 w-4" />
            {selectedId ? 'Editar Producto' : 'Agregar Producto'}
          </h3>
          {selectedId && (
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>Cancelar</Button>
          )}
        </div>

        <CreatableResourceSelector tableName="categories" label="Categoría"
          placeholder="Seleccionar o crear categoría"
          value={form.category_id}
          onValueChange={v => setForm(f => ({ ...f, category_id: v }))}
          filter={(item: any) => {
            const n = item.name.toLowerCase();
            return !PHONE_KEYWORDS.some(k => n.includes(k)) && !CASE_KEYWORDS.some(k => n.includes(k));
          }}
        />

        <div className="space-y-1">
          <Label>Nombre</Label>
          <Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Precio</Label>
            <PriceToggle currency={form.priceCurrency}
              onToggle={c => setForm(f => ({ ...f, priceCurrency: c }))}
              value={form.priceCurrency === 'USD' ? form.price_usd : form.price}
              onChange={v => setForm(f => form.priceCurrency === 'USD' ? { ...f, price_usd: v } : { ...f, price: v })}
              rate={dollarRate} />
          </div>
          <div className="space-y-1">
            <Label>Stock</Label>
            <Input required type="number" min="0" value={form.stock}
              onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} />
          </div>
        </div>

        {/* Image */}
        <div className="space-y-1">
          <Label>Imagen principal</Label>
          <div className="flex gap-2">
            <Input type="url" placeholder="URL de imagen" value={form.image_url}
              onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} className="flex-1" />
            <div className="relative">
              <input type="file" accept="image/*" className="hidden" id="uni-img-upload"
                onChange={e => handleMainImage(e, false)} />
              <Label htmlFor="uni-img-upload"
                className="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background hover:bg-accent cursor-pointer">
                {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Label>
            </div>
          </div>
          {form.image_url && (
            <div className="mt-1 rounded-lg overflow-hidden border aspect-video">
              <img src={form.image_url} alt="preview" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="space-y-1">
          <Label>Etiquetas</Label>
          <div className="flex gap-2">
            <Input placeholder="Ej: Oferta..." value={form.tagInput}
              onChange={e => setForm(f => ({ ...f, tagInput: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (form.tagInput.trim()) setForm(f => ({ ...f, tags: [...f.tags, f.tagInput.trim()], tagInput: '' })); } }} />
            <Button type="button" variant="outline" onClick={() => { if (form.tagInput.trim()) setForm(f => ({ ...f, tags: [...f.tags, f.tagInput.trim()], tagInput: '' })); }}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {form.tags.map((t, i) => (
              <span key={i} className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded text-xs flex items-center gap-1">
                {t}
                <button type="button" onClick={() => setForm(f => ({ ...f, tags: f.tags.filter((_, j) => j !== i) }))}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label>Descripción</Label>
          <Textarea rows={2} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {selectedId ? 'Actualizar' : 'Agregar Producto'}
        </Button>
      </form>
    );
  };

  // ─── Filter strip ─────────────────────────────────────────────────────────
  const TYPE_OPTIONS: { value: 'all' | ProductType; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'phone', label: 'Celular' },
    { value: 'case', label: 'Funda' },
    { value: 'variant', label: 'Variante' },
    { value: 'generic', label: 'Otros' },
  ];

  // ─── Unique categories in filtered set ────────────────────────────────────
  const usedCategoryIds = new Set(products.map(p => p.category_id));
  const usedCategories = categories.filter(c => usedCategoryIds.has(c.id));

  return (
    <div className="space-y-4">
      <DollarSettings />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* ── Left panel ──────────────────────────────────────── */}
        <div className="bg-card rounded-2xl border border-border p-5 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-y-auto hide-scrollbar">
          {renderLeftPanel()}
        </div>

        {/* ── Right panel ─────────────────────────────────────── */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border overflow-hidden">

          {/* Header + search + filters */}
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-base whitespace-nowrap">
                Inventario
                <span className="ml-2 text-xs font-normal text-muted-foreground">({filtered.length} de {products.length})</span>
              </h3>
              <div className="flex items-center gap-2 flex-1 max-w-xs ml-auto">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
                </div>
                <Button variant={showFilters ? 'default' : 'outline'} size="sm" className="h-8 px-2 gap-1"
                  onClick={() => setShowFilters(v => !v)}>
                  <Filter className="h-3.5 w-3.5" />
                  <span className="text-xs">Filtros</span>
                </Button>
              </div>
            </div>

            {/* Advanced filters */}
            {showFilters && (
              <div className="flex flex-wrap gap-2 pt-1">
                {/* Type chips */}
                <div className="flex gap-1 flex-wrap">
                  {TYPE_OPTIONS.map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setFilterType(opt.value)}
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${filterType === opt.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Category select */}
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="h-7 text-xs w-40">
                    <SelectValue placeholder="Categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las categorías</SelectItem>
                    {usedCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>

                {/* Stock filter */}
                <Select value={filterStock} onValueChange={v => setFilterStock(v as any)}>
                  <SelectTrigger className="h-7 text-xs w-36">
                    <SelectValue placeholder="Stock" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todo el stock</SelectItem>
                    <SelectItem value="low">Stock bajo (&lt;5)</SelectItem>
                    <SelectItem value="out">Sin stock</SelectItem>
                  </SelectContent>
                </Select>

                {/* Reset */}
                {(filterType !== 'all' || filterCategory !== 'all' || filterStock !== 'all') && (
                  <button type="button" className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                    onClick={() => { setFilterType('all'); setFilterCategory('all'); setFilterStock('all'); }}>
                    <X className="h-3 w-3" /> Limpiar
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                    Sin resultados
                  </TableCell></TableRow>
                ) : filtered.map(p => {
                  const type = getType(p, variantIds);
                  const meta = TYPE_META[type];
                  const isSelected = selectedId === p.id;
                  return (
                    <TableRow key={p.id} className={isSelected ? 'bg-primary/5' : ''}>
                      <TableCell className="py-2">
                        <div className="h-9 w-9 rounded bg-muted overflow-hidden flex-shrink-0">
                          {p.image_url
                            ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                            : <div className="h-full w-full flex items-center justify-center"><Package className="h-4 w-4 text-muted-foreground" /></div>
                          }
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div>
                          <p className="font-medium text-sm leading-tight line-clamp-1">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.category?.name || 'Sin categoría'}</p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>
                          {TYPE_ICONS[type]} {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-2">
                        {p.price_usd != null ? (
                          <div>
                            <span className="text-green-600 font-medium text-sm">USD {p.price_usd}</span>
                            <span className="text-xs text-muted-foreground ml-1">(${p.price.toLocaleString('es-AR')})</span>
                          </div>
                        ) : (
                          <span className="font-medium text-sm">${p.price.toLocaleString('es-AR')}</span>
                        )}
                      </TableCell>
                      <TableCell className={`py-2 font-medium text-sm ${p.stock === 0 ? 'text-red-500' : p.stock < 5 ? 'text-yellow-600' : ''}`}>
                        {p.stock}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex gap-1">
                          <Button variant={isSelected ? 'default' : 'outline'} size="icon" className="h-7 w-7"
                            onClick={() => isSelected ? clearSelection() : selectProduct(p)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteProduct(p.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
};

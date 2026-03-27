import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Package, Wrench, Plus, Loader2, Save, RefreshCcw, Upload, Image as ImageIcon, MessageSquare, Check, X, Smartphone, Search, Tag, Trash2, ImagePlay, BarChart3, DollarSign, Pencil } from 'lucide-react';
import { CreatableResourceSelector } from '@/components/admin/CreatableResourceSelector';
import { BrandModelSelector } from '@/components/admin/BrandModelSelector';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { generateTrackingCode } from '@/utils/generateTrackingCode';
import { CaseManagement } from '@/components/admin/CaseManagement';
import { VariantManagement } from '@/components/admin/VariantManagement';
import { BlogManagement } from '@/components/admin/BlogManagement';
import { PromoManagement } from '@/components/admin/PromoManagement';
import { BannerManagement } from '@/components/admin/BannerManagement';
import { RepairStatusSelect, useRepairStatuses } from '@/components/admin/RepairStatusManager';
import { DollarSettings, useDollarRate } from '@/components/admin/DollarSettings';
import { UnifiedInventory } from '@/components/admin/UnifiedInventory';
import { InventoryModule } from '@/components/admin/InventoryModule';
import { useAuth } from '@/contexts/AuthContext';


import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type RepairStatus = string;

interface Repair {
  id: string;
  tracking_code: string;
  client_dni: string;
  client_name: string | null;
  device_model: string;
  device_brand: string | null;
  status: RepairStatus;
  notes: string | null;
  problem_description: string | null;
  created_at: string;
  locality?: string;
  is_deleted?: boolean | null;
  quoted_price?: number | null;
}

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
  category?: Category; // Join result
  tags: string[] | null;
}

interface RepairLog {
  id: string;
  repair_id: string;
  content: string;
  created_at: string;
  is_public: boolean;
}

interface Order {
  id: string;
  payment_id: string;
  status: string;
  total: number;
  items: any[];
  payer: any;
  created_at: string;
}

interface RepairLogsDialogProps {
  repair: Repair;
  onQuoteSaved: (repairId: string, price: number) => void;
}

const RepairLogsDialog = ({ repair, onQuoteSaved }: RepairLogsDialogProps) => {
  const repairId = repair.id;
  const trackingCode = repair.tracking_code;
  const [logs, setLogs] = useState<RepairLog[]>([]);
  const [newLog, setNewLog] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);

  // Quote state local to dialog
  const [quoteValue, setQuoteValue] = useState(repair.quoted_price != null ? repair.quoted_price.toString() : '');
  const [savingQuoteLocal, setSavingQuoteLocal] = useState(false);

  // Sync when parent changes (e.g. saved from table inline)
  useEffect(() => {
    setQuoteValue(repair.quoted_price != null ? repair.quoted_price.toString() : '');
  }, [repair.quoted_price]);

  const saveQuote = async () => {
    const price = parseFloat(quoteValue.replace(',', '.'));
    if (!quoteValue.trim() || isNaN(price) || price < 0) {
      toast({ title: 'Ingresá un precio válido', variant: 'destructive' }); return;
    }
    setSavingQuoteLocal(true);
    await supabase.from('repairs' as any).update({ quoted_price: price }).eq('id', repairId);
    if (repair.quoted_price != null) {
      await (supabase as any).from('inventory_movements').delete()
        .eq('channel', 'Reparación').like('notes', `%${trackingCode}%`);
    }
    await (supabase as any).from('inventory_movements').insert({
      product_id: null, variant_id: null, type: 'sale', quantity: 1, unit_price: price,
      channel: 'Reparación',
      notes: `${trackingCode} · ${repair.client_name ?? repair.client_dni} · ${repair.device_brand ?? ''} ${repair.device_model}`.trim(),
    });
    onQuoteSaved(repairId, price);
    toast({ title: 'Cotización guardada', description: `$${price.toLocaleString('es-AR')}` });
    setSavingQuoteLocal(false);
  };

  useEffect(() => {
    if (open) {
      fetchLogs();
    }
  }, [open, repairId]);

  const fetchLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('repair_logs' as any)
      .select('*')
      .eq('repair_id', repairId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching logs:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los logs.',
        variant: 'destructive',
      });
    } else {
      setLogs(data as any);
    }
    setLoading(false);
  };

  const addLog = async () => {
    if (!newLog.trim()) return;
    setSending(true);

    const { error } = await supabase
      .from('repair_logs' as any)
      .insert({
        repair_id: repairId,
        content: newLog,
        is_public: true // Default visible for now as per user request
      });

    if (error) {
      toast({
        title: 'Error',
        description: 'No se pudo guardar la nota.',
        variant: 'destructive',
      });
    } else {
      setNewLog('');
      fetchLogs();
      toast({
        title: 'Nota agregada',
        description: 'Se ha registrado la actualización.',
      });
    }
    setSending(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <MessageSquare className="h-4 w-4" />
          Notas
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Observaciones de Reparación</DialogTitle>
          <DialogDescription>
            Historial para reparación {trackingCode}
          </DialogDescription>
        </DialogHeader>

        {/* Quote section */}
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cotización del servicio</p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">$</span>
              <Input
                type="number" min="0" placeholder="0"
                value={quoteValue}
                onChange={e => setQuoteValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveQuote(); }}
                className="pl-7 h-9 text-base font-semibold"
              />
            </div>
            <Button size="sm" className="h-9 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              disabled={savingQuoteLocal || !quoteValue.trim()} onClick={saveQuote}>
              {savingQuoteLocal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Guardar
            </Button>
          </div>
          {repair.quoted_price != null && (
            <p className="text-xs text-green-600 font-medium">
              Cotización actual: <span className="font-bold">${repair.quoted_price.toLocaleString('es-AR')}</span> · registrada en historial de inventario
            </p>
          )}
        </div>

        <div className="flex flex-col h-[340px]">
          <ScrollArea className="flex-1 p-4 border rounded-md mb-4 bg-muted/10">
            {loading ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No hay notas registradas aún.
              </div>
            ) : (
              <div className="space-y-4">
                {logs.map((log) => (
                  <div key={log.id} className="flex flex-col gap-1 text-sm">
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>{new Date(log.created_at).toLocaleString('es-PE')}</span>
                      {log.is_public ? (
                        <span className="text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> Visible al cliente</span>
                      ) : (
                        <span className="text-yellow-600">Privado</span>
                      )}
                    </div>
                    <div className="p-3 bg-card border rounded-lg shadow-sm">
                      {log.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="flex gap-2 items-end">
            <Textarea
              placeholder="Escribir una actualización (ej: Llegó el repuesto...)"
              value={newLog}
              onChange={(e) => setNewLog(e.target.value)}
              className="resize-none"
              rows={2}
            />
            <Button onClick={addLog} disabled={sending || !newLog.trim()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};


const Admin = () => {
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('admin_active_tab') || "repairs";
  });
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRepair, setSavingRepair] = useState<string | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [editingNotes, setEditingNotes] = useState<{ id: string; notes: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const { statuses: repairStatuses, refetch: refetchStatuses } = useRepairStatuses();
  const dollarRate = useDollarRate();
  const [priceCurrency, setPriceCurrency] = useState<'ARS' | 'USD'>('ARS');

  const [newProduct, setNewProduct] = useState({
    name: '',
    category_id: '',
    price: '',
    stock: '',
    description: '',
    image_url: '' as string, // URL for preview (existing or new object URL)
    image_file: null as File | null, // File object for new upload
    additional_images: [] as string[], // URLs for preview (existing or new object URL)
    additional_image_files: [] as File[], // File objects for new uploads
    tags: [] as string[],
    newTagInput: '',
  });

  const [newRepair, setNewRepair] = useState({
    client_dni: '',
    client_name: '',
    device_brand: '',
    device_model: '',
    problem_description: '',
    locality: 'Urdinarrain',
    quoted_price: '',
  });
  const [savingNewRepair, setSavingNewRepair] = useState(false);
  const [quotingRepair, setQuotingRepair] = useState<{ id: string; value: string } | null>(null);
  const [savingQuote, setSavingQuote] = useState(false);

  const { session, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  // Auth protection handled by ProtectedRoute wrapper in App.tsx

  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (session && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchData();
    }
  }, [session]);

  useEffect(() => {
    localStorage.setItem('admin_active_tab', activeTab);
  }, [activeTab]);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  const fetchData = async () => {
    setLoading(true);

    const [repairsRes, productsRes, categoriesRes, ordersRes] = await Promise.all([
      supabase.from('repairs').select('*').eq('is_deleted', false).order('created_at', { ascending: false }),
      supabase.from('products').select('*, category:categories(*)').order('created_at', { ascending: false }),
      supabase.from('categories' as any).select('*').order('name', { ascending: true }),
      supabase.from('orders' as any).select('*').order('created_at', { ascending: false }),
    ]);

    if (repairsRes.data) setRepairs(repairsRes.data as unknown as Repair[]);
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
    }
    if (categoriesRes.data) setCategories(categoriesRes.data as unknown as Category[]);
    if (ordersRes.data) setOrders(ordersRes.data as unknown as Order[]);

    setLoading(false);
  };

  const addRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNewRepair(true);

    // Normalize DNI: remove dots and spaces, accept 7 or 8 digits
    const rawDni = newRepair.client_dni.replace(/[.\s-]/g, '');
    if (!/^\d{7,8}$/.test(rawDni)) {
      toast({
        title: 'DNI inválido',
        description: 'El DNI debe tener 7 u 8 dígitos numéricos (con o sin puntos).',
        variant: 'destructive',
      });
      setSavingNewRepair(false);
      return;
    }

    const tracking_code = generateTrackingCode();

    const { error } = await supabase.from('repairs' as any).insert({
      tracking_code,
      client_dni: rawDni,
      client_name: newRepair.client_name,
      device_brand: newRepair.device_brand || null,
      device_model: newRepair.device_model,
      problem_description: newRepair.problem_description || null,
      status: 'Recibido',
      locality: newRepair.locality,
      quoted_price: newRepair.quoted_price ? parseFloat(newRepair.quoted_price) : null,
    });

    if (error) {
      toast({
        title: 'Error',
        description: 'No se pudo registrar la reparación. Verificá los datos e intentá de nuevo.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Reparación Registrada',
        description: `Código de seguimiento: ${tracking_code}`,
      });
      setNewRepair({
        client_dni: '',
        client_name: '',
        device_brand: '',
        device_model: '',
        problem_description: '',
        locality: 'Urdinarrain',
        quoted_price: '',
      });
      fetchData();
    }
    setSavingNewRepair(false);
  };

  const updateRepairStatus = async (id: string, status: RepairStatus) => {
    setSavingRepair(id);

    const { error } = await supabase
      .from('repairs' as any)
      .update({ status })
      .eq('id', id);

    if (error) {
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado.',
        variant: 'destructive',
      });
    } else {
      setRepairs(repairs.map(r => r.id === id ? { ...r, status } : r));
      toast({
        title: 'Estado actualizado',
        description: `La reparación ha sido actualizada a "${status}".`,
      });
    }

    setSavingRepair(null);
  };

  const saveRepairQuote = async (repair: Repair, priceStr: string) => {
    const price = parseFloat(priceStr.replace(',', '.'));
    if (!priceStr.trim() || isNaN(price) || price < 0) {
      toast({ title: 'Ingresá un precio válido', variant: 'destructive' });
      return;
    }
    setSavingQuote(true);
    const { error } = await supabase
      .from('repairs' as any)
      .update({ quoted_price: price })
      .eq('id', repair.id);

    if (error) {
      toast({ title: 'Error al guardar cotización', variant: 'destructive' });
      setSavingQuote(false);
      return;
    }

    // Remove old repair movement if price was previously set
    if (repair.quoted_price != null) {
      await (supabase as any)
        .from('inventory_movements')
        .delete()
        .eq('channel', 'Reparación')
        .like('notes', `%${repair.tracking_code}%`);
    }

    // Record in inventory history
    await (supabase as any).from('inventory_movements').insert({
      product_id: null,
      variant_id: null,
      type: 'sale',
      quantity: 1,
      unit_price: price,
      channel: 'Reparación',
      notes: `${repair.tracking_code} · ${repair.client_name ?? repair.client_dni} · ${repair.device_brand ?? ''} ${repair.device_model}`.trim(),
    });

    setRepairs(prev => prev.map(r => r.id === repair.id ? { ...r, quoted_price: price } : r));
    setQuotingRepair(null);
    toast({ title: 'Cotización guardada', description: `$${price.toLocaleString('es-AR')} registrado en historial` });
    setSavingQuote(false);
  };

  const updateRepairNotes = async (id: string, notes: string) => {
    setSavingRepair(id);

    const { error } = await supabase
      .from('repairs' as any)
      .update({ notes })
      .eq('id', id);

    if (error) {
      toast({
        title: 'Error',
        description: 'No se pudieron guardar las notas.',
        variant: 'destructive',
      });
    } else {
      setRepairs(repairs.map(r => r.id === id ? { ...r, notes } : r));
      setEditingNotes(null);
      toast({
        title: 'Notas guardadas',
        description: 'Las notas han sido actualizadas.',
      });
    }

    setSavingRepair(null);
  };

  const hideRepair = async (id: string) => {
    if (!window.confirm('¿Estás seguro de que deseas ocultar (eliminar) esta reparación del panel?')) return;

    const { error } = await supabase
      .from('repairs' as any)
      .update({ is_deleted: true })
      .eq('id', id);

    if (error) {
      toast({
        title: 'Error',
        description: 'No se pudo ocultar la reparación.',
        variant: 'destructive',
      });
    } else {
      setRepairs(repairs.filter(r => r.id !== id));
      toast({
        title: 'Reparación oculta',
        description: 'La reparación ha sido ocultada del panel exitosamente.',
      });
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isAdditional = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);

    if (isAdditional) {
      setNewProduct({
        ...newProduct,
        additional_images: [...(newProduct.additional_images || []), previewUrl],
        additional_image_files: [...(newProduct.additional_image_files || []), file]
      });
    } else {
      setNewProduct({
        ...newProduct,
        image_url: previewUrl,
        image_file: file
      });
    }
  };

  const removeAdditionalImage = (indexToRemove: number) => {
    const isBlob = newProduct.additional_images[indexToRemove].startsWith('blob:');

    let newFiles = [...newProduct.additional_image_files];
    if (isBlob) {
      // Count how many blobs are before this index to find the correct file index
      let blobIndex = 0;
      for (let i = 0; i < indexToRemove; i++) {
        if (newProduct.additional_images[i].startsWith('blob:')) {
          blobIndex++;
        }
      }
      newFiles = newFiles.filter((_, i) => i !== blobIndex);
    }

    setNewProduct({
      ...newProduct,
      additional_images: newProduct.additional_images.filter((_, index) => index !== indexToRemove),
      additional_image_files: newFiles
    });
  };

  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');

  // Helper to check if category is smartphone
  const isSmartphoneCategory = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    return category && (
      category.name.toLowerCase().includes('celular') ||
      category.name.toLowerCase().includes('smartphone') ||
      category.name.toLowerCase().includes('iphone') ||
      category.name.toLowerCase().includes('samsung')
    );
  };

  const [smartphoneDetails, setSmartphoneDetails] = useState({
    brand: '',
    model: '',
    capacity: '',
    color: ''
  });

  const startEditingProduct = (product: Product) => {
    setEditingProductId(product.id);
    // Try to parse smartphone details from tags or name if possible, or just leave blank for now as it's complex to reverse engineer
    setNewProduct({
      name: product.name,
      category_id: product.category_id,
      price: product.price.toString(),
      stock: product.stock.toString(),
      description: product.description || '',
      image_url: product.image_url || '',
      image_file: null,
      additional_images: product.additional_images || [],
      additional_image_files: [],
      tags: product.tags || [],
      newTagInput: ''
    });
    setSmartphoneDetails({ brand: '', model: '', capacity: '', color: '' }); // Reset specific fields on edit for now
  };

  const cancelEditingProduct = () => {
    setEditingProductId(null);
    setNewProduct({
      name: '',
      category_id: '',
      price: '',
      stock: '',
      description: '',
      image_url: '',
      image_file: null,
      additional_images: [],
      additional_image_files: [],
      tags: [],
      newTagInput: ''
    });
    setSmartphoneDetails({ brand: '', model: '', capacity: '', color: '' });
  };

  const deleteProduct = async (id: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este producto?')) return;

    const { error } = await supabase
      .from('products' as any)
      .delete()
      .eq('id', id);

    if (error) {
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el producto.',
        variant: 'destructive',
      });
    } else {
      setProducts(products.filter(p => p.id !== id));
      toast({
        title: 'Producto eliminado',
        description: 'El producto ha sido eliminado correctamente.',
      });
    }
  };

  const uploadFile = async (file: File) => {
    // Validate file type
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error('Tipo de archivo no permitido. Solo se aceptan imágenes (JPG, PNG, WebP, GIF).');
    }

    // Validate file size (max 5MB)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      throw new Error('El archivo es demasiado grande. Máximo 5MB.');
    }

    const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (!fileExt || !ALLOWED_EXTENSIONS.includes(fileExt)) {
      throw new Error('Extensión de archivo no permitida.');
    }

    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('product_images')
      .upload(filePath, file);

    if (uploadError) {
      throw uploadError;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('product_images')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);

    try {
      let finalImageUrl = newProduct.image_url;
      if (newProduct.image_file) {
        finalImageUrl = await uploadFile(newProduct.image_file);
      }

      const existingUrls = newProduct.additional_images.filter(url => !url.startsWith('blob:'));

      const newImageUrls = await Promise.all(
        newProduct.additional_image_files.map(file => uploadFile(file))
      );

      const allAdditionalImages = [...existingUrls, ...newImageUrls];

      // Logic for Smartphone Name and Tags
      let finalName = newProduct.name;
      let finalTags = [...newProduct.tags];

      if (isSmartphoneCategory(newProduct.category_id)) {
        if (smartphoneDetails.brand && smartphoneDetails.model) {
          // Construct name automatically
          finalName = `${smartphoneDetails.brand} ${smartphoneDetails.model}`;
          if (smartphoneDetails.capacity) finalName += ` ${smartphoneDetails.capacity}`;
          if (smartphoneDetails.color) finalName += ` ${smartphoneDetails.color}`;

          // Add details to tags
          if (smartphoneDetails.brand) finalTags.push(smartphoneDetails.brand);
          if (smartphoneDetails.model) finalTags.push(smartphoneDetails.model);
          if (smartphoneDetails.capacity) finalTags.push(smartphoneDetails.capacity);
          if (smartphoneDetails.color) finalTags.push(smartphoneDetails.color);
        }
      }

      const rawPrice = parseFloat(newProduct.price) || 0;
      const arsPrice = priceCurrency === 'USD' && dollarRate ? Math.round(rawPrice * dollarRate) : rawPrice;
      const usdPrice = priceCurrency === 'USD' ? rawPrice : null;

      const productData = {
        name: finalName,
        category_id: newProduct.category_id,
        price: arsPrice,
        price_usd: usdPrice,
        stock: parseInt(newProduct.stock, 10) || 0,
        description: newProduct.description || null,
        image_url: finalImageUrl || null,
        additional_images: allAdditionalImages,
        tags: Array.from(new Set(finalTags)) // Remove duplicates
      };

      if (editingProductId) {
        // Update existing product
        const { error } = await supabase
          .from('products' as any)
          .update(productData)
          .eq('id', editingProductId);

        if (error) throw error;

        toast({
          title: 'Producto actualizado',
          description: `${finalName} ha sido actualizado exitosamente.`,
        });
      } else {
        // Create new product
        const { error } = await supabase
          .from('products' as any)
          .insert(productData);

        if (error) throw error;

        toast({
          title: 'Producto agregado',
          description: `${finalName} ha sido agregado exitosamente.`,
        });
      }

      cancelEditingProduct();
      fetchData();
    } catch (error: any) {
      console.error('Error al guardar producto:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo guardar el producto.',
        variant: 'destructive',
      });
    }

    setSavingProduct(false);
  };

  // Auth loading/redirect handled by ProtectedRoute wrapper
  if (!session) return null;

  return (
    <>
      <Helmet>
        <title>Panel de Administración - Nictech</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="min-h-screen bg-muted/30">
        {/* Header */}
        <header className="bg-secondary text-secondary-foreground py-4">
          <div className="container-main flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="https://tuzpcofywkhglkqplhnn.supabase.co/storage/v1/object/public/product_images/Logotipo%20solo%20isotipo%20(solo%20icono%20sin%20texto).png"
                alt="Nictech Logo"
                className="h-10 w-10 object-contain"
              />
              <div>
                <h1 className="font-bold text-lg">Nictech Admin</h1>
                <p className="text-secondary-foreground/70 text-sm">Panel de Administración</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="text-secondary-foreground hidden sm:flex">
                Ir al Inicio
              </Button>
              <Button variant="ghost" size="icon" onClick={fetchData} className="text-secondary-foreground">
                <RefreshCcw className="h-5 w-5" />
              </Button>
              <Button variant="destructive" size="sm" onClick={handleLogout} className="flex gap-2">
                Salir
              </Button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="container-main py-8">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
            {/* Floating Vertical Nav Capsule */}
            <nav
              aria-label="Modulos admin"
              className="fixed left-4 top-1/2 -translate-y-1/2 z-40 group hidden md:flex"
            >
              <div className="relative flex flex-col items-stretch bg-secondary text-secondary-foreground rounded-[2rem] py-3 px-2 gap-0.5 shadow-2xl border border-white/10 overflow-hidden transition-all duration-300 ease-in-out w-12 group-hover:w-52">
                {([
                  { value: 'repairs',     label: 'Reparaciones',  icon: Wrench },
                  { value: 'inventory',   label: 'Inventario',    icon: BarChart3 },
                  { value: 'products',    label: 'Productos',     icon: Package },
                  { value: 'cases',       label: 'Fundas',        icon: Smartphone },
                  { value: 'variants',    label: 'Variantes',     icon: Package },
                  { value: 'orders',      label: 'Ventas Online', icon: Package },
                  { value: 'promos',      label: 'Promos',        icon: Tag },
                  { value: 'banners',     label: 'Banners',       icon: ImagePlay },
                  { value: 'blog',        label: 'Blog',          icon: MessageSquare },
                ] as const).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setActiveTab(value)}
                    title={label}
                    className={cn(
                      'flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-all duration-200 text-left min-w-0',
                      'hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      activeTab === value
                        ? 'bg-primary text-primary-foreground shadow-inner'
                        : 'text-secondary-foreground/80'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="text-sm font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-75 truncate">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </nav>

            {/* Mobile tabs (small screens only) */}
            <div className="flex flex-wrap justify-center gap-2 mb-6 md:hidden">
              {([
                { value: 'repairs',     label: 'Reparaciones',  icon: Wrench },
                { value: 'inventory',   label: 'Inventario',    icon: BarChart3 },
                { value: 'products',    label: 'Productos',     icon: Package },
                { value: 'cases',       label: 'Fundas',        icon: Smartphone },
                { value: 'variants',    label: 'Variantes',     icon: Package },
                { value: 'orders',      label: 'Ventas Online', icon: Package },
                { value: 'promos',      label: 'Promos',        icon: Tag },
                { value: 'banners',     label: 'Banners',       icon: ImagePlay },
                { value: 'blog',        label: 'Blog',          icon: MessageSquare },
              ] as const).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setActiveTab(value)}
                  className={cn(
                    'flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-medium transition-all',
                    activeTab === value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-foreground hover:bg-muted'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">

              {/* Repairs Tab */}
              <TabsContent value="repairs">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Add Repair Form */}
                  <div className="bg-card rounded-2xl border border-border p-6 h-fit">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Plus className="h-5 w-5" />
                      Nueva Reparación
                    </h3>
                    <form onSubmit={addRepair} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="client_dni">DNI Cliente</Label>
                        <Input
                          id="client_dni"
                          value={newRepair.client_dni}
                          onChange={(e) => setNewRepair({ ...newRepair, client_dni: e.target.value })}
                          required
                          maxLength={11}
                          placeholder="12345678 o 12.345.678"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="client_name">Nombre Cliente</Label>
                        <Input
                          id="client_name"
                          value={newRepair.client_name}
                          onChange={(e) => setNewRepair({ ...newRepair, client_name: e.target.value })}
                          placeholder="Juan Pérez"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="quoted_price">Cotización (Opcional)</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                          <Input
                            id="quoted_price"
                            type="number"
                            min="0"
                            step="0.01"
                            value={newRepair.quoted_price}
                            onChange={(e) => setNewRepair({ ...newRepair, quoted_price: e.target.value })}
                            placeholder="0"
                            className="pl-7"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="device_brand">Marca</Label>
                          <Input
                            id="device_brand"
                            value={newRepair.device_brand}
                            onChange={(e) => setNewRepair({ ...newRepair, device_brand: e.target.value })}
                            placeholder="Samsung"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="device_model">Modelo</Label>
                          <Input
                            id="device_model"
                            value={newRepair.device_model}
                            onChange={(e) => setNewRepair({ ...newRepair, device_model: e.target.value })}
                            required
                            placeholder="S23 Ultra"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="problem_description">Descripción del Problema</Label>
                        <Textarea
                          id="problem_description"
                          value={newRepair.problem_description}
                          onChange={(e) => setNewRepair({ ...newRepair, problem_description: e.target.value })}
                          placeholder="Pantalla rota, no enciende..."
                          rows={3}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="locality">Localidad</Label>
                        <Select
                          value={newRepair.locality}
                          onValueChange={(value) => setNewRepair({ ...newRepair, locality: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar localidad" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Urdinarrain">Urdinarrain</SelectItem>
                            <SelectItem value="Gilbert">Gilbert</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <Button type="submit" className="w-full" disabled={savingNewRepair}>
                        {savingNewRepair ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Plus className="h-4 w-4 mr-2" />
                        )}
                        Registrar Reparación
                      </Button>
                    </form>
                  </div>

                  {/* Repairs List */}
                  <div className="lg:col-span-2 bg-card rounded-2xl border border-border overflow-hidden">
                    <div className="p-6 border-b border-border">
                      <h2 className="text-lg font-semibold">Gestión de Reparaciones</h2>
                      <p className="text-muted-foreground text-sm">
                        {repairs.length} reparaciones registradas
                      </p>
                    </div>

                    <div className="divide-y divide-border">
                      {repairs.map((repair) => (
                        <div key={repair.id} className="p-4 hover:bg-muted/30 transition-colors">
                          {/* Row 1: code + locality + date + actions */}
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="font-mono font-semibold text-primary text-sm">
                              {repair.tracking_code}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${repair.locality === 'Gilbert' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-green-100 text-green-800 border-green-200'}`}>
                              {repair.locality || 'Urdinarrain'}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {new Date(repair.created_at).toLocaleDateString('es-PE')}
                            </span>
                            <RepairLogsDialog
                              repair={repair}
                              onQuoteSaved={(id, price) => setRepairs(prev => prev.map(r => r.id === id ? { ...r, quoted_price: price } : r))}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => hideRepair(repair.id)}
                              title="Ocultar Reparación"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          {/* Row 2: client + device + description */}
                          <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {repair.client_name || repair.client_dni}
                            </span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-sm text-muted-foreground">
                              {repair.device_brand} {repair.device_model}
                            </span>
                            {(repair.problem_description || repair.notes) && (
                              <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className="text-xs text-muted-foreground truncate max-w-[240px]" title={repair.problem_description || repair.notes || ''}>
                                  {repair.problem_description || repair.notes}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Row 3: status + price */}
                          <div className="flex items-center gap-3 flex-wrap">
                            <RepairStatusSelect
                              value={repair.status}
                              onValueChange={(value) => updateRepairStatus(repair.id, value as RepairStatus)}
                              statuses={repairStatuses}
                              onStatusesChanged={refetchStatuses}
                            />
                            {quotingRepair?.id === repair.id ? (
                              <div className="flex items-center gap-1">
                                <span className="text-sm font-semibold text-muted-foreground">$</span>
                                <Input
                                  autoFocus
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  value={quotingRepair.value}
                                  onChange={e => setQuotingRepair({ id: repair.id, value: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') saveRepairQuote(repair, quotingRepair.value);
                                    if (e.key === 'Escape') setQuotingRepair(null);
                                  }}
                                  className="h-7 w-24 text-sm"
                                />
                                <Button size="icon" className="h-7 w-7 bg-green-600 hover:bg-green-700 text-white"
                                  disabled={savingQuote}
                                  onClick={() => saveRepairQuote(repair, quotingRepair.value)}>
                                  {savingQuote ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7"
                                  onClick={() => setQuotingRepair(null)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : repair.quoted_price != null ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-bold text-green-600">
                                  ${repair.quoted_price.toLocaleString('es-AR')}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setQuotingRepair({ id: repair.id, value: repair.quoted_price!.toString() })}
                                  className="text-muted-foreground hover:text-foreground transition-colors">
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs border-dashed"
                                onClick={() => setQuotingRepair({ id: repair.id, value: '' })}>
                                <DollarSign className="h-3 w-3" /> Cotizar
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Products Tab */}
              <TabsContent value="inventory">
                <InventoryModule />
              </TabsContent>

              <TabsContent value="products">
                <UnifiedInventory />
              </TabsContent>



              {/* Orders Tab */}
              <TabsContent value="cases">
                <CaseManagement />
              </TabsContent>

              <TabsContent value="variants">
                <VariantManagement />
              </TabsContent>

              <TabsContent value="orders">
                <div className="bg-card rounded-2xl border border-border overflow-hidden">
                  <div className="p-6 border-b border-border">
                    <h3 className="text-lg font-semibold">Historial de Ventas Online</h3>
                    <p className="text-muted-foreground text-sm">{orders.length} órdenes registradas</p>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>ID Pago / Ref</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Items</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orders.map((order) => (
                          <TableRow key={order.id}>
                            <TableCell className="whitespace-nowrap">
                              {new Date(order.created_at).toLocaleString('es-PE')}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {order.payment_id}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span className="font-bold">{order.payer?.name || order.payer?.first_name || 'Sin Nombre'}</span>
                                <span className="text-sm text-foreground">{order.payer?.email || '-'}</span>
                                {order.payer?.phone?.number && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    📞 {order.payer.phone.area_code}{order.payer.phone.number}
                                  </span>
                                )}
                                {order.payer?.identification?.number && (
                                  <span className="text-xs text-muted-foreground">
                                    DNI: {order.payer.identification.number}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1 text-sm">
                                {Array.isArray(order.items) && order.items.map((item: any, idx: number) => (
                                  <div key={idx} className="flex gap-2">
                                    <span className="font-bold">{item.quantity}x</span>
                                    <span>{item.title || item.name || 'Producto'}</span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="font-bold">
                              $ {Number(order.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              <span className={`px-2 py-1 rounded text-xs font-medium border capitalize ${order.status === 'approved' ? 'bg-green-100 text-green-800 border-green-200' :
                                order.status === 'pending' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                                  'bg-red-100 text-red-800 border-red-200'
                                }`}>
                                {order.status === 'approved' ? 'Aprobado' : order.status}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="promos">
                <div className="bg-card rounded-2xl border border-border p-6">
                  <PromoManagement />
                </div>
              </TabsContent>

              <TabsContent value="banners">
                <div className="bg-card rounded-2xl border border-border p-6">
                  <BannerManagement />
                </div>
              </TabsContent>

              <TabsContent value="blog">
                <BlogManagement />
              </TabsContent>
            </Tabs>
            </>
          )}
        </main>
      </div>
    </>
  );
};

export default Admin;

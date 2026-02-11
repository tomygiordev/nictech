import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Package, Wrench, Plus, Loader2, Save, RefreshCcw, Upload, Image as ImageIcon, MessageSquare, Check, X, Smartphone } from 'lucide-react';
import { CreatableResourceSelector } from '@/components/admin/CreatableResourceSelector';
import { BrandModelSelector } from '@/components/admin/BrandModelSelector';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { generateTrackingCode } from '@/utils/generateTrackingCode';
import { CaseManagement } from '@/components/admin/CaseManagement';
import { SmartphoneManagement } from '@/components/admin/SmartphoneManagement';
import { BlogManagement } from '@/components/admin/BlogManagement';


import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type RepairStatus = 'Recibido' | 'Diagnóstico' | 'Repuestos' | 'Reparación' | 'Finalizado';

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

const RepairLogsDialog = ({ repairId, trackingCode }: { repairId: string; trackingCode: string }) => {
  const [logs, setLogs] = useState<RepairLog[]>([]);
  const [newLog, setNewLog] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);

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

        <div className="flex flex-col h-[400px]">
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
    client_phone: '',
    device_brand: '',
    device_model: '',
    problem_description: '',
    locality: 'Urdinarrain',
  });
  const [savingNewRepair, setSavingNewRepair] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    checkUser();
    fetchData();
  }, []);

  const checkUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate('/login');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const fetchData = async () => {
    setLoading(true);

    const [repairsRes, productsRes, categoriesRes, ordersRes] = await Promise.all([
      supabase.from('repairs').select('*').order('created_at', { ascending: false }),
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
      setProducts(formattedProducts);
    }
    if (categoriesRes.data) setCategories(categoriesRes.data as unknown as Category[]);
    if (ordersRes.data) setOrders(ordersRes.data as unknown as Order[]);

    setLoading(false);
  };

  const addRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNewRepair(true);

    const tracking_code = generateTrackingCode();

    const { error } = await supabase.from('repairs' as any).insert({
      tracking_code,
      client_dni: newRepair.client_dni,
      client_name: newRepair.client_name,
      client_phone: newRepair.client_phone || null,
      device_brand: newRepair.device_brand || null,
      device_model: newRepair.device_model,
      problem_description: newRepair.problem_description || null,
      status: 'Recibido', // Default status
      locality: newRepair.locality,
    });

    if (error) {
      toast({
        title: 'Error',
        description: error.message || 'No se pudo registrar la reparación.',
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
        client_phone: '',
        device_brand: '',
        device_model: '',
        problem_description: '',
        locality: 'Urdinarrain',
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
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
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

      const productData = {
        name: finalName,
        category_id: newProduct.category_id,
        price: parseFloat(newProduct.price),
        stock: parseInt(newProduct.stock),
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
            <Tabs defaultValue="repairs" className="space-y-6">
              <TabsList className="flex flex-wrap justify-center md:justify-start gap-2 bg-transparent p-0 mb-6 h-auto w-full">
                <TabsTrigger value="repairs" className="flex items-center gap-2 flex-grow md:flex-grow-0 basis-[45%] md:basis-auto justify-center h-10 px-4 bg-muted/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                  <Wrench className="h-4 w-4" />
                  Reparaciones
                </TabsTrigger>
                <TabsTrigger value="products" className="flex items-center gap-2 flex-grow md:flex-grow-0 basis-[45%] md:basis-auto justify-center h-10 px-4 bg-muted/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                  <Package className="h-4 w-4" />
                  Productos
                </TabsTrigger>
                <TabsTrigger value="smartphones" className="flex items-center gap-2 flex-grow md:flex-grow-0 basis-[45%] md:basis-auto justify-center h-10 px-4 bg-muted/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                  <Smartphone className="h-4 w-4" />
                  Celulares
                </TabsTrigger>
                <TabsTrigger value="cases" className="flex items-center gap-2 flex-grow md:flex-grow-0 basis-[45%] md:basis-auto justify-center h-10 px-4 bg-muted/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                  <Smartphone className="h-4 w-4" />
                  Fundas
                </TabsTrigger>
                <TabsTrigger value="orders" className="flex items-center gap-2 flex-grow md:flex-grow-0 basis-[45%] md:basis-auto justify-center h-10 px-4 bg-muted/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                  <Package className="h-4 w-4" />
                  Ventas Online
                </TabsTrigger>
                <TabsTrigger value="blog" className="flex items-center gap-2 flex-grow md:flex-grow-0 basis-[45%] md:basis-auto justify-center h-10 px-4 bg-muted/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                  <MessageSquare className="h-4 w-4" />
                  Blog
                </TabsTrigger>
              </TabsList>

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
                          placeholder="12345678"
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
                        <Label htmlFor="client_phone">Teléfono (Opcional)</Label>
                        <Input
                          id="client_phone"
                          value={newRepair.client_phone}
                          onChange={(e) => setNewRepair({ ...newRepair, client_phone: e.target.value })}
                          placeholder="999 999 999"
                        />
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

                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Código</TableHead>
                            <TableHead>Dispositivo</TableHead>
                            <TableHead>Localidad</TableHead>
                            <TableHead>Descripción</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {repairs.map((repair) => (
                            <TableRow key={repair.id}>
                              <TableCell>
                                <div className="font-mono font-medium text-primary mb-1">
                                  {repair.tracking_code}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {repair.client_name || repair.client_dni}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {new Date(repair.created_at).toLocaleDateString('es-PE')}
                                </div>
                              </TableCell>
                              <TableCell>
                                {repair.device_brand} {repair.device_model}
                              </TableCell>
                              <TableCell>
                                <span className={`px-2 py-1 rounded text-xs font-medium border ${repair.locality === 'Gilbert' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-green-100 text-green-800 border-green-200'}`}>
                                  {repair.locality || 'Urdinarrain'}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-[150px] truncate" title={repair.problem_description || repair.notes || ''}>
                                {repair.problem_description || repair.notes || '-'}
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={repair.status}
                                  onValueChange={(value) => updateRepairStatus(repair.id, value as RepairStatus)}
                                >
                                  <SelectTrigger className="w-32 h-8">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Recibido">Recibido</SelectItem>
                                    <SelectItem value="Diagnóstico">Diagnóstico</SelectItem>
                                    <SelectItem value="Repuestos">Repuestos</SelectItem>
                                    <SelectItem value="Reparación">Reparación</SelectItem>
                                    <SelectItem value="Finalizado">Finalizado</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <RepairLogsDialog repairId={repair.id} trackingCode={repair.tracking_code} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Smartphones Tab */}
              <TabsContent value="smartphones">
                <SmartphoneManagement />
              </TabsContent>

              {/* Products Tab */}
              <TabsContent value="products">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Add Product Form */}
                  <div className="bg-card rounded-2xl border border-border p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Plus className="h-5 w-5" />
                        {editingProductId ? 'Editar Producto' : 'Agregar Producto'}
                      </h3>
                      {editingProductId && (
                        <Button variant="ghost" size="sm" onClick={cancelEditingProduct}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                    <form onSubmit={handleSaveProduct} className="space-y-4">
                      <CreatableResourceSelector
                        tableName="categories"
                        label="Categoría"
                        placeholder="Seleccionar o crear categoría"
                        value={newProduct.category_id}
                        onValueChange={(val) => setNewProduct({ ...newProduct, category_id: val })}
                        filter={(item) => {
                          const name = item.name.toLowerCase();
                          return !name.includes('celular') &&
                            !name.includes('smartphone') &&
                            !name.includes('iphone') &&
                            !name.includes('samsung') &&
                            !name.includes('funda') &&
                            !name.includes('case');
                        }}
                      />

                      <div className="space-y-2">
                        <Label htmlFor="name">Nombre</Label>
                        <Input
                          id="name"
                          value={newProduct.name}
                          onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="price">Precio ($)</Label>
                          <Input
                            id="price"
                            type="number"
                            step="0.01"
                            value={newProduct.price}
                            onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="stock">Stock</Label>
                          <Input
                            id="stock"
                            type="number"
                            value={newProduct.stock}
                            onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="image_url">Imagen del Producto</Label>
                        <div className="flex gap-2">
                          <Input
                            id="image_url"
                            type="url"
                            placeholder="URL de la imagen"
                            value={newProduct.image_url}
                            onChange={(e) => setNewProduct({ ...newProduct, image_url: e.target.value })}
                            className="flex-1"
                          />
                          <div className="relative">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleImageUpload(e, false)}
                              className="hidden"
                              id="file-upload"
                              disabled={uploadingImage}
                            />
                            <Label
                              htmlFor="file-upload"
                              className={`flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground cursor-pointer ${uploadingImage ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {uploadingImage ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                            </Label>
                          </div>
                        </div>
                        {newProduct.image_url && (
                          <div className="mt-2 relative aspect-video rounded-lg overflow-hidden border border-border">
                            <img src={newProduct.image_url} alt="Preview" className="object-cover w-full h-full" />
                          </div>
                        )}
                      </div>

                      {/* Additional Images Section */}
                      <div className="space-y-2">
                        <Label>Imágenes Adicionales</Label>
                        <div className="grid grid-cols-4 gap-4">
                          {newProduct.additional_images?.map((img, index) => (
                            <div key={index} className="relative group aspect-square rounded-lg overflow-hidden border bg-background">
                              <img src={img} alt={`Adicional ${index}`} className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => removeAdditionalImage(index)}
                                className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}

                          <div className="relative aspect-square flex items-center justify-center border-2 border-dashed rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleImageUpload(e, true)}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              disabled={uploadingImage}
                            />
                            {uploadingImage ? (
                              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            ) : (
                              <div className="text-center">
                                <Plus className="h-6 w-6 mx-auto text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Agregar</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Etiquetas</Label>
                        <div className="flex gap-2">
                          <Input
                            value={newProduct.newTagInput}
                            onChange={(e) => setNewProduct({ ...newProduct, newTagInput: e.target.value })}
                            placeholder="Ej: Oferta, Nuevo, Gaming..."
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (newProduct.newTagInput.trim()) {
                                  setNewProduct({
                                    ...newProduct,
                                    tags: [...newProduct.tags, newProduct.newTagInput.trim()],
                                    newTagInput: ''
                                  });
                                }
                              }
                            }}
                          />
                          <Button
                            type="button"
                            onClick={() => {
                              if (newProduct.newTagInput.trim()) {
                                setNewProduct({
                                  ...newProduct,
                                  tags: [...newProduct.tags, newProduct.newTagInput.trim()],
                                  newTagInput: ''
                                });
                              }
                            }}
                            variant="outline"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {newProduct.tags.map((tag, index) => (
                            <span key={index} className="bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm flex items-center gap-1">
                              {tag}
                              <button
                                type="button"
                                onClick={() => {
                                  setNewProduct({
                                    ...newProduct,
                                    tags: newProduct.tags.filter((_, i) => i !== index)
                                  });
                                }}
                                className="hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="description">Descripción</Label>
                        <Textarea
                          id="description"
                          value={newProduct.description}
                          onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                          rows={3}
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={savingProduct}>
                        {savingProduct ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Plus className="h-4 w-4 mr-2" />
                        )}
                        {editingProductId ? 'Actualizar Producto' : 'Agregar Producto'}
                      </Button>
                    </form>
                  </div>

                  {/* Products Table */}
                  <div className="lg:col-span-2 bg-card rounded-2xl border border-border overflow-hidden">
                    <div className="p-6 border-b border-border">
                      <h3 className="text-lg font-semibold">Inventario de Productos</h3>
                      <p className="text-muted-foreground text-sm">
                        {products.filter(product => {
                          const catName = product.category?.name?.toLowerCase() || '';
                          return !catName.includes('celular') &&
                            !catName.includes('smartphone') &&
                            !catName.includes('iphone') &&
                            !catName.includes('samsung') &&
                            !catName.includes('funda') &&
                            !catName.includes('case');
                        }).length} productos (excluye celulares y fundas)
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Producto</TableHead>
                            <TableHead>Categoría</TableHead>
                            <TableHead>Precio</TableHead>
                            <TableHead>Stock</TableHead>
                            <TableHead>Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {products
                            .filter(product => {
                              const catName = product.category?.name?.toLowerCase() || '';
                              return !catName.includes('celular') &&
                                !catName.includes('smartphone') &&
                                !catName.includes('iphone') &&
                                !catName.includes('samsung') &&
                                !catName.includes('funda') &&
                                !catName.includes('case');
                            })
                            .map((product) => (
                              <TableRow key={product.id}>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-lg bg-muted overflow-hidden">
                                      {product.image_url ? (
                                        <img
                                          src={product.image_url}
                                          alt={product.name}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div className="h-full w-full flex items-center justify-center">
                                          <Package className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                      )}
                                    </div>
                                    <span className="font-medium">{product.name}</span>
                                  </div>
                                </TableCell>
                                <TableCell>{product.category?.name || 'Sin categoría'}</TableCell>
                                <TableCell className="font-medium text-primary">
                                  $ {product.price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className={product.stock < 5 ? "text-red-500 font-bold" : ""}>
                                  {product.stock}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={() => startEditingProduct(product)}>
                                      <Wrench className="h-4 w-4" />
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={() => deleteProduct(product.id)}>
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </TabsContent>



              {/* Orders Tab */}
              <TabsContent value="cases">
                <CaseManagement />
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
                              <div className="flex flex-col">
                                <span className="font-medium">{order.payer?.email || '-'}</span>
                                <span className="text-xs text-muted-foreground">{order.payer?.first_name} {order.payer?.last_name}</span>
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

              <TabsContent value="blog">
                <BlogManagement />
              </TabsContent>
            </Tabs>
          )}
        </main>
      </div>
    </>
  );
};

export default Admin;

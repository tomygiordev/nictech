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
import { Cpu, Package, Wrench, Plus, Loader2, Save, RefreshCcw, Upload, Image as ImageIcon, MessageSquare, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { generateTrackingCode } from '@/utils/generateTrackingCode';
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
  description: string | null;
  category?: Category; // Join result
}

interface RepairLog {
  id: string;
  repair_id: string;
  content: string;
  created_at: string;
  is_public: boolean;
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

  const [newProduct, setNewProduct] = useState({
    name: '',
    category_id: '',
    price: '',
    stock: '',
    description: '',
    image_url: '',
    additional_images: [] as string[],
  });

  const [newRepair, setNewRepair] = useState({
    client_dni: '',
    client_name: '',
    client_phone: '',
    device_brand: '',
    device_model: '',
    problem_description: '',
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

    const [repairsRes, productsRes, categoriesRes] = await Promise.all([
      supabase.from('repairs').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('*, category:categories(*)').order('created_at', { ascending: false }),
      supabase.from('categories' as any).select('*').order('name', { ascending: true }),
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
        description: item.description,
        category: item.category // This comes from the join
      }));
      setProducts(formattedProducts);
    }
    if (categoriesRes.data) setCategories(categoriesRes.data as unknown as Category[]);

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

  const addProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);

    const { error } = await supabase
      .from('products' as any)
      .insert({
        name: newProduct.name,
        category_id: newProduct.category_id,
        price: parseFloat(newProduct.price),
        stock: parseInt(newProduct.stock),
        description: newProduct.description || null,
        image_url: newProduct.image_url || null,
        additional_images: newProduct.additional_images || [],
      });

    if (error) {
      console.error('Error al crear producto:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo agregar el producto.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Producto agregado',
        description: `${newProduct.name} ha sido agregado exitosamente.`,
      });
      setNewProduct({ name: '', category_id: '', price: '', stock: '', description: '', image_url: '' });
      fetchData();
    }

    setSavingProduct(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, isAdditional = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError, data } = await supabase.storage
      .from('product_images')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Error al subir imagen:', uploadError);
      toast({
        title: 'Error al subir imagen',
        description: uploadError.message || 'Error desconocido al subir el archivo.',
        variant: 'destructive',
      });
    } else {
      const { data: { publicUrl } } = supabase.storage
        .from('product_images')
        .getPublicUrl(filePath);

      if (isAdditional) {
        setNewProduct({
          ...newProduct,
          additional_images: [...(newProduct.additional_images || []), publicUrl]
        });
      } else {
        setNewProduct({ ...newProduct, image_url: publicUrl });
      }

      toast({
        title: 'Imagen subida',
        description: 'La imagen se ha cargado correctamente.',
      });
    }
    setUploadingImage(false);
  };

  const removeAdditionalImage = (indexToRemove: number) => {
    setNewProduct({
      ...newProduct,
      additional_images: newProduct.additional_images.filter((_, index) => index !== indexToRemove)
    });
  };

  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  const startEditingProduct = (product: Product) => {
    setEditingProductId(product.id);
    setNewProduct({
      name: product.name,
      category_id: product.category_id,
      price: product.price.toString(),
      stock: product.stock.toString(),
      description: product.description || '',
      image_url: product.image_url || '',
      additional_images: product.additional_images || [],
    });
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
      additional_images: []
    });
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

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);

    const productData = {
      name: newProduct.name,
      category_id: newProduct.category_id,
      price: parseFloat(newProduct.price),
      stock: parseInt(newProduct.stock),
      description: newProduct.description || null,
      image_url: newProduct.image_url || null,
      additional_images: newProduct.additional_images || [],
    };

    if (editingProductId) {
      // Update existing product
      const { error } = await supabase
        .from('products' as any)
        .update(productData)
        .eq('id', editingProductId);

      if (error) {
        toast({
          title: 'Error',
          description: error.message || 'No se pudo actualizar el producto.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Producto actualizado',
          description: `${newProduct.name} ha sido actualizado exitosamente.`,
        });
        cancelEditingProduct();
        fetchData();
      }
    } else {
      // Create new product
      const { error } = await supabase
        .from('products' as any)
        .insert(productData);

      if (error) {
        toast({
          title: 'Error',
          description: error.message || 'No se pudo agregar el producto.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Producto agregado',
          description: `${newProduct.name} ha sido agregado exitosamente.`,
        });
        cancelEditingProduct(); // Clear form
        fetchData();
      }
    }

    setSavingProduct(false);
  };

  return (
    <>
      <Helmet>
        <title>Panel de Administración - NicTech</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="min-h-screen bg-muted/30">
        {/* Header */}
        <header className="bg-secondary text-secondary-foreground py-4">
          <div className="container-main flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
                <Cpu className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-bold text-lg">NicTech Admin</h1>
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
              <TabsList className="grid w-full max-w-md grid-cols-3">
                <TabsTrigger value="repairs" className="flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Reparaciones
                </TabsTrigger>
                <TabsTrigger value="products" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Productos
                </TabsTrigger>
                <TabsTrigger value="categories" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Categorías
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
                      <div className="space-y-2">
                        <Label htmlFor="name">Nombre</Label>
                        <Input
                          id="name"
                          value={newProduct.name}
                          onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="category">Categoría</Label>
                        <Select
                          value={newProduct.category_id}
                          onValueChange={(value) => setNewProduct({ ...newProduct, category_id: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar categoría" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                              onChange={handleImageUpload}
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
                      <p className="text-muted-foreground text-sm">{products.length} productos</p>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Producto</TableHead>
                            <TableHead>Categoría</TableHead>
                            <TableHead>Precio</TableHead>
                            <TableHead>Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {products.map((product) => (
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

              {/* Categories Tab */}
              <TabsContent value="categories">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Add Category Form */}
                  <div className="bg-card rounded-2xl border border-border p-6 h-fit">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Plus className="h-5 w-5" />
                      Nueva Categoría
                    </h3>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="catName">Nombre</Label>
                        <Input
                          id="catName"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder="Ej: Tablets"
                        />
                      </div>
                      <Button
                        onClick={async () => {
                          if (!newCategoryName.trim()) return;
                          setSavingCategory(true);
                          const { error } = await supabase.from('categories' as any).insert({ name: newCategoryName });

                          if (error) {
                            console.error(error);
                            toast({ title: 'Error', description: error.message, variant: 'destructive' });
                          } else {
                            toast({ title: 'Categoría creada', description: 'Se ha agregado la nueva categoría.' });
                            setNewCategoryName('');
                            fetchData();
                          }
                          setSavingCategory(false);
                        }}
                        className="w-full"
                        disabled={savingCategory || !newCategoryName.trim()}
                      >
                        {savingCategory ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                        Crear Categoría
                      </Button>
                    </div>
                  </div>

                  {/* Categories List */}
                  <div className="lg:col-span-2 bg-card rounded-2xl border border-border overflow-hidden">
                    <div className="p-6 border-b border-border">
                      <h3 className="text-lg font-semibold">Categorías Existentes</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nombre</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {categories.map((cat) => (
                            <TableRow key={cat.id}>
                              <TableCell className="font-medium">{cat.name}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={async () => {
                                    if (confirm('¿Estás seguro? Esto podría afectar productos asociados.')) {
                                      const { error } = await supabase.from('categories' as any).delete().eq('id', cat.id);
                                      if (!error) fetchData();
                                    }
                                  }}
                                >
                                  Eliminar
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </main>
      </div>
    </>
  );
};

export default Admin;

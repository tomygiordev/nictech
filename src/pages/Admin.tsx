import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Cpu, Package, Wrench, Plus, Loader2, Save, RefreshCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

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
  created_at: string;
}

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  image_url: string | null;
  description: string | null;
}

const Admin = () => {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRepair, setSavingRepair] = useState<string | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [editingNotes, setEditingNotes] = useState<{ id: string; notes: string } | null>(null);

  const [newProduct, setNewProduct] = useState({
    name: '',
    category: '',
    price: '',
    stock: '',
    description: '',
    image_url: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    
    const [repairsRes, productsRes] = await Promise.all([
      supabase.from('repairs').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('*').order('created_at', { ascending: false }),
    ]);

    if (repairsRes.data) setRepairs(repairsRes.data as Repair[]);
    if (productsRes.data) setProducts(productsRes.data);
    
    setLoading(false);
  };

  const updateRepairStatus = async (id: string, status: RepairStatus) => {
    setSavingRepair(id);
    
    const { error } = await supabase
      .from('repairs')
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
      .from('repairs')
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
      .from('products')
      .insert({
        name: newProduct.name,
        category: newProduct.category,
        price: parseFloat(newProduct.price),
        stock: parseInt(newProduct.stock),
        description: newProduct.description || null,
        image_url: newProduct.image_url || null,
      });

    if (error) {
      toast({
        title: 'Error',
        description: 'No se pudo agregar el producto.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Producto agregado',
        description: `${newProduct.name} ha sido agregado exitosamente.`,
      });
      setNewProduct({ name: '', category: '', price: '', stock: '', description: '', image_url: '' });
      fetchData();
    }

    setSavingProduct(false);
  };

  const updateProductStock = async (id: string, stock: number) => {
    const { error } = await supabase
      .from('products')
      .update({ stock })
      .eq('id', id);

    if (!error) {
      setProducts(products.map(p => p.id === id ? { ...p, stock } : p));
      toast({
        title: 'Stock actualizado',
        description: 'El stock ha sido actualizado.',
      });
    }
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
            <Button variant="ghost" size="icon" onClick={fetchData} className="text-secondary-foreground">
              <RefreshCcw className="h-5 w-5" />
            </Button>
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
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="repairs" className="flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Reparaciones
                </TabsTrigger>
                <TabsTrigger value="products" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Productos
                </TabsTrigger>
              </TabsList>

              {/* Repairs Tab */}
              <TabsContent value="repairs">
                <div className="bg-card rounded-2xl border border-border overflow-hidden">
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
                          <TableHead>Cliente</TableHead>
                          <TableHead>Dispositivo</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Notas</TableHead>
                          <TableHead>Fecha</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {repairs.map((repair) => (
                          <TableRow key={repair.id}>
                            <TableCell className="font-mono font-medium text-primary">
                              {repair.tracking_code}
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium">{repair.client_name || 'N/A'}</p>
                                <p className="text-muted-foreground text-sm">DNI: {repair.client_dni}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              {repair.device_brand} {repair.device_model}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={repair.status}
                                onValueChange={(value) => updateRepairStatus(repair.id, value as RepairStatus)}
                                disabled={savingRepair === repair.id}
                              >
                                <SelectTrigger className="w-36">
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
                              {editingNotes?.id === repair.id ? (
                                <div className="flex gap-2">
                                  <Input
                                    value={editingNotes.notes}
                                    onChange={(e) => setEditingNotes({ ...editingNotes, notes: e.target.value })}
                                    className="min-w-[200px]"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => updateRepairNotes(repair.id, editingNotes.notes)}
                                    disabled={savingRepair === repair.id}
                                  >
                                    <Save className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setEditingNotes({ id: repair.id, notes: repair.notes || '' })}
                                  className="text-left text-muted-foreground hover:text-foreground transition-colors max-w-[200px] truncate"
                                >
                                  {repair.notes || 'Agregar nota...'}
                                </button>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {new Date(repair.created_at).toLocaleDateString('es-PE')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </TabsContent>

              {/* Products Tab */}
              <TabsContent value="products">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Add Product Form */}
                  <div className="bg-card rounded-2xl border border-border p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Plus className="h-5 w-5" />
                      Agregar Producto
                    </h3>
                    <form onSubmit={addProduct} className="space-y-4">
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
                        <Input
                          id="category"
                          value={newProduct.category}
                          onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                          placeholder="ej: Smartphones, Laptops"
                          required
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="price">Precio (S/)</Label>
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
                        <Label htmlFor="image_url">URL de imagen</Label>
                        <Input
                          id="image_url"
                          type="url"
                          value={newProduct.image_url}
                          onChange={(e) => setNewProduct({ ...newProduct, image_url: e.target.value })}
                        />
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
                        Agregar Producto
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
                            <TableHead>Stock</TableHead>
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
                              <TableCell>{product.category}</TableCell>
                              <TableCell className="font-medium text-primary">
                                S/ {product.price.toFixed(2)}
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={product.stock}
                                  onChange={(e) => updateProductStock(product.id, parseInt(e.target.value) || 0)}
                                  className="w-20"
                                />
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

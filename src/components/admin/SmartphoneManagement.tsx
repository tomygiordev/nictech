
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Pencil, Trash2, Smartphone, Save, X, Loader2, Upload, Image as ImageIcon, Search } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { BrandModelSelector } from '@/components/admin/BrandModelSelector';
import { CreatableAttributeSelector } from '@/components/admin/CreatableAttributeSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Product {
    id: string;
    name: string;
    description: string;
    price: number;
    stock: number;
    category_id: string;
    image_url: string | null;
    additional_images: string[] | null;
    tags: string[] | null;
    brand_id?: string;
    model_id?: string;
    capacity?: string;
    color?: string;
    condition?: string;
    brand_name?: string; // Joined
    model_name?: string; // Joined
}

export function SmartphoneManagement() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentProduct, setCurrentProduct] = useState<Partial<Product>>({});

    // Image States
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);
    const [additionalPreviews, setAdditionalPreviews] = useState<string[]>([]);

    // Tag State
    const [tagInput, setTagInput] = useState("");

    // UI States
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        fetchSmartphones();
    }, []);

    const fetchSmartphones = async () => {
        setLoading(true);
        try {
            const { data: categories } = await supabase.from('categories').select('id, name');
            const phoneCategoryIds = categories
                ?.filter(c => c.name.toLowerCase().includes('celular') || c.name.toLowerCase().includes('smartphone') || c.name.toLowerCase().includes('iphone'))
                .map(c => c.id) || [];

            if (phoneCategoryIds.length === 0) {
                setProducts([]);
                setLoading(false);
                return;
            }

            const { data, error } = await supabase
                .from('products')
                .select(`
                    *,
                    brands ( name ),
                    models ( name )
                `)
                .in('category_id', phoneCategoryIds)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formatted = data.map((p: any) => ({
                ...p,
                brand_name: p.brands?.name,
                model_name: p.models?.name,
                additional_images: p.additional_images || [],
                tags: p.tags || []
            }));

            setProducts(formatted);
        } catch (error: any) {
            console.error(error);
            toast({ title: "Error", description: "No se pudieron cargar los celulares.", variant: "destructive" });
        }
        setLoading(false);
    };

    const handleEdit = (product: Product) => {
        setCurrentProduct({ ...product, additional_images: product.additional_images || [], tags: product.tags || [] });
        setPreviewUrl(product.image_url);
        setImageFile(null);
        setAdditionalFiles([]); // Reset new files
        setAdditionalPreviews([]); // Reset new previews
        setIsEditing(true);
        setIsFormOpen(true);
    };

    const handleDelete = async (id: string, imageUrl: string | null, additionalImages: string[] | null) => {
        if (!confirm("¿Estás seguro de eliminar este celular? Se borrará permanentemente.")) return;

        try {
            // 1. Delete images from storage
            const imagesToDelete = [];
            if (imageUrl) {
                const path = imageUrl.split('/').pop();
                if (path) imagesToDelete.push(path);
            }
            if (additionalImages && additionalImages.length > 0) {
                additionalImages.forEach(url => {
                    const path = url.split('/').pop();
                    if (path) imagesToDelete.push(path);
                });
            }

            if (imagesToDelete.length > 0) {
                await supabase.storage.from('product_images').remove(imagesToDelete);
            }

            // 2. Delete record
            const { error } = await supabase.from('products').delete().eq('id', id);
            if (error) throw error;

            setProducts(prev => prev.filter(p => p.id !== id));
            toast({ title: "Eliminado", description: "El celular y sus fotos han sido eliminados." });
        } catch (error: any) {
            console.error(error);
            toast({ title: "Error", description: "No se pudo eliminar.", variant: "destructive" });
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setImageFile(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleAdditionalImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            setAdditionalFiles(prev => [...prev, ...files]);
            const newPreviews = files.map(file => URL.createObjectURL(file));
            setAdditionalPreviews(prev => [...prev, ...newPreviews]);
        }
    };

    const removeExistingAdditionalImage = (index: number) => {
        if (!currentProduct.additional_images) return;
        const updated = currentProduct.additional_images.filter((_, i) => i !== index);
        setCurrentProduct({ ...currentProduct, additional_images: updated });
    };

    const removeNewAdditionalImage = (index: number) => {
        setAdditionalFiles(prev => prev.filter((_, i) => i !== index));
        setAdditionalPreviews(prev => prev.filter((_, i) => i !== index));
    };

    // Tag Handling
    const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const val = tagInput.trim();
            if (val && !currentProduct.tags?.includes(val)) {
                setCurrentProduct(prev => ({ ...prev, tags: [...(prev.tags || []), val] }));
            }
            setTagInput("");
        }
    };

    const removeTag = (tagToRemove: string) => {
        setCurrentProduct(prev => ({ ...prev, tags: prev.tags?.filter(t => t !== tagToRemove) }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            if (!currentProduct.brand_id || !currentProduct.model_id || !currentProduct.price || !currentProduct.stock) {
                toast({ title: "Faltan datos", description: "Completa los campos obligatorios.", variant: "destructive" });
                setSaving(false);
                return;
            }

            let finalImageUrl = currentProduct.image_url;
            let finalAdditionalImages = currentProduct.additional_images || [];

            // Upload Main Image
            if (imageFile) {
                const fileExt = imageFile.name.split('.').pop();
                const fileName = `${Math.random()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('product_images').upload(fileName, imageFile);
                if (uploadError) throw uploadError;
                const { data } = supabase.storage.from('product_images').getPublicUrl(fileName);
                finalImageUrl = data.publicUrl;
            }

            // Upload Additional Images
            if (additionalFiles.length > 0) {
                const newUrls = await Promise.all(additionalFiles.map(async (file) => {
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${Math.random()}.${fileExt}`;
                    const { error: uploadError } = await supabase.storage.from('product_images').upload(fileName, file);
                    if (uploadError) throw uploadError;
                    const { data } = supabase.storage.from('product_images').getPublicUrl(fileName);
                    return data.publicUrl;
                }));
                finalAdditionalImages = [...finalAdditionalImages, ...newUrls];
            }

            const name = `${currentProduct.brand_name || ''} ${currentProduct.model_name || ''} ${currentProduct.capacity || ''} ${currentProduct.color || ''} (${currentProduct.condition || 'Nuevo'})`.trim();

            const payload = {
                name,
                description: currentProduct.description || '',
                price: currentProduct.price,
                stock: currentProduct.stock,
                image_url: finalImageUrl,
                additional_images: finalAdditionalImages,
                tags: currentProduct.tags || [],
                category_id: currentProduct.category_id,
                brand_id: currentProduct.brand_id,
                model_id: currentProduct.model_id,
                capacity: currentProduct.capacity,
                color: currentProduct.color,
                condition: currentProduct.condition
            };

            if (!isEditing) {
                const { data: categories } = await supabase.from('categories').select('id, name');
                const phoneCat = categories?.find(c => c.name.toLowerCase().includes('celular') || c.name.toLowerCase().includes('smartphone'));
                if (phoneCat) payload.category_id = phoneCat.id;
                else throw new Error("No category found");
            }

            // Upsert Logic (Check duplicates if creating)
            if (!isEditing) {
                const { data: existing } = await supabase.from('products')
                    .select('*')
                    .eq('brand_id', payload.brand_id)
                    .eq('model_id', payload.model_id)
                    .eq('capacity', payload.capacity || '')
                    .eq('color', payload.color || '')
                    .eq('condition', payload.condition || 'Nuevo')
                    .maybeSingle();

                if (existing) {
                    const newStock = existing.stock + Number(payload.stock);
                    await supabase.from('products').update({ stock: newStock }).eq('id', existing.id);
                    toast({ title: "Stock Actualizado", description: "Se sumó al producto existente." });
                    setIsFormOpen(false);
                    fetchSmartphones();
                    setSaving(false);
                    return;
                }
            }

            if (isEditing && currentProduct.id) {
                const { error } = await supabase.from('products').update(payload).eq('id', currentProduct.id);
                if (error) throw error;
                toast({ title: "Actualizado", description: "Celular modificado correctamente." });
            } else {
                const { error } = await supabase.from('products').insert(payload);
                if (error) throw error;
                toast({ title: "Creado", description: "Nuevo celular agregado." });
            }

            setIsFormOpen(false);
            fetchSmartphones();
        } catch (error: any) {
            console.error(error);
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
        setSaving(false);
    };

    const clearForm = () => {
        setCurrentProduct({ additional_images: [], tags: [], stock: 0 });
        setPreviewUrl(null);
        setImageFile(null);
        setAdditionalFiles([]);
        setAdditionalPreviews([]);
        setTagInput("");
        setIsEditing(false);
        setIsFormOpen(true);
    };

    const filteredProducts = searchQuery.trim()
        ? products.filter(p =>
            [p.name, p.brand_name, p.model_name, p.capacity, p.color, p.condition]
                .some(f => f?.toLowerCase().includes(searchQuery.toLowerCase()))
          )
        : products;

    // ── Agregar Modelo modal state ──
    const [addModelOpen, setAddModelOpen] = useState(false);
    const [modelBrandId, setModelBrandId] = useState('');
    const [modelBrandName, setModelBrandName] = useState('');
    const [modelName, setModelName] = useState('');
    const [savingModel, setSavingModel] = useState(false);
    const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
    const [loadingBrands, setLoadingBrands] = useState(false);

    const fetchBrands = async () => {
        setLoadingBrands(true);
        const { data } = await supabase.from('brands').select('id, name').order('name');
        setBrands(data || []);
        setLoadingBrands(false);
    };

    const handleAddModel = async () => {
        const trimmedName = modelName.trim();
        if (!modelBrandId || !trimmedName) {
            toast({ title: "Faltan datos", description: "Seleccioná una marca e ingresá el nombre del modelo.", variant: "destructive" });
            return;
        }
        setSavingModel(true);
        try {
            // Check for duplicate (case-insensitive)
            const { data: existing } = await supabase
                .from('models')
                .select('id, name')
                .eq('brand_id', modelBrandId)
                .ilike('name', trimmedName)
                .maybeSingle();

            if (existing) {
                toast({ title: "Modelo ya existe", description: `"${existing.name}" ya está registrado para esa marca.`, variant: "destructive" });
                setSavingModel(false);
                return;
            }

            const { error } = await supabase.from('models').insert({ name: trimmedName, brand_id: modelBrandId });
            if (error) throw error;

            toast({ title: "Modelo creado", description: `${modelBrandName} ${trimmedName} agregado correctamente.` });
            setAddModelOpen(false);
            setModelName('');
            setModelBrandId('');
            setModelBrandName('');
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
        setSavingModel(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Smartphone className="h-6 w-6" /> Gestión de Celulares
                </h2>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => { fetchBrands(); setAddModelOpen(true); }} className="text-muted-foreground">
                        <Plus className="mr-2 h-4 w-4" /> Agregar Modelo
                    </Button>
                    <Button onClick={clearForm}>
                        <Plus className="mr-2 h-4 w-4" /> Agregar Celular
                    </Button>
                </div>
            </div>

            {/* Modal Agregar Modelo */}
            <Dialog open={addModelOpen} onOpenChange={setAddModelOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Agregar Nuevo Modelo</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Marca</Label>
                            {loadingBrands ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando marcas...</div>
                            ) : (
                                <Select value={modelBrandId} onValueChange={(id) => {
                                    setModelBrandId(id);
                                    setModelBrandName(brands.find(b => b.id === id)?.name || '');
                                }}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar marca..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {brands.map(b => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Nombre del Modelo</Label>
                            <Input
                                placeholder="Ej: Galaxy S24 Ultra"
                                value={modelName}
                                onChange={(e) => setModelName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleAddModel(); }}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddModelOpen(false)}>Cancelar</Button>
                        <Button onClick={handleAddModel} disabled={savingModel || !modelBrandId || !modelName.trim()}>
                            {savingModel && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Crear Modelo
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className={isFormOpen ? "grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-6 items-start" : "space-y-4"}>

            {/* Left column: search + table */}
            <div className="space-y-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nombre, marca, modelo..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Imagen</TableHead>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Detalles</TableHead>
                                <TableHead>Precio</TableHead>
                                <TableHead>Stock</TableHead>
                                <TableHead>Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></TableCell></TableRow>
                            ) : filteredProducts.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{searchQuery ? 'Sin resultados.' : 'No hay celulares registrados.'}</TableCell></TableRow>
                            ) : (
                                filteredProducts.map((product) => (
                                    <TableRow key={product.id}>
                                        <TableCell>
                                            {product.image_url && <img src={product.image_url} alt={product.name} className="h-10 w-10 object-contain rounded" />}
                                        </TableCell>
                                        <TableCell className="font-medium">{product.name}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {product.capacity} • {product.color} • {product.condition}
                                        </TableCell>
                                        <TableCell>${product.price}</TableCell>
                                        <TableCell>{product.stock}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Pencil className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(product.id, product.image_url, product.additional_images)}><Trash2 className="h-4 w-4" /></Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Right column: sticky edit/add form */}
            {isFormOpen && (
                <div className="sticky top-4 h-fit bg-muted/30 p-6 rounded-lg border border-dashed border-primary/20 space-y-4">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium text-lg text-primary">
                            {isEditing ? 'Editar Celular' : 'Nuevo Celular'}
                        </h3>
                        <Button variant="ghost" size="sm" onClick={() => setIsFormOpen(false)}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-4">

                            <BrandModelSelector
                                selectedBrandId={currentProduct.brand_id}
                                selectedModelId={currentProduct.model_id}
                                onBrandChange={(id, name) => setCurrentProduct(prev => ({ ...prev, brand_id: id, brand_name: name, model_id: '', model_name: '' }))}
                                onModelChange={(id, name) => setCurrentProduct(prev => ({ ...prev, model_id: id, model_name: name }))}
                            />

                            <div className="grid grid-cols-2 gap-4">
                                <CreatableAttributeSelector
                                    tableName="capacities"
                                    label="Capacidad"
                                    selectedValue={currentProduct.capacity}
                                    onValueChange={(val) => setCurrentProduct({ ...currentProduct, capacity: val })}
                                    placeholder="Seleccionar..."
                                />
                                <CreatableAttributeSelector
                                    tableName="colors"
                                    label="Color"
                                    selectedValue={currentProduct.color}
                                    onValueChange={(val) => setCurrentProduct({ ...currentProduct, color: val })}
                                    placeholder="Seleccionar..."
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Estado</Label>
                                <Select
                                    value={currentProduct.condition || 'Nuevo'}
                                    onValueChange={(val) => setCurrentProduct({ ...currentProduct, condition: val })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Nuevo">Nuevo</SelectItem>
                                        <SelectItem value="Usado">Usado</SelectItem>
                                        <SelectItem value="Reacondicionado">Reacondicionado</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Tags */}
                            <div className="space-y-2">
                                <Label>Etiquetas</Label>
                                <Input
                                    placeholder="Escribe y presiona Enter..."
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyDown={handleAddTag}
                                />
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {currentProduct.tags?.map(tag => (
                                        <Badge key={tag} variant="secondary" className="cursor-pointer hover:bg-destructive/10" onClick={() => removeTag(tag)}>
                                            {tag} <X className="h-3 w-3 ml-1" />
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Precio ($)</Label>
                                    <Input
                                        type="number"
                                        value={currentProduct.price || ''}
                                        onChange={e => setCurrentProduct({ ...currentProduct, price: Number(e.target.value) })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Stock</Label>
                                    <Input
                                        type="number"
                                        value={currentProduct.stock ?? ''}
                                        onChange={e => setCurrentProduct({ ...currentProduct, stock: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Imágenes</Label>
                                <div className="space-y-2 mb-4">
                                    <Label className="text-xs text-muted-foreground">URL de Imagen Principal (Opcional)</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="https://..."
                                            value={currentProduct.image_url || ''}
                                            onChange={(e) => {
                                                setCurrentProduct({ ...currentProduct, image_url: e.target.value });
                                                setPreviewUrl(e.target.value);
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-4">
                                    {/* Main Image */}
                                    <div className="relative h-24 w-24 border rounded-md flex items-center justify-center bg-muted overflow-hidden group">
                                        {previewUrl ? (
                                            <img src={previewUrl} alt="Vista previa de imagen principal" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="text-xs text-muted-foreground text-center p-2">Principal</div>
                                        )}
                                        <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer text-white text-xs transition-opacity">
                                            Cambiar
                                            <input type="file" className="hidden" accept="image/*" onChange={handleImageChange} />
                                        </label>
                                    </div>

                                    {/* Existing Additional Images */}
                                    {currentProduct.additional_images?.map((url, idx) => (
                                        <div key={`existing-${idx}`} className="relative h-24 w-24 border rounded-md overflow-hidden group">
                                            <img src={url} alt={`Imagen adicional existente ${idx + 1}`} className="h-full w-full object-cover" />
                                            <button
                                                onClick={() => removeExistingAdditionalImage(idx)}
                                                className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                type="button"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    ))}

                                    {/* New Additional Images */}
                                    {additionalPreviews.map((url, idx) => (
                                        <div key={`new-${idx}`} className="relative h-24 w-24 border rounded-md overflow-hidden group">
                                            <img src={url} alt={`Nueva imagen adicional ${idx + 1}`} className="h-full w-full object-cover" />
                                            <button
                                                onClick={() => removeNewAdditionalImage(idx)}
                                                className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}

                                    {/* Add More Button */}
                                    <label className="h-24 w-24 border border-dashed rounded-md flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                                        <Plus className="h-6 w-6 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground mt-1">Agregar</span>
                                        <input type="file" multiple className="hidden" accept="image/*" onChange={handleAdditionalImagesChange} />
                                    </label>
                                </div>
                            </div>

                            <div className="p-4 bg-muted rounded-md text-sm text-muted-foreground">
                                <p><strong>{currentProduct.brand_name} {currentProduct.model_name}</strong></p>
                                <p>{currentProduct.capacity} - {currentProduct.color}</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Descripción</Label>
                        <textarea
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Descripción detallada del producto..."
                            value={currentProduct.description || ''}
                            onChange={(e) => setCurrentProduct({ ...currentProduct, description: e.target.value })}
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={() => setIsFormOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isEditing ? 'Guardar Cambios' : 'Crear Celular'}
                        </Button>
                    </div>
                </div>
            )}

            </div>
        </div>
    );
}

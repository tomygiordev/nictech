
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Save, Trash2, Image as ImageIcon, Upload, Filter, Search, X, Smartphone, Palette, Pencil, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { CreatableAttributeSelector } from '@/components/admin/CreatableAttributeSelector'; // Assuming we can reuse or adapt this usage pattern

interface Product {
    id: string;
    name: string;
    price: number;
    stock: number;
    model_id?: string;
    category_id: string;
    image_url: string | null;
    tags: string[] | null;
}

interface Variant {
    id: string;
    color: string;
    stock: number;
    image_url: string | null;
}

interface SmartphoneModel {
    id: string;
    name: string; // Brand + Model
    brand_name: string;
    model_name: string;
}

const FIXED_COLORS = [
    'Transparente', 'Negro', 'Blanco', 'Azul', 'Rojo', 'Rosa', 'Verde',
    'Amarillo', 'Violeta', 'Naranja', 'Gris', 'Dorado', 'Plateado',
    'Multicolor', 'Diseño 1', 'Diseño 2', 'Diseño 3'
];

export const CaseManagement = () => {
    // Data States
    const [smartphones, setSmartphones] = useState<SmartphoneModel[]>([]);
    const [cases, setCases] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter States
    const [selectedPhoneId, setSelectedPhoneId] = useState<string>("all");

    // UI States
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
    const [variants, setVariants] = useState<Variant[]>([]);
    const [loadingVariants, setLoadingVariants] = useState(false);

    // New Case Form State
    const [newCaseData, setNewCaseData] = useState({
        modelId: "",
        type: "", // User inputs this via creatable/text
        price: ""
    });
    const [knownCaseTypes, setKnownCaseTypes] = useState<string[]>(['Funda Lisa', 'Funda Transparente', 'Funda Personalizada', 'Funda Diseño']);
    const [creatingCase, setCreatingCase] = useState(false);

    // New Variant State
    const [newVariant, setNewVariant] = useState({
        color: '',
        stock: '',
        image_file: null as File | null,
        image_preview: ''
    });
    const [savingVariant, setSavingVariant] = useState(false);

    // Edit States
    const [editingCase, setEditingCase] = useState<any>(null); // { id, name, price }
    const [editingVariant, setEditingVariant] = useState<any>(null); // { id, color, stock, image_url }
    const [editVariantFile, setEditVariantFile] = useState<File | null>(null);
    const [editVariantPreview, setEditVariantPreview] = useState<string | null>(null);

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        fetchCases();
    }, [selectedPhoneId]);

    useEffect(() => {
        if (expandedCaseId) {
            fetchVariants(expandedCaseId);
        } else {
            setVariants([]);
        }
    }, [expandedCaseId]);

    const fetchInitialData = async () => {
        setLoading(true);
        // Fetch models
        const { data: modelsData } = await supabase
            .from('models' as any)
            .select('*, brand:brands(*)');

        if (modelsData) {
            const formatted = (modelsData as any[]).map((m: any) => ({
                id: m.id,
                name: `${m.brand?.name} ${m.name}`,
                brand_name: m.brand?.name,
                model_name: m.name
            })).sort((a, b) => a.name.localeCompare(b.name));
            setSmartphones(formatted);
        }

        await fetchCases();
        setLoading(false);
    };

    const fetchCases = async () => {
        const { data: categories } = await supabase.from('categories' as any).select('id, name');
        const caseCategoryIds = (categories as any[])?.filter(c => c.name.toLowerCase().includes('funda') || c.name.toLowerCase().includes('case')).map(c => c.id) || [];

        let query = supabase
            .from('products' as any)
            .select('*')
            .order('created_at', { ascending: false });

        if (caseCategoryIds.length > 0) {
            query = query.in('category_id', caseCategoryIds);
        } else {
            query = query.ilike('name', '%Funda%');
        }

        if (selectedPhoneId && selectedPhoneId !== 'all') {
            query = query.eq('model_id', selectedPhoneId);
        }

        const { data, error } = await query;
        if (!error && data) {
            setCases(data as any);

            // Extract existing Types for autocomplete
            const types = new Set(knownCaseTypes);
            (data as any[]).forEach((d: any) => {
                // Try to extract type from Name "Type ModelName"
                // This is approximate but helpful
                // Or checks tags
                if (d.tags && d.tags.length > 0) {
                    d.tags.forEach(t => types.add(t));
                }
            });
            setKnownCaseTypes(Array.from(types));
        }
    };

    const fetchVariants = async (productId: string) => {
        setLoadingVariants(true);
        const { data } = await supabase.from('product_variants' as any).select('*').eq('product_id', productId).order('color');
        setVariants(data as any || []);
        setLoadingVariants(false);
    };

    const handleCreateCase = async () => {
        if (!newCaseData.modelId || !newCaseData.type || !newCaseData.price) {
            toast({ title: "Faltan datos", description: "Completa todos los campos.", variant: "destructive" });
            return;
        }
        setCreatingCase(true);

        try {
            const selectedPhone = smartphones.find(s => s.id === newCaseData.modelId);
            if (!selectedPhone) throw new Error("Modelo no válido");

            // Find Fundas category
            let { data: categories } = await supabase.from('categories' as any).select('id').ilike('name', '%funda%').limit(1);
            let categoryId = (categories as any)?.[0]?.id;

            if (!categoryId) {
                const { data: newCat } = await supabase.from('categories' as any).insert({ name: 'Fundas' }).select().single();
                categoryId = (newCat as any)?.id;
            }

            const caseType = newCaseData.type.trim();
            const finalName = `${caseType} ${selectedPhone.name}`;

            const { data, error } = await supabase
                .from('products')
                .insert({
                    name: finalName,
                    price: Number(newCaseData.price),
                    stock: 0,
                    category_id: categoryId,
                    model_id: selectedPhone.id,
                    description: `Funda para ${selectedPhone.name}`,
                    tags: ['Funda', caseType, selectedPhone.brand_name]
                } as any)
                .select()
                .single();

            if (error) throw error;

            setCases(prev => [data as any, ...prev]);
            toast({ title: "Funda Creada", description: finalName });
            setIsCreateDialogOpen(false);
            setNewCaseData({ modelId: "", type: "", price: "" });

            setExpandedCaseId(data.id);

        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
        setCreatingCase(false);
    };

    const addVariant = async () => {
        if (!expandedCaseId || !newVariant.color || newVariant.stock === '') return;
        setSavingVariant(true);

        try {
            let imageUrl = null;
            if (newVariant.image_file) {
                const fileExt = newVariant.image_file.name.split('.').pop();
                const fileName = `variant_${Math.random()}.${fileExt}`;
                const { error: upErr } = await supabase.storage.from('product_images').upload(fileName, newVariant.image_file);
                if (upErr) throw upErr;
                const { data } = supabase.storage.from('product_images').getPublicUrl(fileName);
                imageUrl = data.publicUrl;
            }

            const { data: variant, error } = await supabase
                .from('product_variants' as any)
                .insert({
                    product_id: expandedCaseId,
                    color: newVariant.color,
                    stock: Number(newVariant.stock),
                    image_url: imageUrl
                } as any)
                .select()
                .single();

            if (error) throw error;

            setVariants(prev => [...prev, variant as any]);

            // Update Parent Stock & Image
            const currentCase = cases.find(c => c.id === expandedCaseId);
            if (currentCase) {
                const newTotal = currentCase.stock + Number(newVariant.stock);
                const updates: any = { stock: newTotal };

                // Set main image if not exists
                if (!currentCase.image_url && imageUrl) {
                    updates.image_url = imageUrl;
                }

                await supabase.from('products').update(updates as any).eq('id', expandedCaseId);
                setCases(prev => prev.map(c => c.id === expandedCaseId ? { ...c, ...updates } : c));
            }

            toast({ title: "Variante agregada" });
            setNewVariant({ color: '', stock: '', image_file: null, image_preview: '' });

        } catch (error: any) {
            console.error(error);
            toast({ title: "Error", description: "No se pudo agregar la variante.", variant: "destructive" });
        }
        setSavingVariant(false);
        setSavingVariant(false);
    };

    const handleUpdateCase = async () => {
        if (!editingCase || !editingCase.name || !editingCase.price) return;
        setCreatingCase(true); // Reuse loading state
        try {
            const { error } = await supabase.from('products').update({
                name: editingCase.name,
                price: Number(editingCase.price)
            } as any).eq('id', editingCase.id);

            if (error) throw error;

            setCases(prev => prev.map(c => c.id === editingCase.id ? { ...c, name: editingCase.name, price: Number(editingCase.price) } : c));
            toast({ title: "Funda Actualizada" });
            setEditingCase(null);
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
        setCreatingCase(false);
    };

    const handleUpdateVariant = async () => {
        if (!editingVariant || !editingVariant.id) return;
        setSavingVariant(true);
        try {
            let imageUrl = editingVariant.image_url;

            // Handle Image Upload if changed (logic requires identifying if it's a new file)
            // For simplicity in this `editingVariant` state we usually store file separately, 
            // but let's assume we handle it via a new state or extending the interface locally.
            // We'll use a local `editVariantFile` state for the file.
            if (editVariantFile) {
                const fileExt = editVariantFile.name.split('.').pop();
                const fileName = `variant_${Math.random()}.${fileExt}`;
                const { error: upErr } = await supabase.storage.from('product_images').upload(fileName, editVariantFile);
                if (upErr) throw upErr;
                const { data } = supabase.storage.from('product_images').getPublicUrl(fileName);
                imageUrl = data.publicUrl;
            }

            const { error } = await supabase.from('product_variants' as any).update({
                color: editingVariant.color,
                stock: Number(editingVariant.stock),
                image_url: imageUrl
            } as any).eq('id', editingVariant.id);

            if (error) throw error;

            setVariants(prev => prev.map(v => v.id === editingVariant.id ? { ...v, color: editingVariant.color, stock: Number(editingVariant.stock), image_url: imageUrl } : v));

            // Recalculate stock for parent
            // This is complex because we need to know the diff or just refetch. 
            // Simplest is to refetch parent or re-sum.
            // Let's re-sum from current variants state (updated)
            const updatedVariants = variants.map(v => v.id === editingVariant.id ? { ...v, stock: Number(editingVariant.stock) } : v);
            const newTotalStock = updatedVariants.reduce((acc, v) => acc + v.stock, 0);

            await supabase.from('products').update({ stock: newTotalStock } as any).eq('id', expandedCaseId);
            setCases(prev => prev.map(c => c.id === expandedCaseId ? { ...c, stock: newTotalStock } : c));

            toast({ title: "Variante Actualizada" });
            setEditingVariant(null);
            setEditVariantFile(null);
            setEditVariantPreview(null);
        } catch (error: any) {
            toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" });
        }
        setSavingVariant(false);
    };

    const handleDeleteVariant = async (id: string, currentStock: number) => {
        if (!confirm("¿Borrar variante?")) return;

        await supabase.from('product_variants' as any).delete().eq('id', id);
        setVariants(prev => prev.filter(v => v.id !== id));

        if (expandedCaseId) {
            const currentCase = cases.find(c => c.id === expandedCaseId);
            if (currentCase) {
                const newTotal = Math.max(0, currentCase.stock - currentStock);
                await supabase.from('products').update({ stock: newTotal } as any).eq('id', expandedCaseId);
                setCases(prev => prev.map(c => c.id === expandedCaseId ? { ...c, stock: newTotal } : c));
            }
        }
    };





    const handleSetMainImage = async (imageUrl: string | null, e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }

        if (!expandedCaseId || !imageUrl) return;
        try {
            const { error } = await supabase.from('products').update({ image_url: imageUrl } as any).eq('id', expandedCaseId);
            if (error) throw error;

            setCases(prev => prev.map(c => c.id === expandedCaseId ? { ...c, image_url: imageUrl } : c));
            toast({ title: "Imagen principal actualizada" });
        } catch (error: any) {
            console.error("Error setting main image:", error);
            toast({ title: "Error", description: "No se pudo actualizar la imagen principal.", variant: "destructive" });
        }
    };

    const handleDeleteProduct = async (id: string) => {
        if (!confirm("¿Eliminar este producto y todas sus variantes?")) return;
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (!error) {
            setCases(prev => prev.filter(c => c.id !== id));
            if (expandedCaseId === id) setExpandedCaseId(null);
            toast({ title: "Eliminado" });
        }
    };

    return (
        <div className="space-y-6">
            {/* Top Bar: Filter & Create */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/30 p-4 rounded-lg border border-dashed">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Filter className="h-4 w-4" />
                        <span className="text-sm font-medium">Filtrar por Modelo:</span>
                    </div>
                    <Select value={selectedPhoneId} onValueChange={setSelectedPhoneId}>
                        <SelectTrigger className="w-[250px] bg-background">
                            <SelectValue placeholder="Seleccionar Modelo" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Ver Todos</SelectItem>
                            {smartphones.map(phone => (
                                <SelectItem key={phone.id} value={phone.id}>{phone.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                    <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="w-full md:w-auto">
                                <Plus className="mr-2 h-4 w-4" /> Nuevo Producto Funda
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Crear Producto Funda</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>1. Modelo de Celular</Label>
                                    <Select
                                        value={newCaseData.modelId}
                                        onValueChange={(val) => setNewCaseData({ ...newCaseData, modelId: val })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Seleccionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {smartphones.map(phone => (
                                                <SelectItem key={phone.id} value={phone.id}>{phone.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>2. Tipo de Funda (Nombre)</Label>
                                    <p className="text-xs text-muted-foreground">Escribe un nuevo tipo (ej: Silicona) o selecciona uno.</p>
                                    {/* Simple implementation of a creatable-like input using datalist logic or just input for now to be flexible */}
                                    <div className="relative">
                                        <Input
                                            list="case-types"
                                            placeholder="Ej: Funda Lisa, Diseño, Hidrogel..."
                                            value={newCaseData.type}
                                            onChange={(e) => setNewCaseData({ ...newCaseData, type: e.target.value })}
                                        />
                                        <datalist id="case-types">
                                            {knownCaseTypes.map(t => <option key={t} value={t} />)}
                                        </datalist>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>3. Precio ($)</Label>
                                    <Input
                                        type="number"
                                        value={newCaseData.price}
                                        onChange={(e) => setNewCaseData({ ...newCaseData, price: e.target.value })}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancelar</Button>
                                <Button onClick={handleCreateCase} disabled={creatingCase}>
                                    {creatingCase && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Crear Producto
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* List */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Smartphone className="h-5 w-5" />
                            Listado de Fundas
                        </h3>
                        <Badge variant="outline">{cases.length}</Badge>
                    </div>

                    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                        {cases.length === 0 ? (
                            <div className="text-muted-foreground text-sm italic p-8 text-center border rounded-lg bg-muted/20 border-dashed">
                                No hay fundas creadas.
                            </div>
                        ) : (
                            cases.map(caseItem => (
                                <div
                                    key={caseItem.id}
                                    onClick={() => setExpandedCaseId(caseItem.id)}
                                    className={`relative p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md group ${expandedCaseId === caseItem.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card hover:border-primary/50'}`}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h4 className="font-semibold text-sm line-clamp-2 pr-6">{caseItem.name}</h4>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {smartphones.find(s => s.id === caseItem.model_id)?.name || 'Modelo desconocido'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center mt-3">
                                        <Badge variant="secondary" className="font-mono text-xs">
                                            $ {caseItem.price}
                                        </Badge>
                                        <div className="flex items-center text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                                            Storage: <span className="font-medium text-foreground ml-1">{caseItem.stock}</span>
                                        </div>
                                    </div>

                                    <button
                                        className="absolute top-2 right-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-destructive/10"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteProduct(caseItem.id);
                                        }}
                                        title="Eliminar producto"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="md:col-span-2">
                    {expandedCaseId ? (
                        <Card className="h-full border-primary/20 shadow-sm">
                            <CardHeader className="pb-3 border-b bg-muted/10">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="text-xl">{cases.find(c => c.id === expandedCaseId)?.name}</CardTitle>
                                        <CardDescription className="mt-1">
                                            Administra las variantes de color para este tipo de funda.
                                        </CardDescription>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setEditingCase({ id: cases.find(c => c.id === expandedCaseId)?.id, name: cases.find(c => c.id === expandedCaseId)?.name, price: cases.find(c => c.id === expandedCaseId)?.price })}>
                                            <Pencil className="h-4 w-4 mr-2" /> Editar
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => setExpandedCaseId(null)}>Cerrar</Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6">
                                {/* Add Variant Form - Compact Horizontal */}
                                <div className="p-4 bg-muted/40 rounded-xl border border-dashed mb-6">
                                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                        <Plus className="h-4 w-4 bg-primary text-primary-foreground rounded-full p-0.5" />
                                        Agregar Variante
                                    </h4>
                                    <div className="flex flex-col md:flex-row gap-4 items-end">
                                        <div className="space-y-1.5 flex-1 w-full">
                                            <Label className="text-xs text-muted-foreground">Color / Diseño</Label>
                                            <Select
                                                value={newVariant.color}
                                                onValueChange={(val) => setNewVariant({ ...newVariant, color: val })}
                                            >
                                                <SelectTrigger className="bg-background">
                                                    <SelectValue placeholder="Seleccionar..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {FIXED_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5 w-full md:w-32">
                                            <Label className="text-xs text-muted-foreground">Stock</Label>
                                            <Input
                                                type="number"
                                                placeholder="0"
                                                value={newVariant.stock}
                                                onChange={(e) => setNewVariant({ ...newVariant, stock: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-1.5 w-full md:w-auto">
                                            <Label className="text-xs text-muted-foreground block mb-1">Imagen (Opcional)</Label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    id="var-img-upload"
                                                    accept="image/*"
                                                    onChange={(e) => {
                                                        const f = e.target.files?.[0];
                                                        if (f) setNewVariant({ ...newVariant, image_file: f, image_preview: URL.createObjectURL(f) });
                                                    }}
                                                />
                                                <Label
                                                    htmlFor="var-img-upload"
                                                    className={`flex items-center justify-center w-10 h-10 border rounded-lg cursor-pointer transition-all ${newVariant.image_preview ? 'border-primary' : 'bg-background hover:bg-accent'}`}
                                                >
                                                    {newVariant.image_preview ?
                                                        <img src={newVariant.image_preview} className="w-full h-full object-cover rounded-lg" />
                                                        : <Upload className="h-4 w-4 text-muted-foreground" />
                                                    }
                                                </Label>
                                                {newVariant.image_preview && (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setNewVariant({ ...newVariant, image_file: null, image_preview: '' })}>
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                        <Button onClick={addVariant} disabled={savingVariant} className="w-full md:w-auto">
                                            {savingVariant ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                                        </Button>
                                    </div>
                                </div>

                                {/* Variants List */}
                                <div className="space-y-3">
                                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Variantes Activas ({variants.length})</h4>

                                    {loadingVariants ? (
                                        <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary/50" /></div>
                                    ) : variants.length === 0 ? (
                                        <div className="text-center py-12 text-muted-foreground bg-muted/10 rounded-xl border border-dashed">
                                            <Palette className="h-10 w-10 mx-auto mb-2 opacity-20" />
                                            <p>No hay variantes cargadas para esta funda.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {variants.map(v => (
                                                <div key={v.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:shadow-sm transition-all group">
                                                    <div className="flex items-center gap-4">
                                                        <div className="relative">
                                                            {v.image_url ? (
                                                                <img src={v.image_url} alt="" className="w-12 h-12 object-cover rounded-md bg-muted border" />
                                                            ) : (
                                                                <div
                                                                    className="w-12 h-12 rounded-md border flex items-center justify-center shadow-sm"
                                                                    style={{
                                                                        backgroundColor: v.color === 'Transparente' ? 'transparent' :
                                                                            v.color === 'Multicolor' ? 'transparent' :
                                                                                FIXED_COLORS.includes(v.color) ? v.color.toLowerCase().split(' ')[0] : 'white',
                                                                        backgroundImage: v.color === 'Transparente' ? 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAGElEQVQYlWNgYGCQwoKxgqGgcJA5h3yFAAs8BRWVSmnOAAAAAElFTkSuQmCC")' :
                                                                            v.color === 'Multicolor' ? 'linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet)' : 'none'
                                                                    }}
                                                                >
                                                                    {!v.image_url && <Palette className="h-4 w-4 opacity-20 mix-blend-difference text-white" />}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-sm">{v.color}</p>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal">
                                                                    Stock: {v.stock}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1">
                                                        {v.image_url && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className={`transition-all ${cases.find(c => c.id === expandedCaseId)?.image_url === v.image_url
                                                                        ? 'text-yellow-500 opacity-100 hover:bg-yellow-100/50'
                                                                        : 'text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-yellow-400 hover:bg-yellow-50/50'
                                                                    }`}
                                                                onClick={(e) => handleSetMainImage(v.image_url, e)}
                                                                title={cases.find(c => c.id === expandedCaseId)?.image_url === v.image_url ? "Imagen Principal Actual" : "Usar como imagen principal"}
                                                            >
                                                                <Star className={`h-4 w-4 ${cases.find(c => c.id === expandedCaseId)?.image_url === v.image_url ? 'fill-yellow-500' : ''}`} />
                                                            </Button>
                                                        )}
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                                onClick={() => setEditingVariant(v)}
                                                                title="Editar variante"
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                                onClick={() => handleDeleteVariant(v.id, v.stock)}
                                                                title="Borrar variante"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center p-12 text-muted-foreground border border-dashed rounded-xl bg-muted/5">
                            <Smartphone className="h-16 w-16 mb-4 opacity-10" />
                            <h3 className="text-lg font-medium text-foreground mb-1">Selecciona una funda</h3>
                            <p className="max-w-[300px] text-center text-sm">Elige una funda del listado de la izquierda para gestionar sus variantes de color y stock.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Case Dialog */}
            <Dialog open={!!editingCase} onOpenChange={(open) => !open && setEditingCase(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar Funda</DialogTitle>
                    </DialogHeader>
                    {editingCase && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Nombre</Label>
                                <Input value={editingCase.name} onChange={(e) => setEditingCase({ ...editingCase, name: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Precio ($)</Label>
                                <Input type="number" value={editingCase.price} onChange={(e) => setEditingCase({ ...editingCase, price: e.target.value })} />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingCase(null)}>Cancelar</Button>
                        <Button onClick={handleUpdateCase} disabled={creatingCase}>
                            {creatingCase && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Variant Dialog */}
            <Dialog open={!!editingVariant} onOpenChange={(open) => {
                if (!open) {
                    setEditingVariant(null);
                    setEditVariantFile(null);
                    setEditVariantPreview(null);
                }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar Variante</DialogTitle>
                    </DialogHeader>
                    {editingVariant && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Color</Label>
                                <Select disabled value={editingVariant.color} onValueChange={(val) => setEditingVariant({ ...editingVariant, color: val })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {FIXED_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Stock</Label>
                                <Input type="number" value={editingVariant.stock} onChange={(e) => setEditingVariant({ ...editingVariant, stock: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Imagen</Label>
                                <div className="flex items-center gap-4">
                                    {editVariantPreview || editingVariant.image_url ? (
                                        <img src={editVariantPreview || editingVariant.image_url} className="h-16 w-16 object-cover rounded border" />
                                    ) : (
                                        <div className="h-16 w-16 bg-muted rounded border flex items-center justify-center text-xs text-muted-foreground">Sin img</div>
                                    )}
                                    <label className="cursor-pointer">
                                        <div className="flex items-center gap-2 text-sm text-primary hover:underline">
                                            <Upload className="h-4 w-4" /> Cambiar Imagen
                                        </div>
                                        <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) {
                                                setEditVariantFile(f);
                                                setEditVariantPreview(URL.createObjectURL(f));
                                            }
                                        }} />
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingVariant(null)}>Cancelar</Button>
                        <Button onClick={handleUpdateVariant} disabled={savingVariant}>
                            {savingVariant && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
};

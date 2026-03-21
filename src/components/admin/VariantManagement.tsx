
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Save, Trash2, Image as ImageIcon, Upload, Filter, Search, X, Smartphone, Palette, Pencil, Star, EyeOff, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { CreatableAttributeSelector } from '@/components/admin/CreatableAttributeSelector';
import { CreatableResourceSelector } from '@/components/admin/CreatableResourceSelector';
import { MultiModelSelector } from '@/components/admin/MultiModelSelector';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { getVariantColor, saveColorHex, loadColorsFromDB } from '@/lib/colors';

interface Product {
    id: string;
    name: string;
    price: number;
    stock: number;
    model_id?: string;
    category_id: string;
    image_url: string | null;
    tags: string[] | null;
    is_active?: boolean;
}

interface Variant {
    id: string;
    color: string;
    stock: number;
    image_url: string | null;
    is_active?: boolean;
}

interface Category {
    id: string;
    name: string;
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


export const VariantManagement = () => {
    // Data States
    const [smartphones, setSmartphones] = useState<SmartphoneModel[]>([]);
    const [variantsList, setVariantsList] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter States
    const [selectedPhoneId, setSelectedPhoneId] = useState<string>("all");

    // UI States
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [expandedVariantItemId, setExpandedVariantItemId] = useState<string | null>(null);
    const [variants, setVariants] = useState<Variant[]>([]);
    const [loadingVariants, setLoadingVariants] = useState(false);

    // New Case Form State
    const [newVariantData, setNewVariantData] = useState({
        modelIds: [] as string[],
        categoryId: "",
        price: "",
        stock: "",
        image_file: null as File | null,
        image_preview: ''
    });
    const [categories, setCategories] = useState<Category[]>([]);
    const [accessoryCategories, setAccessoryCategories] = useState<Category[]>([]);
    const [creatingVariant, setCreatingVariant] = useState(false);

    // Category Creation & Visibility
    const [isCreateCatOpen, setIsCreateCatOpen] = useState(false);
    const [newCatName, setNewCatName] = useState("");
    const [hiddenCategories, setHiddenCategories] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('nictech_hidden_variant_cats');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });
    const [showHidden, setShowHidden] = useState(false);

    // New Variant State
    const [newVariant, setNewVariant] = useState({
        color: '',
        stock: '',
        image_file: null as File | null,
        image_preview: ''
    });
    const [savingVariant, setSavingVariant] = useState(false);

    // Edit States
    const [editingVariantItem, setEditingVariantItem] = useState<any>(null); // { id, name, price }
    const [editingVariant, setEditingVariant] = useState<any>(null); // { id, color, stock, image_url }
    const [editVariantFile, setEditVariantFile] = useState<File | null>(null);
    const [editVariantPreview, setEditVariantPreview] = useState<string | null>(null);

    // Quick Stock Update (Wait, user wants to replace this with general one)
    const [stockAddingVariant, setStockAddingVariant] = useState<any>(null);
    const [stockAddAmount, setStockAddAmount] = useState("1");

    // General Stock Update Tool
    const [isBatchStockOpen, setIsBatchStockOpen] = useState(false);
    const [stockUpdateData, setStockUpdateData] = useState({
        catId: '',
        modelId: '',
        variantId: '',
        color: '',
        newStock: ''
    });
    const [modalVariants, setModalVariants] = useState<Variant[]>([]);
    const [modalAvailableModels, setModalAvailableModels] = useState<string[]>([]);

    useEffect(() => {
        const fetchAvailableModels = async () => {
            if (stockUpdateData.catId) {
                const { data } = await supabase
                    .from('products')
                    .select('model_id')
                    .eq('category_id', stockUpdateData.catId);

                if (data) {
                    const ids = Array.from(new Set(data.map(p => p.model_id).filter(id => id !== null))) as string[];
                    setModalAvailableModels(ids);
                    return;
                }
            }
            setModalAvailableModels([]);
        };
        fetchAvailableModels();
    }, [stockUpdateData.catId]);

    useEffect(() => {
        const fetchModalVariants = async () => {
            if (stockUpdateData.catId && stockUpdateData.modelId) {
                // Find product for this cat + model
                const { data: products } = await supabase
                    .from('products')
                    .select('id')
                    .eq('category_id', stockUpdateData.catId)
                    .eq('model_id', stockUpdateData.modelId)
                    .limit(1);

                if (products && products.length > 0) {
                    const { data: variants } = await supabase
                        .from('product_variants' as any)
                        .select('*')
                        .eq('product_id', products[0].id)
                        .order('color');

                    setModalVariants(variants as unknown as Variant[] || []);
                    return;
                }
            }
            setModalVariants([]);
            setStockUpdateData(prev => ({ ...prev, variantId: '', color: '', newStock: '' }));
        };
        fetchModalVariants();
    }, [stockUpdateData.catId, stockUpdateData.modelId]);

    useEffect(() => {
        fetchInitialData();
        loadColorsFromDB();
    }, []);

    useEffect(() => {
        fetchVariantsList();
    }, [selectedPhoneId]);

    useEffect(() => {
        if (expandedVariantItemId) {
            fetchVariants(expandedVariantItemId);
        } else {
            setVariants([]);
        }
    }, [expandedVariantItemId]);

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

        // Fetch categories for the variants panel
        const { data: catData } = await supabase
            .from('categories' as any)
            .select('*')
            .order('name');

        if (catData) {
            setCategories(catData as unknown as Category[]);
            const excludedNames = ['funda', 'case', 'celular', 'smartphone', 'iphone', 'samsung', 'motorola'];
            const validCats = (catData as any[]).filter(c => !excludedNames.some(name => c.name.toLowerCase().includes(name)));
            setAccessoryCategories(validCats);
        }

        await fetchVariantsList();
        setLoading(false);
    };

    const fetchVariantsList = async () => {
        // Fetch categories to identify fundas and smartphones (we want to exclude both)
        const { data: catData } = await supabase.from('categories' as any).select('id, name');
        const excludedCategoryIds = (catData as any[])?.filter(c => {
            const name = c.name.toLowerCase();
            return name.includes('funda') ||
                name.includes('case') ||
                name.includes('celular') ||
                name.includes('smartphone') ||
                name.includes('iphone') ||
                name.includes('samsung') ||
                name.includes('motorola');
        }).map(c => c.id) || [];

        let query = supabase
            .from('products' as any)
            .select('*, categories:category_id(*)')
            .order('created_at', { ascending: false });

        // Filter: Must have a model_id AND NOT be in an excluded category
        query = query.not('model_id', 'is', null);

        if (excludedCategoryIds.length > 0) {
            query = query.not('category_id', 'in', `(${excludedCategoryIds.join(',')})`);
        }

        if (selectedPhoneId && selectedPhoneId !== 'all') {
            query = query.eq('model_id', selectedPhoneId);
        }

        const { data, error } = await query;
        if (!error && data) {
            setVariantsList(data as any);
        }
    };

    const fetchVariants = async (productId: string) => {
        setLoadingVariants(true);
        const { data } = await supabase.from('product_variants' as any).select('*').eq('product_id', productId).order('color');
        setVariants(data as any || []);
        setLoadingVariants(false);
    };

    const handleCreateVariantItem = async () => {
        if (newVariantData.modelIds.length === 0 || !newVariantData.categoryId || !newVariantData.price) {
            toast({ title: "Faltan datos", description: "Completa todos los campos.", variant: "destructive" });
            return;
        }
        setCreatingVariant(true);

        try {
            const selectedCategory = categories.find(c => c.id === newVariantData.categoryId);
            if (!selectedCategory) throw new Error("Categoría no válida");

            let imageUrl = null;
            if (newVariantData.image_file) {
                const fileExt = newVariantData.image_file.name.split('.').pop();
                const fileName = `product_base_${Math.random()}.${fileExt}`;
                const { error: upErr } = await supabase.storage.from('product_images').upload(fileName, newVariantData.image_file);
                if (upErr) throw upErr;
                const { data: publicUrlData } = supabase.storage.from('product_images').getPublicUrl(fileName);
                imageUrl = publicUrlData.publicUrl;
            }

            const creations = newVariantData.modelIds.map(async (modelId) => {
                const selectedPhone = smartphones.find(s => s.id === modelId);
                if (!selectedPhone) return null;

                const finalName = `${selectedCategory.name} ${selectedPhone.name}`;

                const { data, error } = await supabase
                    .from('products')
                    .insert({
                        name: finalName,
                        price: Number(newVariantData.price),
                        stock: newVariantData.stock ? Number(newVariantData.stock) : 0,
                        image_url: imageUrl,
                        category_id: selectedCategory.id,
                        model_id: selectedPhone.id,
                        description: `${selectedCategory.name} para ${selectedPhone.name}`,
                        tags: ['Accesorio', selectedCategory.name, selectedPhone.brand_name]
                    } as any)
                    .select('*, categories:category_id(*)')
                    .single();

                if (error) throw error;
                return data;
            });

            const results = await Promise.all(creations);
            const successfulResults = results.filter(r => r !== null);

            setVariantsList(prev => [...successfulResults as any[], ...prev]);
            toast({
                title: successfulResults.length > 1 ? "Productos Creados" : "Producto Creado",
                description: successfulResults.length > 1 ? `${successfulResults.length} modelos agregados.` : (successfulResults[0] as any).name
            });

            setIsCreateDialogOpen(false);
            setNewVariantData({ modelIds: [], categoryId: "", price: "", stock: "", image_file: null, image_preview: "" });

            if (successfulResults.length === 1) {
                setExpandedVariantItemId((successfulResults[0] as any).id);
            }

        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
        setCreatingVariant(false);
    };

    const handleCreateCategory = async () => {
        if (!newCatName.trim()) return;
        setCreatingVariant(true);
        try {
            const { error } = await supabase.from('categories' as any).insert({ name: newCatName.trim() }).select().single();
            if (error) throw error;
            setIsCreateCatOpen(false);
            setNewCatName("");
            fetchInitialData();
            toast({ title: 'Categoría creada', description: 'La categoría se creó correctamente.' });
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
        setCreatingVariant(false);
    };

    const toggleCategoryVisibility = (catId: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevenir que el acordeón se abra/cierre

        setHiddenCategories(prev => {
            const next = prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId];
            localStorage.setItem('nictech_hidden_variant_cats', JSON.stringify(next));
            return next;
        });
        toast({ title: "Visibilidad actualizada", description: "La categoría se ha ocultado/mostrado en este panel." });
    };

    const openCreateProductModalForCategory = (catId: string) => {
        setNewVariantData({ ...newVariantData, categoryId: catId, price: "", modelIds: [], stock: "", image_file: null, image_preview: "" });
        setIsCreateDialogOpen(true);
    };

    const addVariant = async () => {
        if (!expandedVariantItemId || !newVariant.color || newVariant.stock === '') return;
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
                    product_id: expandedVariantItemId,
                    color: newVariant.color,
                    stock: Number(newVariant.stock),
                    image_url: imageUrl
                } as any)
                .select()
                .single();

            if (error) throw error;

            setVariants(prev => [...prev, variant as any]);

            // Update Parent Stock & Image
            const currentVarItem = variantsList.find(c => c.id === expandedVariantItemId);
            if (currentVarItem) {
                // Calculate EXACT total stock from all variants (including the newly added one)
                const updatedVariants = [...variants, variant as any];
                const newTotal = updatedVariants.reduce((acc, v) => acc + (v.stock || 0), 0);
                const updates: any = { stock: newTotal };

                // Set main image if not exists
                if (!currentVarItem.image_url && imageUrl) {
                    updates.image_url = imageUrl;
                }

                await supabase.from('products').update(updates as any).eq('id', expandedVariantItemId);
                setVariantsList(prev => prev.map(c => c.id === expandedVariantItemId ? { ...c, ...updates } : c));
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
        if (!editingVariantItem || !editingVariantItem.name || !editingVariantItem.price) return;
        setCreatingVariant(true); // Reuse loading state
        try {
            let imageUrl = editingVariantItem.image_preview;
            if (editingVariantItem.image_file) {
                const fileExt = editingVariantItem.image_file.name.split('.').pop();
                const fileName = `product_base_update_${Math.random()}.${fileExt}`;
                const { error: upErr } = await supabase.storage.from('product_images').upload(fileName, editingVariantItem.image_file);
                if (upErr) throw upErr;
                const { data: publicUrlData } = supabase.storage.from('product_images').getPublicUrl(fileName);
                imageUrl = publicUrlData.publicUrl;
            }

            const updates: any = {
                name: editingVariantItem.name,
                price: Number(editingVariantItem.price),
                stock: Number(editingVariantItem.stock),
            };

            // Solamente reescribir la imagen si se provee una o estamos eliminandola
            if (imageUrl !== undefined) {
                updates.image_url = imageUrl;
            }

            const { error } = await supabase.from('products').update(updates).eq('id', editingVariantItem.id);

            if (error) throw error;

            setVariantsList(prev => prev.map(c => c.id === editingVariantItem.id ? { ...c, ...updates } : c));
            toast({ title: "Accesorio Actualizado" });
            setEditingVariantItem(null);
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
        setCreatingVariant(false);
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
            const updatedVariants = variants.map(v => v.id === editingVariant.id
                ? { ...v, stock: Number(editingVariant.stock) }
                : v
            );
            const newTotalStock = updatedVariants.reduce((acc, v) => acc + (v.stock || 0), 0);

            await supabase.from('products').update({ stock: newTotalStock } as any).eq('id', expandedVariantItemId);
            setVariantsList(prev => prev.map(c => c.id === expandedVariantItemId ? { ...c, stock: newTotalStock } : c));

            // Update local variants state with the updated one
            setVariants(updatedVariants);

            toast({ title: "Variante Actualizada" });
            setEditingVariant(null);
            setEditVariantFile(null);
            setEditVariantPreview(null);
        } catch (error: any) {
            toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" });
        }
        setSavingVariant(false);
    };

    const handleToggleVariantActive = async (variant: Variant) => {
        const newStatus = !variant.is_active;
        try {
            const { error } = await supabase
                .from('product_variants' as any)
                .update({ is_active: newStatus })
                .eq('id', variant.id);

            if (error) throw error;

            setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, is_active: newStatus } : v));
            toast({
                title: newStatus ? "Variante Activada" : "Variante Inactivada",
                description: `${variant.color} ahora está ${newStatus ? 'visible' : 'oculta'} en la tienda.`
            });
        } catch (error: any) {
            toast({ title: "Error", description: "No se pudo cambiar el estado.", variant: "destructive" });
        }
    };

    const handleBatchStockUpdate = async () => {
        if (!stockUpdateData.variantId || stockUpdateData.newStock === "") {
            toast({ title: "Faltan datos", variant: "destructive" });
            return;
        }

        setSavingVariant(true);
        try {
            // Update the variant
            const selectedVariant = modalVariants.find(v => v.id === stockUpdateData.variantId);
            if (!selectedVariant) throw new Error("Variante no encontrada");

            // Get product ID to update total stock later
            const { data: varData } = await supabase
                .from('product_variants' as any)
                .select('product_id')
                .eq('id', stockUpdateData.variantId)
                .single();

            const productId = (varData as any)?.product_id;

            const { error } = await supabase
                .from('product_variants' as any)
                .update({ stock: Number(stockUpdateData.newStock) })
                .eq('id', stockUpdateData.variantId);

            if (error) throw error;

            // Recalculate parent stock
            if (productId) {
                const { data: allVars } = await supabase
                    .from('product_variants' as any)
                    .select('stock')
                    .eq('product_id', productId);

                const totalStock = ((allVars as any[]) || []).reduce((acc, v) => acc + (v.stock || 0), 0);
                await supabase.from('products').update({ stock: totalStock } as any).eq('id', productId);
            }

            toast({ title: "Stock actualizado", description: `Se actualizó ${selectedVariant.color} a ${stockUpdateData.newStock} unidades.` });
            setIsBatchStockOpen(false);
            setStockUpdateData({ catId: '', modelId: '', variantId: '', color: '', newStock: '' });

            // Refresh current view
            fetchVariantsList();
            if (expandedVariantItemId) fetchVariants(expandedVariantItemId);

        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
        setSavingVariant(false);
    };

    const handleAddStock = async () => {
        if (!stockAddingVariant || !stockAddAmount || isNaN(Number(stockAddAmount))) return;
        setSavingVariant(true);
        try {
            const newStock = stockAddingVariant.stock + Number(stockAddAmount);
            const { error } = await supabase.from('product_variants' as any).update({ stock: newStock }).eq('id', stockAddingVariant.id);
            if (error) throw error;

            // Update local variants
            const updatedVariants = variants.map(v => v.id === stockAddingVariant.id ? { ...v, stock: newStock } : v);
            setVariants(updatedVariants);

            // Update parent stock
            const newTotalStock = updatedVariants.reduce((acc, v) => acc + (v.stock || 0), 0);
            await supabase.from('products').update({ stock: newTotalStock } as any).eq('id', expandedVariantItemId);
            setVariantsList(prev => prev.map(c => c.id === expandedVariantItemId ? { ...c, stock: newTotalStock } : c));

            toast({ title: "Stock actualizado", description: `Se sumaron ${stockAddAmount} unidades a ${stockAddingVariant.color}.` });
            setStockAddingVariant(null);
            setStockAddAmount("1");
        } catch (error: any) {
            toast({ title: "Error", description: "No se pudo actualizar el stock.", variant: "destructive" });
        }
        setSavingVariant(false);
    };

    const handleDeleteVariant = async (id: string, currentStock: number) => {
        if (!confirm("¿Borrar variante?")) return;

        await supabase.from('product_variants' as any).delete().eq('id', id);
        setVariants(prev => prev.filter(v => v.id !== id));

        if (expandedVariantItemId) {
            const currentVarItem = variantsList.find(c => c.id === expandedVariantItemId);
            if (currentVarItem) {
                // Calculate EXACT total stock from remaining variants
                const remainingVariants = variants.filter(v => v.id !== id);
                const newTotal = remainingVariants.reduce((acc, v) => acc + (v.stock || 0), 0);

                await supabase.from('products').update({ stock: newTotal } as any).eq('id', expandedVariantItemId);
                setVariantsList(prev => prev.map(c => c.id === expandedVariantItemId ? { ...c, stock: newTotal } : c));
            }
        }
    };





    const handleSetMainImage = async (imageUrl: string | null, e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }

        if (!expandedVariantItemId || !imageUrl) return;
        try {
            const { error } = await supabase.from('products').update({ image_url: imageUrl } as any).eq('id', expandedVariantItemId);
            if (error) throw error;

            setVariantsList(prev => prev.map(c => c.id === expandedVariantItemId ? { ...c, image_url: imageUrl } : c));
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
            setVariantsList(prev => prev.filter(c => c.id !== id));
            if (expandedVariantItemId === id) setExpandedVariantItemId(null);
            toast({ title: "Eliminado" });
        }
    };

    return (
        <div className="space-y-6">
            {/* Top Bar: Filter & Create */}
            {/* Top Bar: Filter */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/30 p-4 rounded-lg border border-dashed mb-6">
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

                <Button variant="outline" onClick={() => setIsBatchStockOpen(true)} className="gap-2">
                    <Save className="h-4 w-4" />
                    Actualizar Stock
                </Button>
            </div>

            {/* Hidden Dialog used by the '+ Nuevo Producto' buttons below */}
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Módulo: Añadir Modelo a Categoría</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Categoría Seleccionada</Label>
                            <Input value={categories.find(c => c.id === newVariantData.categoryId)?.name || ''} disabled className="bg-muted" />
                        </div>
                        <div className="space-y-2">
                            <Label>Modelos de Celular de Destino</Label>
                            <MultiModelSelector
                                models={smartphones}
                                selectedModelIds={newVariantData.modelIds}
                                onSelectionChange={(ids) => setNewVariantData({ ...newVariantData, modelIds: ids })}
                                placeholder="Seleccionar uno o más modelos..."
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Precio Base ($)</Label>
                            <Input
                                type="number"
                                value={newVariantData.price}
                                onChange={(e) => setNewVariantData({ ...newVariantData, price: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Stock Base</Label>
                                <Input
                                    type="number"
                                    placeholder="0 (Opcional si usa variantes)"
                                    value={newVariantData.stock}
                                    onChange={(e) => setNewVariantData({ ...newVariantData, stock: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Foto (Opcional)</Label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="file"
                                        className="hidden"
                                        id="base-img-upload"
                                        accept="image/*"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) setNewVariantData({ ...newVariantData, image_file: f, image_preview: URL.createObjectURL(f) });
                                        }}
                                    />
                                    <Label
                                        htmlFor="base-img-upload"
                                        className={`flex items-center justify-center w-10 h-10 border rounded-lg cursor-pointer transition-all ${newVariantData.image_preview ? 'border-primary' : 'bg-background hover:bg-accent'}`}
                                    >
                                        {newVariantData.image_preview ?
                                            <img src={newVariantData.image_preview} alt="Vista previa" className="w-full h-full object-cover rounded-lg" />
                                            : <Upload className="h-4 w-4 text-muted-foreground" />}
                                    </Label>
                                    {newVariantData.image_preview && (
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setNewVariantData({ ...newVariantData, image_file: null, image_preview: '' })}>
                                            <X className="h-3 w-3" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleCreateVariantItem} disabled={creatingVariant || !newVariantData.categoryId || newVariantData.modelIds.length === 0}>
                            {creatingVariant && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Crear {newVariantData.modelIds.length > 1 ? `(${newVariantData.modelIds.length}) Productos` : 'Producto'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* List */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Smartphone className="h-5 w-5" />
                            Categorías
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setShowHidden(!showHidden)} className="h-8 gap-1 text-xs text-muted-foreground px-2">
                                {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                            <Dialog open={isCreateCatOpen} onOpenChange={setIsCreateCatOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-8 gap-1"><Plus className="h-3 w-3" /> Categoría</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Nueva Categoría</DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label>Nombre (ej: "Vidrio Privacidad")</Label>
                                            <Input
                                                value={newCatName}
                                                onChange={(e) => setNewCatName(e.target.value)}
                                                placeholder="Ingresar nombre..."
                                            />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setIsCreateCatOpen(false)}>Cancelar</Button>
                                        <Button onClick={handleCreateCategory} disabled={creatingVariant || !newCatName.trim()}>
                                            {creatingVariant && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Crear
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>

                    <div className="max-h-[650px] overflow-y-auto pr-2 custom-scrollbar">
                        {accessoryCategories.length === 0 ? (
                            <div className="text-muted-foreground text-sm italic p-8 text-center border rounded-lg bg-muted/20 border-dashed">
                                No hay categorías de accesorios creadas.
                            </div>
                        ) : (
                            <Accordion type="single" collapsible className="w-full space-y-2">
                                {accessoryCategories
                                    .filter(cat => showHidden || !hiddenCategories.includes(cat.id))
                                    .map(cat => {
                                        const catProducts = variantsList.filter(p => p.category_id === cat.id);

                                        // Always show categories even if empty, the user might want to populate them
                                        // if selectedPhoneId has a filter, we hide categories that have absolutely 0 matching results
                                        if (selectedPhoneId !== 'all' && catProducts.length === 0) return null;

                                        return (
                                            <AccordionItem value={cat.id} key={cat.id} className="border rounded-lg bg-card overflow-hidden">
                                                <AccordionTrigger className="hover:no-underline hover:bg-muted/50 px-4 py-3 data-[state=open]:bg-muted/50 transition-colors group">
                                                    <div className="flex items-center justify-between w-full pr-4">
                                                        <span className="font-semibold">{cat.name}</span>
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant="secondary" className="bg-background">{catProducts.length}</Badge>
                                                            <button
                                                                className={`text-muted-foreground p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${hiddenCategories.includes(cat.id) ? 'hover:text-primary hover:bg-primary/10' : 'hover:text-destructive hover:bg-destructive/10'}`}
                                                                onClick={(e) => toggleCategoryVisibility(cat.id, e)}
                                                                title={hiddenCategories.includes(cat.id) ? "Volver a mostrar categoría" : "Ocultar categoría"}
                                                            >
                                                                {hiddenCategories.includes(cat.id) ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </AccordionTrigger>
                                                <AccordionContent className="pt-2 px-2 pb-3 bg-muted/10">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="w-full justify-start text-primary mb-2 bg-primary/5 hover:bg-primary/10 border border-primary/10"
                                                        onClick={() => openCreateProductModalForCategory(cat.id)}
                                                    >
                                                        <Plus className="h-4 w-4 mr-2" />
                                                        Agregar Modelo
                                                    </Button>

                                                    <div className="space-y-2">
                                                        {catProducts.length === 0 ? (
                                                            <p className="text-xs text-muted-foreground text-center py-4 italic">
                                                                Aún no has agregado modelos a esta categoría.
                                                            </p>
                                                        ) : (
                                                            catProducts.map(varItem => (
                                                                <div
                                                                    key={varItem.id}
                                                                    onClick={() => setExpandedVariantItemId(varItem.id)}
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                                            e.preventDefault();
                                                                            setExpandedVariantItemId(varItem.id);
                                                                        }
                                                                    }}
                                                                    className={`relative p-3 rounded-md border cursor-pointer transition-all hover:shadow-sm group text-left ${expandedVariantItemId === varItem.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-background hover:border-primary/50'}`}
                                                                >
                                                                    <div className="flex justify-between items-start mb-1">
                                                                        <h4 className="font-medium text-sm line-clamp-1 pr-6 flex-1">
                                                                            {smartphones.find(s => s.id === varItem.model_id)?.name || varItem.name}
                                                                        </h4>
                                                                        <Badge variant="secondary" className="font-mono text-xs scale-90 origin-right">
                                                                            ${varItem.price}
                                                                        </Badge>
                                                                    </div>
                                                                    <div className="flex items-center text-xs text-muted-foreground mt-2">
                                                                        <span>Variantes activas: {varItem.stock ?? 0}</span>
                                                                    </div>

                                                                    <button
                                                                        className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-destructive/10 bg-background"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleDeleteProduct(varItem.id);
                                                                        }}
                                                                        title="Eliminar producto"
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </button>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </AccordionContent>
                                            </AccordionItem>
                                        );
                                    })}
                            </Accordion>
                        )}
                    </div>
                </div>

                <div className="md:col-span-2">
                    {expandedVariantItemId ? (
                        <Card className="h-full border-primary/20 shadow-sm">
                            <CardHeader className="pb-3 border-b bg-muted/10">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="text-xl">{variantsList.find(c => c.id === expandedVariantItemId)?.name}</CardTitle>
                                        <CardDescription className="mt-1">
                                            Administra las variantes de color para este tipo de accesorio.
                                        </CardDescription>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" onClick={() => {
                                            const item = variantsList.find(c => c.id === expandedVariantItemId);
                                            setEditingVariantItem({
                                                id: item?.id,
                                                name: item?.name,
                                                price: item?.price,
                                                stock: item?.stock || 0,
                                                image_preview: item?.image_url || '',
                                                image_file: null
                                            });
                                        }}>
                                            <Pencil className="h-4 w-4 mr-2" /> Editar
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => setExpandedVariantItemId(null)}>Cerrar</Button>
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
                                            <CreatableAttributeSelector
                                                tableName="colors"
                                                label="Color / Diseño"
                                                selectedValue={newVariant.color}
                                                onValueChange={(val) => setNewVariant({ ...newVariant, color: val })}
                                                placeholder="Seleccionar..."
                                            />
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
                                                        <img src={newVariant.image_preview} alt="Vista previa variante" className="w-full h-full object-cover rounded-lg" />
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
                                            <p>No hay variantes cargadas para esta accesorio.</p>
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
                                                                        background: v.color === 'Transparente'
                                                                            ? 'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 0 0 / 10px 10px'
                                                                            : v.color === 'Multicolor'
                                                                                ? 'linear-gradient(135deg, red, orange, yellow, green, blue, violet)'
                                                                                : getVariantColor(v.color),
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
                                                                className={`transition-all ${variantsList.find(c => c.id === expandedVariantItemId)?.image_url === v.image_url
                                                                    ? 'text-yellow-500 opacity-100 hover:bg-yellow-100/50'
                                                                    : 'text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-yellow-400 hover:bg-yellow-50/50'
                                                                    }`}
                                                                onClick={(e) => handleSetMainImage(v.image_url, e)}
                                                                title={variantsList.find(c => c.id === expandedVariantItemId)?.image_url === v.image_url ? "Imagen Principal Actual" : "Usar como imagen principal"}
                                                            >
                                                                <Star className={`h-4 w-4 ${variantsList.find(c => c.id === expandedVariantItemId)?.image_url === v.image_url ? 'fill-yellow-500' : ''}`} />
                                                            </Button>
                                                        )}
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className={`${v.is_active === false ? 'text-destructive' : 'text-muted-foreground'} hover:text-primary hover:bg-primary/10`}
                                                                onClick={(e) => { e.stopPropagation(); handleToggleVariantActive(v); }}
                                                                title={v.is_active === false ? "Activar variante" : "Inactivar variante"}
                                                            >
                                                                {v.is_active === false ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                                onClick={(e) => { e.stopPropagation(); setEditingVariant(v); }}
                                                                title="Editar variante"
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                                onClick={(e) => { e.stopPropagation(); handleDeleteVariant(v.id, v.stock); }}
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
                            <h3 className="text-lg font-medium text-foreground mb-1">Selecciona una accesorio</h3>
                            <p className="max-w-[300px] text-center text-sm">Elige una accesorio del listado de la izquierda para gestionar sus variantes de color y stock.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Case Dialog */}
            <Dialog open={!!editingVariantItem} onOpenChange={(open) => !open && setEditingVariantItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar Accesorio</DialogTitle>
                    </DialogHeader>
                    {editingVariantItem && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Nombre</Label>
                                <Input value={editingVariantItem.name} onChange={(e) => setEditingVariantItem({ ...editingVariantItem, name: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Precio ($)</Label>
                                <Input type="number" value={editingVariantItem.price} onChange={(e) => setEditingVariantItem({ ...editingVariantItem, price: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Stock Base</Label>
                                <Input type="number" value={editingVariantItem.stock} onChange={(e) => setEditingVariantItem({ ...editingVariantItem, stock: e.target.value })} />
                                <span className="text-xs text-muted-foreground italic">Nota: si el producto tiene variantes declaradas abajo, el stock principal debería dejarse en 0 para evitar descuadres.</span>
                            </div>
                            <div className="space-y-2">
                                <Label>Foto Principal (Opcional)</Label>
                                <div className="flex items-center gap-2 mt-2">
                                    <input
                                        type="file"
                                        className="hidden"
                                        id="edit-base-img-upload"
                                        accept="image/*"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) setEditingVariantItem({ ...editingVariantItem, image_file: f, image_preview: URL.createObjectURL(f) });
                                        }}
                                    />
                                    <Label
                                        htmlFor="edit-base-img-upload"
                                        className={`flex items-center justify-center w-24 h-24 border-2 border-dashed rounded-lg cursor-pointer transition-all ${editingVariantItem.image_preview ? 'border-primary' : 'bg-background hover:bg-accent'}`}
                                    >
                                        {editingVariantItem.image_preview ?
                                            <img src={editingVariantItem.image_preview} alt="Vista previa variante editada" className="w-full h-full object-cover rounded-lg" />
                                            : <Upload className="h-6 w-6 text-muted-foreground" />}
                                    </Label>
                                    {editingVariantItem.image_preview && (
                                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setEditingVariantItem({ ...editingVariantItem, image_file: null, image_preview: '' })}>
                                            <Trash2 className="h-4 w-4 mr-2" /> Quitar Foto
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingVariantItem(null)}>Cancelar</Button>
                        <Button onClick={handleUpdateCase} disabled={creatingVariant}>
                            {creatingVariant && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                            {/* Color picker */}
                            <div className="space-y-2">
                                <Label>Color</Label>
                                <div className="flex flex-wrap gap-2 p-3 bg-muted/30 rounded-lg border">
                                    {FIXED_COLORS.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            title={c}
                                            onClick={() => setEditingVariant({ ...editingVariant, color: c })}
                                            className={`w-8 h-8 rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${editingVariant.color === c ? 'border-primary scale-110 ring-2 ring-primary ring-offset-1' : 'border-border hover:border-primary/60 hover:scale-105'}`}
                                            style={{
                                                background: c === 'Transparente'
                                                    ? 'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 0 0 / 10px 10px'
                                                    : c === 'Multicolor'
                                                        ? 'linear-gradient(135deg, red, orange, yellow, green, blue, violet)'
                                                        : getVariantColor(c),
                                            }}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <div
                                        className="w-8 h-8 rounded-full border flex-shrink-0"
                                        style={{ background: getVariantColor(editingVariant.color) }}
                                    />
                                    <Input
                                        placeholder="Nombre del color (ej: Azul, Rosa, #FF5500)"
                                        value={editingVariant.color}
                                        onChange={(e) => setEditingVariant({ ...editingVariant, color: e.target.value })}
                                        className="flex-1"
                                    />
                                    {/* Lápiz: asignar hex a este nombre de color */}
                                    <label
                                        title={`Asignar color a "${editingVariant.color}"`}
                                        className="relative cursor-pointer flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors border"
                                    >
                                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                        <input
                                            type="color"
                                            className="absolute opacity-0 w-0 h-0"
                                            value={(() => {
                                                const c = getVariantColor(editingVariant.color);
                                                return c.startsWith('#') ? c : '#9CA3AF';
                                            })()}
                                            onChange={async (e) => {
                                                const hex = e.target.value;
                                                const ok = await saveColorHex(editingVariant.color, hex);
                                                if (ok) toast({ title: `Color "${editingVariant.color}" actualizado`, description: hex });
                                                // Forzar re-render refrescando el variant color preview
                                                setEditingVariant({ ...editingVariant, color: editingVariant.color });
                                            }}
                                        />
                                    </label>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Stock</Label>
                                <Input type="number" value={editingVariant.stock} onChange={(e) => setEditingVariant({ ...editingVariant, stock: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Imagen</Label>
                                <div className="flex items-center gap-4">
                                    {editVariantPreview || editingVariant.image_url ? (
                                        <img src={editVariantPreview || editingVariant.image_url} alt="Vista previa de imagen editada" className="h-16 w-16 object-cover rounded border" />
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
            {/* General Stock Update Dialog */}
            <Dialog open={isBatchStockOpen} onOpenChange={setIsBatchStockOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Gestor de Stock Rápido</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>1. Categoría</Label>
                            <Select
                                value={stockUpdateData.catId}
                                onValueChange={(val) => setStockUpdateData(prev => ({ ...prev, catId: val, modelId: '', variantId: '' }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar categoría..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {accessoryCategories
                                        .filter(c => !hiddenCategories.includes(c.id))
                                        .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>2. Modelo de Celular</Label>
                            <Select
                                value={stockUpdateData.modelId}
                                onValueChange={(val) => setStockUpdateData(prev => ({ ...prev, modelId: val, variantId: '' }))}
                                disabled={!stockUpdateData.catId}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar modelo..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {smartphones
                                        .filter(s => modalAvailableModels.includes(s.id))
                                        .map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        {stockUpdateData.modelId && (
                            <div className="space-y-2">
                                <Label>3. Variante (Color/Diseño)</Label>
                                <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto p-1 border rounded-lg">
                                    {modalVariants.length > 0 ? (
                                        modalVariants.map(v => (
                                            <Button
                                                key={v.id}
                                                variant={stockUpdateData.variantId === v.id ? "default" : "outline"}
                                                size="sm"
                                                className="justify-start text-xs h-auto py-2 px-3"
                                                onClick={() => setStockUpdateData(prev => ({ ...prev, variantId: v.id, newStock: String(v.stock) }))}
                                            >
                                                <div className="flex flex-col items-start overflow-hidden">
                                                    <span className="truncate w-full">{v.color}</span>
                                                    <span className="text-[10px] opacity-70">Stock: {v.stock}</span>
                                                </div>
                                            </Button>
                                        ))
                                    ) : (
                                        <p className="col-span-2 text-center text-xs text-muted-foreground py-4">No hay variantes para este modelo.</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {stockUpdateData.variantId && (
                            <div className="space-y-2 pt-2 border-t">
                                <Label className="text-primary font-bold">4. Nuevo Stock para {modalVariants.find(v => v.id === stockUpdateData.variantId)?.color}</Label>
                                <Input
                                    type="number"
                                    value={stockUpdateData.newStock}
                                    onChange={(e) => setStockUpdateData(prev => ({ ...prev, newStock: e.target.value }))}
                                    autoFocus
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsBatchStockOpen(false)}>Cancelar</Button>
                        <Button onClick={handleBatchStockUpdate} disabled={savingVariant || !stockUpdateData.variantId}>
                            {savingVariant && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Actualizar Stock
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
};

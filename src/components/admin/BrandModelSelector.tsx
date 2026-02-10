import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Plus, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';

interface Brand {
    id: string;
    name: string;
}

interface Model {
    id: string;
    name: string;
    brand_id: string;
}

interface BrandModelSelectorProps {
    onBrandChange: (brandId: string, brandName: string) => void;
    onModelChange: (modelId: string, modelName: string) => void;
    selectedBrandId?: string;
    selectedModelId?: string;
}

export function BrandModelSelector({ onBrandChange, onModelChange, selectedBrandId, selectedModelId }: BrandModelSelectorProps) {
    const [brands, setBrands] = useState<Brand[]>([]);
    const [models, setModels] = useState<Model[]>([]);

    const [openBrand, setOpenBrand] = useState(false);
    const [openModel, setOpenModel] = useState(false);

    const [brandSearch, setBrandSearch] = useState("");
    const [modelSearch, setModelSearch] = useState("");

    const [loadingBrands, setLoadingBrands] = useState(false);
    const [loadingModels, setLoadingModels] = useState(false);

    useEffect(() => {
        fetchBrands();
    }, []);

    useEffect(() => {
        if (selectedBrandId) {
            fetchModels(selectedBrandId);
        } else {
            setModels([]);
        }
    }, [selectedBrandId]);

    const fetchBrands = async () => {
        setLoadingBrands(true);
        const { data, error } = await supabase.from('brands').select('*').order('name');
        if (error) console.error('Error fetching brands:', error);
        else setBrands(data || []);
        setLoadingBrands(false);
    };

    const fetchModels = async (brandId: string) => {
        setLoadingModels(true);
        const { data, error } = await supabase.from('models').select('*').eq('brand_id', brandId).order('name');
        if (error) console.error('Error fetching models:', error);
        else setModels(data || []);
        setLoadingModels(false);
    };

    const createBrand = async () => {
        const normalizedName = brandSearch.trim();
        if (!normalizedName) return;

        try {
            const { data, error } = await supabase
                .from('brands')
                .insert({ name: normalizedName })
                .select()
                .single();

            if (error) throw error;

            setBrands([...brands, data]);
            onBrandChange(data.id, data.name);
            setOpenBrand(false);
            setBrandSearch("");
            toast({ title: "Marca creada", description: normalizedName });
        } catch (error: any) {
            toast({ title: "Error", description: "No se pudo crear la marca.", variant: "destructive" });
        }
    };

    const createModel = async () => {
        const normalizedName = modelSearch.trim();
        if (!normalizedName || !selectedBrandId) return;

        try {
            const { data, error } = await supabase
                .from('models')
                .insert({ name: normalizedName, brand_id: selectedBrandId })
                .select()
                .single();

            if (error) throw error;

            setModels([...models, data]);
            onModelChange(data.id, data.name);
            setOpenModel(false);
            setModelSearch("");
            toast({ title: "Modelo creado", description: normalizedName });
        } catch (error: any) {
            toast({ title: "Error", description: "No se pudo crear el modelo.", variant: "destructive" });
        }
    };

    const deleteBrand = async (e: React.MouseEvent, id: string, name: string) => {
        e.stopPropagation();
        if (!confirm(`¿Estás seguro de eliminar la marca "${name}"? Esto podría fallar si hay productos asociados.`)) return;

        try {
            const { error } = await supabase.from('brands').delete().eq('id', id);
            if (error) throw error;

            setBrands(brands.filter(b => b.id !== id));
            if (selectedBrandId === id) onBrandChange('', '');
            toast({ title: "Marca eliminada" });
        } catch (error: any) {
            toast({ title: "Error", description: "No se pudo eliminar. Verifique que no tenga productos asociados.", variant: "destructive" });
        }
    };

    const deleteModel = async (e: React.MouseEvent, id: string, name: string) => {
        e.stopPropagation();
        if (!confirm(`¿Estás seguro de eliminar el modelo "${name}"?`)) return;

        try {
            const { error } = await supabase.from('models').delete().eq('id', id);
            if (error) throw error;

            setModels(models.filter(m => m.id !== id));
            if (selectedModelId === id) onModelChange('', '');
            toast({ title: "Modelo eliminado" });
        } catch (error: any) {
            toast({ title: "Error", description: "No se pudo eliminar el modelo.", variant: "destructive" });
        }
    };

    const selectedBrand = brands.find(b => b.id === selectedBrandId);
    const selectedModel = models.find(m => m.id === selectedModelId);

    return (
        <div className="grid grid-cols-2 gap-4">
            {/* Brand Selector */}
            <div className="space-y-2">
                <Label>Marca</Label>
                <Popover open={openBrand} onOpenChange={setOpenBrand}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={openBrand}
                            className="w-full justify-between"
                        >
                            {selectedBrand ? selectedBrand.name : "Seleccionar marca..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0">
                        <Command>
                            <CommandInput placeholder="Buscar marca..." value={brandSearch} onValueChange={setBrandSearch} />
                            <CommandList>
                                <CommandEmpty>
                                    <Button variant="ghost" className="w-full justify-start text-sm" onClick={createBrand}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Crear "{brandSearch}"
                                    </Button>
                                </CommandEmpty>
                                <CommandGroup>
                                    {brands.map((brand) => (
                                        <CommandItem
                                            key={brand.id}
                                            value={brand.name}
                                            onSelect={() => {
                                                onBrandChange(brand.id, brand.name);
                                                setOpenBrand(false);
                                            }}
                                            className="justify-between group"
                                        >
                                            <div className="flex items-center">
                                                <Check
                                                    className={cn(
                                                        "mr-2 h-4 w-4",
                                                        selectedBrandId === brand.id ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                {brand.name}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                                                onClick={(e) => deleteBrand(e, brand.id, brand.name)}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Model Selector */}
            <div className="space-y-2">
                <Label>Modelo</Label>
                <Popover open={openModel} onOpenChange={setOpenModel}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={openModel}
                            className="w-full justify-between"
                            disabled={!selectedBrandId}
                        >
                            {selectedModel ? selectedModel.name : "Seleccionar modelo..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0">
                        <Command>
                            <CommandInput placeholder="Buscar modelo..." value={modelSearch} onValueChange={setModelSearch} />
                            <CommandList>
                                <CommandEmpty>
                                    <Button variant="ghost" className="w-full justify-start text-sm" onClick={createModel}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Crear "{modelSearch}"
                                    </Button>
                                </CommandEmpty>
                                <CommandGroup>
                                    {models.map((model) => (
                                        <CommandItem
                                            key={model.id}
                                            value={model.name}
                                            onSelect={() => {
                                                onModelChange(model.id, model.name);
                                                setOpenModel(false);
                                            }}
                                            className="justify-between group"
                                        >
                                            <div className="flex items-center">
                                                <Check
                                                    className={cn(
                                                        "mr-2 h-4 w-4",
                                                        selectedModelId === model.id ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                {model.name}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                                                onClick={(e) => deleteModel(e, model.id, model.name)}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}

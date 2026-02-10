import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Plus, Loader2, Trash2 } from "lucide-react";
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

interface Item {
    id: string;
    name: string;
}

interface CreatableResourceSelectorProps {
    tableName: string; // e.g., 'categories'
    label: string;
    value?: string; // ID
    onValueChange: (value: string) => void; // ID
    placeholder?: string;
    filter?: (item: Item) => boolean; // Optional client-side filter
}

export function CreatableResourceSelector({ tableName, label, value, onValueChange, placeholder, filter }: CreatableResourceSelectorProps) {
    const [items, setItems] = useState<Item[]>([]);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        fetchItems();
    }, [tableName]);

    const fetchItems = async () => {
        setLoading(true);
        const { data, error } = await supabase.from(tableName as any).select('id, name').order('name');
        if (error) console.error(`Error fetching ${tableName}:`, error);
        else setItems((data as unknown as Item[]) || []);
        setLoading(false);
    };

    const createItem = async () => {
        const normalizedName = search.trim();
        if (!normalizedName) return;
        setCreating(true);

        try {
            // Capitalize first letter helps with uniformity
            const formattedName = normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1);

            const { data, error } = await supabase
                .from(tableName as any)
                .insert({ name: formattedName })
                .select('id, name')
                .single();

            if (error) throw error;

            const newItem = data as unknown as Item;
            setItems(prev => [...prev, newItem]);
            onValueChange(newItem.id); // Return ID
            setOpen(false);
            setSearch("");
            toast({ title: `${label} creado`, description: formattedName });
        } catch (error: any) {
            toast({ title: "Error", description: `No se pudo crear ${label}. ${error.message}`, variant: "destructive" });
        }
        setCreating(false);
    };

    const deleteItem = async (e: React.MouseEvent, id: string, name: string) => {
        e.stopPropagation(); // Prevent selection when clicking delete
        if (!window.confirm(`¿Estás seguro de que deseas eliminar "${name}"? Esto podría afectar a los productos asociados.`)) return;

        const { error } = await supabase.from(tableName as any).delete().eq('id', id);

        if (error) {
            toast({ title: "Error", description: `No se pudo eliminar. ${error.message}`, variant: "destructive" });
        } else {
            setItems(prev => prev.filter(item => item.id !== id));
            if (value === id) {
                onValueChange(''); // Clear selection if deleted item was selected
            }
            toast({ title: "Eliminado", description: `"${name}" ha sido eliminado.` });
        }
    };

    const filteredItems = filter ? items.filter(filter) : items;
    const selectedItem = items.find(i => i.id === value);

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-full justify-between"
                    >
                        {selectedItem ? selectedItem.name : (placeholder || `Seleccionar ${label.toLowerCase()}...`)}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                    <Command>
                        <CommandInput
                            placeholder={`Buscar ${label.toLowerCase()}...`}
                            value={search}
                            onValueChange={setSearch}
                        />
                        <CommandList>
                            <CommandEmpty className="p-2">
                                <p className="text-sm text-muted-foreground mb-2">"{search}" no existe.</p>
                                <Button size="sm" variant="secondary" className="w-full" onClick={createItem} disabled={creating}>
                                    {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="mr-2 h-4 w-4" />}
                                    Crear "{search}"
                                </Button>
                            </CommandEmpty>
                            <CommandGroup className="max-h-[200px] overflow-y-auto">
                                {filteredItems.map((item) => (
                                    <CommandItem
                                        key={item.id}
                                        value={item.name}
                                        onSelect={() => {
                                            onValueChange(item.id); // Set ID
                                            setOpen(false);
                                            setSearch("");
                                        }}
                                        className="flex items-center justify-between group"
                                    >
                                        <div className="flex items-center">
                                            <Check
                                                className={cn(
                                                    "mr-2 h-4 w-4",
                                                    value === item.id ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            {item.name}
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                                            onClick={(e) => deleteItem(e, item.id, item.name)}
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
    );
}

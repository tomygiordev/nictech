import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Plus } from "lucide-react";
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

interface CreatableAttributeSelectorProps {
    tableName: string; // e.g., 'colors'
    label: string;
    onValueChange: (value: string) => void;
    selectedValue?: string; // Expecting the NAME of the attribute, since we store text in products
    placeholder?: string;
}

export function CreatableAttributeSelector({ tableName, label, onValueChange, selectedValue, placeholder }: CreatableAttributeSelectorProps) {
    const [items, setItems] = useState<Item[]>([]);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchItems();
    }, [tableName]);

    const fetchItems = async () => {
        setLoading(true);
        const { data, error } = await supabase.from(tableName as any).select('*').order('name');
        if (error) console.error(`Error fetching ${tableName}:`, error);
        else setItems(data || []);
        setLoading(false);
    };

    const createItem = async () => {
        const normalizedName = search.trim();
        if (!normalizedName) return;

        try {
            // Capitalize first letter helps with uniformity
            const formattedName = normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1);

            const { data, error } = await supabase
                .from(tableName as any)
                .insert({ name: formattedName })
                .select()
                .single();

            if (error) throw error;

            setItems(prev => [...prev, data]);
            onValueChange(data.name); // Return Name
            setOpen(false);
            setSearch("");
            toast({ title: `${label} creado`, description: formattedName });
        } catch (error: any) {
            toast({ title: "Error", description: `No se pudo crear ${label}. ${error.message}`, variant: "destructive" });
        }
    };

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
                        {selectedValue || placeholder || `Seleccionar ${label.toLowerCase()}...`}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0">
                    <Command>
                        <CommandInput
                            placeholder={`Buscar ${label.toLowerCase()}...`}
                            value={search}
                            onValueChange={setSearch}
                        />
                        <CommandList>
                            <CommandEmpty className="p-2">
                                <p className="text-sm text-muted-foreground mb-2">"{search}" no existe.</p>
                                <Button size="sm" variant="secondary" className="w-full" onClick={createItem}>
                                    <Plus className="mr-2 h-4 w-4" /> Crear "{search}"
                                </Button>
                            </CommandEmpty>
                            <CommandGroup maxHeight="200px" className="overflow-y-auto">
                                {items.map((item) => (
                                    <CommandItem
                                        key={item.id}
                                        value={item.name}
                                        onSelect={() => {
                                            onValueChange(item.name);
                                            setOpen(false);
                                            setSearch("");
                                        }}
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                selectedValue === item.name ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        {item.name}
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

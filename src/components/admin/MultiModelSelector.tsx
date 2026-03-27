
import * as React from "react"
import { Check, ChevronsUpDown, X, Plus, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { supabase } from "@/integrations/supabase/client"
import { toast } from "@/hooks/use-toast"

interface Model {
    id: string
    name: string
}

interface Brand {
    id: string
    name: string
}

interface MultiModelSelectorProps {
    models: Model[]
    selectedModelIds: string[]
    onSelectionChange: (ids: string[]) => void
    onModelCreated?: (model: Model) => void
    placeholder?: string
}

export function MultiModelSelector({
    models,
    selectedModelIds,
    onSelectionChange,
    onModelCreated,
    placeholder = "Seleccionar modelos...",
}: MultiModelSelectorProps) {
    const [open, setOpen] = React.useState(false)
    const [search, setSearch] = React.useState("")

    // Create inline state
    const [creating, setCreating] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [brands, setBrands] = React.useState<Brand[]>([])
    const [newBrandId, setNewBrandId] = React.useState("")
    const [newModelName, setNewModelName] = React.useState("")

    const handleUnselect = (id: string) => {
        onSelectionChange(selectedModelIds.filter((m) => m !== id))
    }

    const startCreating = () => {
        setNewModelName(search)
        setNewBrandId("")
        setCreating(true)
        // Fetch brands if not loaded
        if (brands.length === 0) {
            supabase.from("brands" as any).select("id, name").order("name").then(({ data }) => {
                if (data) setBrands(data as Brand[])
            })
        }
    }

    const handleCreate = async () => {
        if (!newBrandId || !newModelName.trim()) {
            toast({ title: "Completá marca y nombre del modelo", variant: "destructive" })
            return
        }
        setSaving(true)
        const { data, error } = await (supabase as any)
            .from("models")
            .insert({ name: newModelName.trim(), brand_id: newBrandId })
            .select("id, name, brands(name)")
            .single()

        if (error) {
            toast({ title: "Error al crear modelo", description: error.message, variant: "destructive" })
        } else {
            const brand = brands.find(b => b.id === newBrandId)
            const fullName = `${brand?.name ?? ""} ${data.name}`.trim()
            const newModel: Model = { id: data.id, name: fullName }
            toast({ title: "Modelo creado", description: fullName })
            onModelCreated?.(newModel)
            onSelectionChange([...selectedModelIds, data.id])
            setCreating(false)
            setSearch("")
            setNewModelName("")
            setNewBrandId("")
        }
        setSaving(false)
    }

    const filteredModels = search
        ? models.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
        : models

    return (
        <div className="flex flex-col gap-2">
            <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setCreating(false); setSearch("") } }}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-full justify-between min-h-[40px] h-auto py-2"
                    >
                        <div className="flex flex-wrap gap-1">
                            {selectedModelIds.length > 0 ? (
                                <span className="text-sm">
                                    {selectedModelIds.length} seleccionados
                                </span>
                            ) : (
                                <span className="text-muted-foreground">{placeholder}</span>
                            )}
                        </div>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                    {creating ? (
                        <div className="p-3 space-y-3">
                            <p className="text-sm font-semibold">Crear nuevo modelo</p>
                            <Select value={newBrandId} onValueChange={setNewBrandId}>
                                <SelectTrigger className="h-8 text-sm">
                                    <SelectValue placeholder="Seleccionar marca..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {brands.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <input
                                autoFocus
                                className="w-full h-8 px-3 text-sm rounded-md border border-input bg-background outline-none focus:ring-2 focus:ring-ring"
                                placeholder="Nombre del modelo (ej: iPhone 17)"
                                value={newModelName}
                                onChange={e => setNewModelName(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") handleCreate() }}
                            />
                            <div className="flex gap-2">
                                <Button size="sm" className="flex-1 h-8" onClick={handleCreate} disabled={saving}>
                                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                                    Crear
                                </Button>
                                <Button size="sm" variant="outline" className="h-8" onClick={() => setCreating(false)}>
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Command className="w-full">
                            <CommandInput
                                placeholder="Buscar modelo..."
                                value={search}
                                onValueChange={setSearch}
                            />
                            <CommandList className="max-h-72 overflow-y-auto scrollbar-thin">
                                {filteredModels.length === 0 ? (
                                    <div className="py-4 px-3 text-center space-y-2">
                                        <p className="text-sm text-muted-foreground">No se encontró el modelo.</p>
                                        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={startCreating}>
                                            <Plus className="h-3.5 w-3.5" />
                                            Crear "{search || "nuevo modelo"}"
                                        </Button>
                                    </div>
                                ) : (
                                    <CommandGroup>
                                        <CommandItem
                                            onSelect={() => {
                                                const allSelected = selectedModelIds.length === models.length;
                                                onSelectionChange(allSelected ? [] : models.map(m => m.id));
                                            }}
                                            className="font-medium border-b mb-1"
                                        >
                                            <Check className={cn("mr-2 h-4 w-4", selectedModelIds.length === models.length ? "opacity-100" : "opacity-0")} />
                                            Seleccionar Todos
                                        </CommandItem>
                                        {filteredModels.map((model) => (
                                            <CommandItem
                                                key={model.id}
                                                value={model.name}
                                                onSelect={() => {
                                                    const newIds = selectedModelIds.includes(model.id)
                                                        ? selectedModelIds.filter((id) => id !== model.id)
                                                        : [...selectedModelIds, model.id]
                                                    onSelectionChange(newIds)
                                                }}
                                            >
                                                <Check className={cn("mr-2 h-4 w-4", selectedModelIds.includes(model.id) ? "opacity-100" : "opacity-0")} />
                                                {model.name}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                )}
                                {filteredModels.length > 0 && (
                                    <div className="border-t p-2">
                                        <Button size="sm" variant="ghost" className="w-full gap-1.5 h-7 text-xs text-muted-foreground" onClick={startCreating}>
                                            <Plus className="h-3 w-3" />
                                            Crear nuevo modelo
                                        </Button>
                                    </div>
                                )}
                            </CommandList>
                        </Command>
                    )}
                </PopoverContent>
            </Popover>

            {selectedModelIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                    {selectedModelIds.map((id) => {
                        const model = models.find((m) => m.id === id)
                        if (!model) return null
                        return (
                            <Badge key={id} variant="secondary" className="flex items-center gap-1">
                                {model.name}
                                <button
                                    type="button"
                                    onClick={() => handleUnselect(id)}
                                    className="rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                >
                                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                </button>
                            </Badge>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

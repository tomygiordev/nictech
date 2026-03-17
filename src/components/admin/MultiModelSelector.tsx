
import * as React from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
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

interface Model {
    id: string
    name: string
}

interface MultiModelSelectorProps {
    models: Model[]
    selectedModelIds: string[]
    onSelectionChange: (ids: string[]) => void
    placeholder?: string
}

export function MultiModelSelector({
    models,
    selectedModelIds,
    onSelectionChange,
    placeholder = "Seleccionar modelos...",
}: MultiModelSelectorProps) {
    const [open, setOpen] = React.useState(false)

    const handleUnselect = (id: string) => {
        onSelectionChange(selectedModelIds.filter((m) => m !== id))
    }

    return (
        <div className="flex flex-col gap-2">
            <Popover open={open} onOpenChange={setOpen}>
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
                <PopoverContent className="w-[300px] p-0" align="start">
                    <Command className="w-full">
                        <CommandInput placeholder="Buscar modelo..." />
                        <CommandList className="max-h-72 overflow-y-auto scrollbar-thin">
                            <CommandEmpty>No se encontró el modelo.</CommandEmpty>
                            <CommandGroup>
                                <CommandItem
                                    onSelect={() => {
                                        const allSelected = selectedModelIds.length === models.length;
                                        onSelectionChange(allSelected ? [] : models.map(m => m.id));
                                    }}
                                    className="font-medium border-b mb-1"
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            selectedModelIds.length === models.length ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    Seleccionar Todos
                                </CommandItem>
                                {models.map((model) => (
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
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                selectedModelIds.includes(model.id)
                                                    ? "opacity-100"
                                                    : "opacity-0"
                                            )}
                                        />
                                        {model.name}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
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

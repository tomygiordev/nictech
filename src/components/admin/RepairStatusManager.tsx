import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { GripVertical, Plus, Trash2, Settings, Loader2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RepairStatusItem {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
}

// Hook to fetch and manage repair statuses
export const useRepairStatuses = () => {
  const [statuses, setStatuses] = useState<RepairStatusItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatuses = useCallback(async () => {
    const { data } = await supabase
      .from('repair_statuses')
      .select('*')
      .order('sort_order', { ascending: true });
    if (data) setStatuses(data as RepairStatusItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  return { statuses, loading, refetch: fetchStatuses };
};

// Status selector component used in the repairs table
interface RepairStatusSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  statuses: RepairStatusItem[];
  onStatusesChanged: () => void;
}

export const RepairStatusSelect = ({
  value,
  onValueChange,
  statuses,
  onStatusesChanged,
}: RepairStatusSelectProps) => {
  const [managerOpen, setManagerOpen] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-36 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((s) => (
            <SelectItem key={s.id} value={s.name}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Gestionar estados">
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gestionar estados de reparación</DialogTitle>
          </DialogHeader>
          <StatusManagerPanel
            onClose={() => {
              setManagerOpen(false);
              onStatusesChanged();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Full panel for managing statuses (create, reorder, delete)
const StatusManagerPanel = ({ onClose }: { onClose: () => void }) => {
  const [statuses, setStatuses] = useState<RepairStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchStatuses();
  }, []);

  const fetchStatuses = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('repair_statuses')
      .select('*')
      .order('sort_order', { ascending: true });
    if (data) setStatuses(data as RepairStatusItem[]);
    setLoading(false);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;

    // Check duplicate
    if (statuses.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Error', description: 'Ya existe un estado con ese nombre.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const maxOrder = statuses.length > 0 ? Math.max(...statuses.map(s => s.sort_order)) + 1 : 0;

    const { error } = await supabase
      .from('repair_statuses')
      .insert({ name, icon: 'Circle', sort_order: maxOrder });

    if (error) {
      toast({ title: 'Error', description: 'No se pudo crear el estado.', variant: 'destructive' });
    } else {
      toast({ title: 'Estado creado', description: `"${name}" agregado.` });
      setNewName('');
      fetchStatuses();
    }
    setSaving(false);
  };

  const handleDelete = async (status: RepairStatusItem) => {
    // Check if in use
    const { data } = await supabase.rpc('count_repairs_by_status', { status_name: status.name });
    const count = typeof data === 'number' ? data : 0;

    if (count > 0) {
      toast({
        title: 'No se puede eliminar',
        description: `El estado "${status.name}" está en uso por ${count} reparación(es). Cambiá su estado primero.`,
        variant: 'destructive',
      });
      return;
    }

    const { error } = await supabase.from('repair_statuses').delete().eq('id', status.id);
    if (error) {
      toast({ title: 'Error', description: 'No se pudo eliminar.', variant: 'destructive' });
    } else {
      toast({ title: 'Estado eliminado' });
      fetchStatuses();
    }
  };

  // Drag and drop
  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setOverIndex(index);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDrop = async (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      handleDragEnd();
      return;
    }

    const updated = [...statuses];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(targetIndex, 0, moved);

    const reordered = updated.map((s, i) => ({ ...s, sort_order: i }));
    setStatuses(reordered);
    handleDragEnd();

    // Save to DB
    for (const s of reordered) {
      await supabase.from('repair_statuses').update({ sort_order: s.sort_order }).eq('id', s.id);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status list */}
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {statuses.map((status, index) => (
          <div
            key={status.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={() => handleDrop(index)}
            onDragEnd={handleDragEnd}
            className={cn(
              'flex items-center gap-3 p-2.5 rounded-lg border bg-card transition-all',
              dragIndex === index && 'opacity-50 scale-[0.98]',
              overIndex === index && dragIndex !== index && 'border-primary border-2'
            )}
          >
            <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
              <GripVertical className="h-4 w-4" />
            </div>
            <Circle className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium flex-1">{status.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => handleDelete(status)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div className="flex gap-2 pt-2 border-t">
        <Input
          placeholder="Nuevo estado..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          className="flex-1"
        />
        <Button onClick={handleCreate} disabled={saving || !newName.trim()} size="sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
          Agregar
        </Button>
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
};

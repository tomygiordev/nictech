
import { Clock, Check, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

// ... other imports

interface RepairLog {
    id: string;
    created_at: string;
    content: string;
    is_public: boolean;
}

interface RepairLogsProps {
    logs: RepairLog[];
}

export const RepairLogs = ({ logs }: RepairLogsProps) => {
    if (logs.length === 0) return null;

    return (
        <div className="space-y-4">
            {logs.map((log, index) => (
                <div key={log.id} className="relative pl-6 pb-4 border-l border-muted last:pb-0 last:border-l-0">
                    <div className="absolute left-[-5px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                    <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground font-medium">
                            {new Date(log.created_at).toLocaleString('es-PE')}
                        </span>
                        <p className="text-sm text-foreground">{log.content}</p>
                    </div>
                </div>
            ))}
        </div>
    );
};

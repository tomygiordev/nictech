import { useState, useEffect } from 'react';
import { Check, Clock, Package, Wrench, Search, CheckCircle2, Circle, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// Map icon names from DB to actual Lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  PackageCheck: Package,
  Package: Package,
  Search: Search,
  Truck: Truck,
  Clock: Clock,
  Wrench: Wrench,
  CheckCircle: CheckCircle2,
  Circle: Circle,
};

interface StatusStep {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  sort_order: number;
}

// Fallback steps if DB is unavailable
const FALLBACK_STEPS: StatusStep[] = [
  { id: 'Recibido', name: 'Recibido', icon: Package, sort_order: 0 },
  { id: 'Diagnóstico', name: 'Diagnóstico', icon: Search, sort_order: 1 },
  { id: 'Repuestos', name: 'Repuestos', icon: Clock, sort_order: 2 },
  { id: 'Reparación', name: 'Reparación', icon: Wrench, sort_order: 3 },
  { id: 'Finalizado', name: 'Finalizado', icon: CheckCircle2, sort_order: 4 },
];

interface RepairTimelineProps {
  currentStatus: string;
}

export const RepairTimeline = ({ currentStatus }: RepairTimelineProps) => {
  const [steps, setSteps] = useState<StatusStep[]>(FALLBACK_STEPS);

  useEffect(() => {
    const fetchStatuses = async () => {
      const { data } = await supabase
        .from('repair_statuses')
        .select('id, name, icon, sort_order')
        .order('sort_order', { ascending: true });

      if (data && data.length > 0) {
        setSteps(
          (data as any[]).map((s) => ({
            id: s.name,
            name: s.name,
            icon: ICON_MAP[s.icon] || Circle,
            sort_order: s.sort_order,
          }))
        );
      }
    };
    fetchStatuses();
  }, []);

  const currentIndex = steps.findIndex(step => step.id === currentStatus);

  return (
    <div className="w-full">
      {/* Desktop Timeline */}
      <div className="hidden md:block">
        <div className="relative flex justify-between">
          {/* Progress Bar */}
          <div className="absolute top-6 left-0 right-0 h-1 bg-muted rounded-full">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: currentIndex >= 0 ? `${(currentIndex / (steps.length - 1)) * 100}%` : '0%' }}
            />
          </div>

          {/* Steps */}
          {steps.map((step, index) => {
            const isCompleted = currentIndex >= 0 && index < currentIndex;
            const isCurrent = index === currentIndex;
            const isPending = currentIndex < 0 || index > currentIndex;
            const StepIcon = step.icon;

            return (
              <div key={step.id} className="relative flex flex-col items-center">
                {/* Icon Circle */}
                <div
                  className={cn(
                    "relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all duration-300",
                    isCompleted && "bg-primary border-primary",
                    isCurrent && "bg-primary border-primary ring-4 ring-primary/20",
                    isPending && "bg-background border-muted-foreground/30"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-6 w-6 text-primary-foreground" />
                  ) : (
                    <StepIcon
                      className={cn(
                        "h-6 w-6",
                        isCurrent ? "text-primary-foreground" : "text-muted-foreground"
                      )}
                    />
                  )}
                </div>

                {/* Label */}
                <div className="mt-4 text-center">
                  <p
                    className={cn(
                      "font-medium text-sm",
                      (isCompleted || isCurrent) ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {step.name}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile Timeline */}
      <div className="md:hidden space-y-4">
        {steps.map((step, index) => {
          const isCompleted = currentIndex >= 0 && index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = currentIndex < 0 || index > currentIndex;
          const StepIcon = step.icon;

          return (
            <div key={step.id} className="flex items-start gap-4">
              {/* Icon and Line */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all",
                    isCompleted && "bg-primary border-primary",
                    isCurrent && "bg-primary border-primary ring-4 ring-primary/20",
                    isPending && "bg-background border-muted-foreground/30"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5 text-primary-foreground" />
                  ) : (
                    <StepIcon
                      className={cn(
                        "h-5 w-5",
                        isCurrent ? "text-primary-foreground" : "text-muted-foreground"
                      )}
                    />
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      "w-0.5 h-8 mt-2",
                      isCompleted ? "bg-primary" : "bg-muted"
                    )}
                  />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 pb-2">
                <p
                  className={cn(
                    "font-medium",
                    (isCompleted || isCurrent) ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.name}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

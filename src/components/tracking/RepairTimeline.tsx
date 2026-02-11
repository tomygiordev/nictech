import { Check, Clock, Package, Wrench, Search, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const steps = [
  { id: 'Recibido', label: 'Recibido', icon: Package, description: 'Tu dispositivo ha sido recibido' },
  { id: 'Diagnóstico', label: 'Diagnóstico', icon: Search, description: 'Evaluando el problema' },
  { id: 'Repuestos', label: 'Repuestos', icon: Clock, description: 'Esperando piezas necesarias' },
  { id: 'Reparación', label: 'Reparación', icon: Wrench, description: 'En proceso de reparación' },
  { id: 'Finalizado', label: 'Finalizado', icon: CheckCircle2, description: 'Listo para retirar' },
];

interface RepairTimelineProps {
  currentStatus: string;
}

export const RepairTimeline = ({ currentStatus }: RepairTimelineProps) => {
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
              style={{ width: `${(currentIndex / (steps.length - 1)) * 100}%` }}
            />
          </div>

          {/* Steps */}
          {steps.map((step, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isPending = index > currentIndex;

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
                    <step.icon
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
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[120px]">
                    {step.description}
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
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;

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
                    <step.icon
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
                  {step.label}
                </p>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

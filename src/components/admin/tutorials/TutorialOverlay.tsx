import React, { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronRight, ChevronLeft, X, Lightbulb } from 'lucide-react';
import { tutorialData } from './tutorialData';
import { cn } from '@/lib/utils';

export interface TutorialOverlayProps {
  moduleKey: string | null;
  onClose: () => void;
}

export function TutorialOverlay({ moduleKey, onClose }: TutorialOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);

  if (!moduleKey) return null;

  const tutorial = tutorialData[moduleKey as keyof typeof tutorialData];
  if (!tutorial) {
    return (
      <Dialog open={!!moduleKey} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[400px]">
          <div className="p-6 text-center">
            <Lightbulb className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Módulo en desarrollo</h3>
            <p className="text-sm text-muted-foreground mt-2">
              El tutorial para este módulo aún no está disponible.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const step = tutorial.steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === tutorial.steps.length - 1;

  const nextStep = () => !isLast && setCurrentStep(prev => prev + 1);
  const prevStep = () => !isFirst && setCurrentStep(prev => prev - 1);

  return (
    <Dialog open={!!moduleKey} onOpenChange={onClose}>
      <DialogContent className="max-w-[90vw] md:max-w-[800px] h-[90vh] md:h-[600px] flex flex-col p-0 gap-0 overflow-hidden bg-background">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-full">
              <Lightbulb className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">{tutorial.title}</h2>
              <p className="text-xs text-muted-foreground">Paso {currentStep + 1} de {tutorial.steps.length}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          
          {/* Explanation Panel */}
          <div className="w-full md:w-1/3 p-6 bg-muted/10 border-r overflow-y-auto flex flex-col">
            <h3 className="text-xl font-bold mb-4 text-primary">{step.title}</h3>
            <div className="prose prose-sm dark:prose-invert text-muted-foreground whitespace-pre-line flex-1">
              {step.description}
            </div>
            
            {step.limitations && (
              <div className="mt-6 p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg text-sm text-orange-700 dark:text-orange-300">
                <span className="font-semibold block mb-1">Aclaración importante:</span>
                {step.limitations}
              </div>
            )}
          </div>

          {/* Interactive Mockup Panel */}
          <div className="w-full md:w-2/3 p-6 bg-accent/30 flex items-center justify-center overflow-hidden">
            <div className="w-full h-full max-h-[400px] bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col relative">
               {step.mockup}
            </div>
          </div>
        </div>

        {/* Footer Controls */}
        <div className="p-4 border-t flex items-center justify-between bg-muted/30">
          <div className="flex gap-1">
            {tutorial.steps.map((_, idx) => (
              <div 
                key={idx} 
                className={cn(
                  "h-2 rounded-full transition-all duration-300",
                  idx === currentStep ? "w-8 bg-primary" : "w-2 bg-primary/20"
                )} 
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={prevStep} disabled={isFirst}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
            </Button>
            {isLast ? (
              <Button onClick={onClose}>
                Finalizar
              </Button>
            ) : (
              <Button onClick={nextStep}>
                Siguiente <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}

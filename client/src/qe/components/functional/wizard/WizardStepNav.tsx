import { motion } from 'framer-motion';
import { Settings, Globe, GitBranch, FileText, Code, Play, BarChart2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const WIZARD_STEPS = [
  { id: 1, label: 'Configure', icon: Settings, description: 'URL, auth & mode' },
  { id: 2, label: 'Crawl', icon: Globe, description: 'Discover pages' },
  { id: 3, label: 'Diagram', icon: GitBranch, description: 'Workflow map' },
  { id: 4, label: 'Test Cases', icon: FileText, description: 'AI test generation' },
  { id: 5, label: 'Scripts', icon: Code, description: 'POM / BDD code' },
  { id: 6, label: 'Execute', icon: Play, description: 'Run automation' },
  { id: 7, label: 'Report', icon: BarChart2, description: 'Results & export' },
] as const;

interface WizardStepNavProps {
  currentStep: number;
  completedSteps: number[];
  onStepClick: (step: number) => void;
}

export function WizardStepNav({ currentStep, completedSteps, onStepClick }: WizardStepNavProps) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center min-w-max px-2 py-3">
        {WIZARD_STEPS.map((step, index) => {
          const isCompleted = completedSteps.includes(step.id);
          const isCurrent = currentStep === step.id;
          const isClickable = isCompleted || isCurrent;
          const Icon = step.icon;

          return (
            <div key={step.id} className="flex items-center">
              {/* Step */}
              <button
                onClick={() => isClickable && onStepClick(step.id)}
                disabled={!isClickable}
                className={cn(
                  'flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-all duration-200 group',
                  isClickable ? 'cursor-pointer hover:bg-muted/60' : 'cursor-not-allowed opacity-40',
                )}
              >
                {/* Circle */}
                <motion.div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-200',
                    isCurrent && 'border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/30',
                    isCompleted && !isCurrent && 'border-emerald-500 bg-emerald-500 text-white',
                    !isCurrent && !isCompleted && 'border-border bg-muted text-muted-foreground',
                  )}
                  animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  {isCompleted && !isCurrent ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </motion.div>

                {/* Label */}
                <div className="text-center">
                  <p className={cn(
                    'text-[11px] font-semibold leading-tight',
                    isCurrent ? 'text-primary' : isCompleted ? 'text-emerald-600' : 'text-muted-foreground'
                  )}>
                    {step.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground hidden sm:block">{step.description}</p>
                </div>
              </button>

              {/* Connector */}
              {index < WIZARD_STEPS.length - 1 && (
                <div className="flex items-center px-1">
                  <motion.div
                    className={cn(
                      'h-0.5 w-8',
                      completedSteps.includes(step.id) ? 'bg-emerald-400' : 'bg-border'
                    )}
                    animate={completedSteps.includes(step.id) ? { scaleX: 1 } : { scaleX: 0.3 }}
                    style={{ transformOrigin: 'left' }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

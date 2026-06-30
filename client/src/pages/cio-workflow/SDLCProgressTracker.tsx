import React from 'react';
import {
  FileText,
  CheckCircle2,
  Lock,
  Palette,
  Code2,
  Rocket,
  CheckCircle,
} from 'lucide-react';
import { SDLCStage, StageState } from './types';

export default function SDLCProgressTracker({
  activeStage,
  stageStates,
  onStageSelect,
  selectedAdoProject,
}: {
  activeStage: SDLCStage;
  stageStates: Record<SDLCStage, StageState>;
  onStageSelect: (stage: SDLCStage) => void;
  selectedAdoProject: any;
}) {
  const stages: { id: SDLCStage; label: string; desc: string; icon: any; color: string; bgColor: string; activeBorder: string }[] = [
    { id: 'BRD', label: 'BRD', desc: 'Requirements', icon: FileText, color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-900/50', activeBorder: 'border-blue-500' },
    { id: 'Design', label: 'Design', desc: 'Architecture', icon: Palette, color: 'text-violet-600', bgColor: 'bg-violet-100 dark:bg-violet-900/50', activeBorder: 'border-violet-500' },
    { id: 'CodeGen', label: 'CodeGen', desc: 'Development', icon: Code2, color: 'text-emerald-600', bgColor: 'bg-emerald-100 dark:bg-emerald-900/50', activeBorder: 'border-emerald-500' },
    { id: 'Deploy', label: 'Deploy', desc: 'Release', icon: Rocket, color: 'text-amber-600', bgColor: 'bg-amber-100 dark:bg-amber-900/50', activeBorder: 'border-amber-500' },
    { id: 'QA', label: 'QA', desc: 'Testing', icon: CheckCircle, color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-900/50', activeBorder: 'border-blue-500' },
  ];

  return (
    <div className="flex items-center w-full">
      {stages.map((stage, index) => {
        const state = stageStates[stage.id];
        const isActive = activeStage === stage.id;
        const isCompleted = state.status === 'completed';
        const isLocked = state.status === 'locked';
        const isReview = state.status === 'review';
        const isLastStage = index === stages.length - 1;
        const Icon = stage.icon;

        return (
          <React.Fragment key={stage.id}>
            <button
              onClick={() => onStageSelect(stage.id)}
              disabled={isLocked}
              className={`flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 transition-all duration-200 ${
                isActive
                  ? `${stage.activeBorder} bg-primary/5 shadow-md ring-1 ring-primary/10`
                  : isCompleted
                  ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30 hover:shadow-sm cursor-pointer'
                  : isLocked
                  ? 'border-border bg-muted/50 opacity-50 cursor-not-allowed'
                  : 'border-border bg-card hover:bg-muted/50 hover:shadow-sm cursor-pointer'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isCompleted
                    ? 'bg-emerald-500'
                    : isActive
                    ? stage.bgColor
                    : isLocked
                    ? 'bg-muted'
                    : stage.bgColor
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={2.5} />
                ) : isLocked ? (
                  <Lock className="w-4 h-4 text-muted-foreground" strokeWidth={2} />
                ) : (
                  <Icon
                    className={`w-5 h-5 ${stage.color}`}
                    strokeWidth={2}
                  />
                )}
              </div>

              <div className="text-left">
                <div className={`text-sm font-semibold leading-tight ${
                  isCompleted
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : isActive
                    ? 'text-foreground'
                    : isLocked
                    ? 'text-muted-foreground'
                    : 'text-foreground'
                }`}>
                  {stage.label}
                </div>
                <div className={`text-[11px] leading-tight ${
                  isCompleted
                    ? 'text-emerald-500/70 dark:text-emerald-400/60'
                    : isLocked
                    ? 'text-muted-foreground/60'
                    : 'text-muted-foreground'
                }`}>
                  {isCompleted ? 'Completed' : isReview ? 'In Review' : stage.desc}
                </div>
              </div>

              {isReview && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/80 dark:text-yellow-300 ml-1">
                  Review
                </span>
              )}
            </button>

            {!isLastStage && (
              <div className={`w-8 flex-shrink-0 flex items-center justify-center`}>
                <div className={`w-full h-0.5 ${isCompleted ? 'bg-emerald-500' : 'bg-border'}`} />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

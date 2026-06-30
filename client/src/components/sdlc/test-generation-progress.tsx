import { CheckCircle2, Loader2, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type GenerationStage = 'manual' | 'features' | 'stepDefinitions';
export type StageStatus = 'pending' | 'in-progress' | 'completed' | 'error';

export interface GenerationStageInfo {
  id: GenerationStage;
  title: string;
  description: string;
  status: StageStatus;
  errorMessage?: string;
}

interface TestGenerationProgressProps {
  stages: GenerationStageInfo[];
  currentStage?: GenerationStage;
}

export function TestGenerationProgress({ stages, currentStage }: TestGenerationProgressProps) {
  const getStageIcon = (status: StageStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-6 w-6 text-green-500" />;
      case 'in-progress':
        return <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />;
      case 'error':
        return <div className="h-6 w-6 rounded-full bg-red-500 flex items-center justify-center text-white text-xs font-bold">!</div>;
      default:
        return <Clock className="h-6 w-6 text-gray-400" />;
    }
  };

  const getStatusColor = (status: StageStatus) => {
    switch (status) {
      case 'completed':
        return 'border-green-500 bg-green-50 dark:bg-green-950';
      case 'in-progress':
        return 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-lg';
      case 'error':
        return 'border-red-500 bg-red-50 dark:bg-red-950';
      default:
        return 'border-gray-300 bg-gray-50 dark:bg-gray-900';
    }
  };

  const getStatusText = (status: StageStatus) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'in-progress':
        return 'In Progress...';
      case 'error':
        return 'Failed';
      default:
        return 'Pending';
    }
  };

  return (
    <div className="w-full space-y-4 p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Test Asset Generation Pipeline
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Generating complete BDD test suite with features and step definitions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {stages.filter(s => s.status === 'completed').length} / {stages.length} Completed
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {stages.map((stage, index) => (
          <div key={stage.id} className="relative">
            {/* Connector line to next stage */}
            {index < stages.length - 1 && (
              <div className={cn(
                "absolute left-[21px] top-[60px] w-[2px] h-[24px] transition-colors duration-500",
                stage.status === 'completed' ? 'bg-green-500' : 'bg-gray-300'
              )} />
            )}

            <Card className={cn(
              "transition-all duration-500 border-2",
              getStatusColor(stage.status),
              stage.id === currentStage && 'ring-2 ring-blue-400 ring-offset-2'
            )}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="flex-shrink-0 mt-1">
                    {getStageIcon(stage.status)}
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-base text-slate-800 dark:text-slate-200">
                        {stage.title}
                      </h4>
                      <span className={cn(
                        "text-xs font-medium px-2 py-1 rounded-full",
                        stage.status === 'completed' && 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
                        stage.status === 'in-progress' && 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
                        stage.status === 'error' && 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
                        stage.status === 'pending' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                      )}>
                        {getStatusText(stage.status)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      {stage.description}
                    </p>
                    {stage.status === 'error' && stage.errorMessage && (
                      <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded text-xs text-red-700 dark:text-red-300">
                        {stage.errorMessage}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {/* Overall Progress Bar */}
      <div className="mt-6 pt-4 border-t border-slate-300 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Overall Progress</span>
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {Math.round((stages.filter(s => s.status === 'completed').length / stages.length) * 100)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-500 to-green-500 h-full rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${(stages.filter(s => s.status === 'completed').length / stages.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

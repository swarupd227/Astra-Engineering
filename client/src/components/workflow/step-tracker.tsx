import { Check } from "lucide-react";
import { useWorkflow } from "@/context/workflow-context";
import { getIntegrationLabels } from "@/lib/integration-config";

export function StepTracker() {
  const { currentStep, step1Complete, step3Complete, integrationType } = useWorkflow();

  const steps = [
    { number: 1, label: "Requirements", completed: step1Complete },
    { number: 2, label: "Generated Content", completed: currentStep > 2 },
    { number: 3, label: `${getIntegrationLabels(integrationType).name} Push`, completed: step3Complete },
  ];

  return (
    <div className="flex items-center justify-center gap-2 md:gap-4 py-8">
      {steps.map((step, index) => (
        <div key={step.number} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all ${
                step.completed
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : currentStep === step.number
                    ? "border-primary bg-primary text-primary-foreground animate-pulse"
                    : "border-border bg-background text-muted-foreground"
              }`}
              data-testid={`step-${step.number}`}
            >
              {step.completed ? (
                <Check className="h-6 w-6" />
              ) : (
                <span className="text-lg font-semibold">{step.number}</span>
              )}
            </div>
            <p className="mt-2 text-sm font-medium text-center">
              Step {step.number}: {step.label}
            </p>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`h-0.5 w-16 md:w-24 mx-2 transition-colors ${
                currentStep > step.number ? "bg-emerald-500" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { LiveMetric } from "@shared/qe-schema";
import { useEffect, useState } from "react";

interface LiveMetricsProps {
  metrics: LiveMetric[];
}

function AnimatedCounter({ target }: { target: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const duration = 500;
    const steps = 30;
    const stepValue = target / steps;
    const stepDuration = duration / steps;

    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      if (currentStep >= steps) {
        setCount(target);
        clearInterval(interval);
      } else {
        setCount(Math.floor(stepValue * currentStep));
      }
    }, stepDuration);

    return () => clearInterval(interval);
  }, [target]);

  return <span>{count}</span>;
}

export function LiveMetrics({ metrics }: LiveMetricsProps) {
  return (
    <Card className="p-6 sticky top-4" data-testid="live-metrics-panel">
      <h3 className="text-lg font-bold text-foreground mb-4">Live Metrics</h3>
      
      <div className="space-y-4">
        {metrics.map((metric, index) => (
          <motion.div
            key={metric.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="space-y-2"
            data-testid={`metric-${metric.id}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{metric.emoji}</span>
                <span className="text-sm font-semibold text-foreground">{metric.label}</span>
              </div>
              <span className="text-2xl font-bold text-primary" data-testid={`metric-value-${metric.id}`}>
                <AnimatedCounter target={metric.currentValue} />
                {metric.unit}
              </span>
            </div>
            
            <Progress 
              value={(metric.currentValue / metric.targetValue) * 100} 
              className="h-2"
              data-testid={`metric-progress-${metric.id}`}
            />
            
            <p className="text-xs text-muted-foreground">
              Target: {metric.targetValue}{metric.unit}
            </p>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}

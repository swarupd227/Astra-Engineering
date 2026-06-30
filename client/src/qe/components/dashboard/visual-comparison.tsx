import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function VisualComparison() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      data-testid="visual-comparison"
    >
      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-4">Visual Comparison</h3>
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Figma Design (Baseline)</p>
            <div className="aspect-video bg-muted rounded-md border border-border flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-chart-3/20" />
              <div className="relative z-10 text-center p-4">
                <div className="w-full h-32 bg-card rounded-md mb-2 shadow-md" />
                <div className="grid grid-cols-3 gap-2">
                  <div className="h-8 bg-card rounded" />
                  <div className="h-8 bg-card rounded" />
                  <div className="h-8 bg-card rounded" />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Live Website (Current)</p>
            <div className="aspect-video bg-muted rounded-md border border-border flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-chart-2/20" />
              <div className="relative z-10 text-center p-4">
                <div className="w-full h-32 bg-card rounded-md mb-2 shadow-md relative">
                  <motion.div
                    className="absolute top-2 right-2 w-12 h-3 border-2 border-destructive bg-destructive/10 rounded"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="h-8 bg-card rounded" />
                  <div className="h-8 bg-card rounded" />
                  <div className="h-8 bg-card rounded relative">
                    <motion.div
                      className="absolute inset-0 border-2 border-destructive bg-destructive/10 rounded"
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-2">
            <div className="w-2 h-2 rounded-full bg-destructive" />
            <span>4 differences detected in header region</span>
          </Badge>
          <Badge variant="outline" className="gap-2">
            <div className="w-2 h-2 rounded-full bg-chart-2" />
            <span>1 minor spacing issue in footer</span>
          </Badge>
        </div>
      </Card>
    </motion.div>
  );
}

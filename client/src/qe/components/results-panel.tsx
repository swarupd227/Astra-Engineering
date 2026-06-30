import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Download, RefreshCw } from "lucide-react";
import type { TestResults } from "@shared/qe-schema";

interface ResultsPanelProps {
  results: TestResults;
  onRunAnother: () => void;
}

export function ResultsPanel({ results, onRunAnother }: ResultsPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="flex items-center justify-center py-8"
      data-testid="results-panel"
    >
      <Card className="w-full max-w-2xl p-8">
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-chart-3/20 mb-4"
          >
            <CheckCircle2 className="w-10 h-10 text-chart-3" />
          </motion.div>
          
          <h2 className="text-2xl font-bold text-foreground mb-1">
            Visual Regression Analysis Complete
          </h2>
          <p className="text-sm text-muted-foreground">
            Testing completed in {results.completionTime} seconds
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="p-4 rounded-md bg-chart-3/10 border border-chart-3/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-chart-3" />
              <span className="text-sm font-semibold text-foreground">Design Compliance</span>
            </div>
            <p className="text-3xl font-bold text-chart-3">{results.designCompliance}%</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-4 rounded-md bg-chart-2/10 border border-chart-2/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-chart-2" />
              <span className="text-sm font-semibold text-foreground">Accessibility</span>
            </div>
            <p className="text-3xl font-bold text-chart-2">{results.accessibilityWarnings}</p>
            <p className="text-xs text-muted-foreground">Warnings</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="p-4 rounded-md bg-primary/10 border border-primary/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              <span className="text-sm font-semibold text-foreground">Test Cases</span>
            </div>
            <p className="text-3xl font-bold text-primary">{results.testCasesGenerated}</p>
            <p className="text-xs text-muted-foreground">Generated</p>
          </motion.div>
        </div>

        {results.visualDifferences.length > 0 && (
          <div className="mb-6 p-4 rounded-md bg-muted">
            <h4 className="text-sm font-semibold text-foreground mb-2">Visual Differences Detected</h4>
            <div className="space-y-1">
              {results.visualDifferences.map((diff, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{diff.area}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{diff.count} issues</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      diff.severity === "major" ? "bg-destructive/20 text-destructive" : "bg-chart-2/20 text-chart-2"
                    }`}>
                      {diff.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button className="flex-1 min-h-10" variant="default" data-testid="button-download-report">
            <Download className="w-4 h-4 mr-2" />
            Download Full Report
          </Button>
          <Button 
            className="flex-1 min-h-10" 
            variant="outline" 
            onClick={onRunAnother}
            data-testid="button-run-another"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Run Another Test
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

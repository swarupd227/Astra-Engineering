import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { Feature } from "@shared/schema";
import { Star } from "lucide-react";

interface FeatureModalProps {
  feature: Feature;
  open: boolean;
  onClose: () => void;
}

const priorityColors = {
  High: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  Medium: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  Low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

export function FeatureModal({ feature, open, onClose }: FeatureModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Star className="h-6 w-6 text-blue-600 dark:text-blue-400 fill-blue-600 dark:fill-blue-400" />
            {feature.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Feature Header */}
          <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/20 dark:to-blue-900/20 rounded-lg border-2 border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={priorityColors[feature.priority]}>
                {feature.priority} Priority
              </Badge>
              {feature.storyCount !== undefined && (
                <Badge variant="secondary">
                  {feature.storyCount} User Stor{feature.storyCount !== 1 ? 'ies' : 'y'}
                </Badge>
              )}
            </div>
          </div>

          {/* Feature Details */}
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">Description</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>

            {/* Additional Feature Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Type</p>
                <p className="text-sm font-medium">Feature</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Priority Level</p>
                <p className="text-sm font-medium">{feature.priority}</p>
              </div>
              {feature.epicId && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Epic ID</p>
                  <p className="text-sm font-mono text-muted-foreground">{feature.epicId}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

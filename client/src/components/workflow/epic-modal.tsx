import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { Epic } from "@shared/schema";
import { Layers } from "lucide-react";

interface EpicModalProps {
  epic: Epic;
  open: boolean;
  onClose: () => void;
}

const priorityColors = {
  High: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  Medium: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  Low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

export function EpicModal({ epic, open, onClose }: EpicModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Layers className="h-6 w-6 text-red-600 dark:text-red-400" />
            {epic.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Epic Header */}
          <div className="p-4 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/20 dark:to-red-900/20 rounded-lg border-2 border-red-200 dark:border-red-800">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={priorityColors[epic.priority]}>
                {epic.priority} Priority
              </Badge>
              {epic.featureCount !== undefined && (
                <Badge variant="secondary">
                  {epic.featureCount} Feature{epic.featureCount !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>
          </div>

          {/* Epic Details */}
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">Description</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {epic.description}
              </p>
            </div>

            {/* Additional Epic Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Type</p>
                <p className="text-sm font-medium">Epic</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Priority Level</p>
                <p className="text-sm font-medium">{epic.priority}</p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

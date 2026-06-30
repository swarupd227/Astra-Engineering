import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RefreshCw, FileText, Users, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface RegenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmRegenerate: () => void;
  mapping: {
    id: string;
    epicTitle: string;
    epicId: string;
    userStories: Array<{
      id: string;
      title: string;
    }>;
  };
  projectName: string;
}

export function RegenerateModal({
  isOpen,
  onClose,
  onConfirmRegenerate,
  mapping,
  projectName,
}: RegenerateModalProps) {
  const handleRegenerate = () => {
    onConfirmRegenerate();
    onClose();
  };

  // Don't render if mapping is null
  if (!mapping) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-blue-600" />
            Regenerate Design
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  Project: {projectName}
                </h4>
              </div>
              
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">Epic #{mapping.epicId}:</span>
                <span className="text-sm text-muted-foreground">{mapping.epicTitle}</span>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">
                    User Stories ({mapping.userStories?.length || 0})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {mapping.userStories?.map((story, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      #{story.id}
                    </Badge>
                  )) || (
                    <span className="text-xs text-muted-foreground">No user stories</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleRegenerate} className="flex-1">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Generate Design
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
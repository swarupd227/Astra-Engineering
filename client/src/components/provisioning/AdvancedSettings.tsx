import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import type { TagPair } from "@/types/provisioning.types";

interface AdvancedSettingsProps {
  enableLogging: boolean;
  autoDeleteDays: number | null;
  tags: TagPair[];
  onEnableLoggingChange: (enabled: boolean) => void;
  onAutoDeleteDaysChange: (days: number | null) => void;
  onTagsChange: (tags: TagPair[]) => void;
}

export function AdvancedSettings({
  enableLogging,
  autoDeleteDays,
  tags,
  onEnableLoggingChange,
  onAutoDeleteDaysChange,
  onTagsChange,
}: AdvancedSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const addTag = () => {
    onTagsChange([...tags, { key: "", value: "" }]);
  };

  const removeTag = (index: number) => {
    onTagsChange(tags.filter((_, i) => i !== index));
  };

  const updateTag = (index: number, field: "key" | "value", value: string) => {
    const updatedTags = tags.map((tag, i) =>
      i === index ? { ...tag, [field]: value } : tag
    );
    onTagsChange(updatedTags);
  };

  const handleAutoDeleteDaysChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    if (numValue === null || (!isNaN(numValue) && numValue > 0)) {
      onAutoDeleteDaysChange(numValue);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-4 py-3 hover:bg-muted/50 transition-colors">
        <span className="text-sm font-medium">Advanced Settings</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-4">
        {/* Enable Logging Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="enable-logging">Enable Application Logging</Label>
            <p className="text-xs text-muted-foreground">
              Enable detailed logging for monitoring and debugging
            </p>
          </div>
          <Switch
            id="enable-logging"
            checked={enableLogging}
            onCheckedChange={onEnableLoggingChange}
          />
        </div>

        {/* Auto-delete after X days */}
        <div className="space-y-2">
          <Label htmlFor="auto-delete-days">Auto-delete after (days)</Label>
          <Input
            id="auto-delete-days"
            type="number"
            min="1"
            max="365"
            placeholder="Leave empty for no auto-deletion"
            value={autoDeleteDays?.toString() || ""}
            onChange={(e) => handleAutoDeleteDaysChange(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Automatically delete the instance after specified number of days
          </p>
        </div>

        {/* Tags Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Tags</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTag}
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Tag
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Add custom tags for better resource organization
          </p>

          {tags.length > 0 && (
            <div className="space-y-2">
              {tags.map((tag, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1">
                    <Input
                      placeholder="Key"
                      value={tag.key}
                      onChange={(e) => updateTag(index, "key", e.target.value)}
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Input
                      placeholder="Value"
                      value={tag.value}
                      onChange={(e) => updateTag(index, "value", e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTag(index)}
                    className="h-9 w-9 p-0 text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
 
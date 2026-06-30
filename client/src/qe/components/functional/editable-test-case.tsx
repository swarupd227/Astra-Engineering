import { useState, useCallback, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  ChevronDown, ChevronUp, GripVertical, Plus, Trash2, Copy, 
  Edit2, Save, X, ArrowUp, ArrowDown, RotateCcw 
} from "lucide-react";

export interface EditableTestStep {
  step_number: number;
  action: string;
  expected_behavior: string;
}

export interface EditableTestCase {
  id: string;
  testCaseId: string;
  title: string;
  description?: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'Smoke' | 'Sanity' | 'Regression' | 'Critical' | 'High' | 'Medium' | 'Low';
  type: 'Functional' | 'Edge Case' | 'Negative' | 'Boundary' | 'Security' | 'Accessibility' | 'Performance';
  category?: string;
  status: 'Original' | 'Modified' | 'New';
  preconditions?: string;
  steps: EditableTestStep[];
  expectedResults?: string;
  testData?: string;
  sourceReference?: string;
  tags?: string[];
  notes?: string;
  originalVersion?: EditableTestCase;
  createdAt: Date;
  modifiedAt: Date;
}

interface EditableTestCaseCardProps {
  testCase: EditableTestCase;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
  onUpdate: (updated: EditableTestCase) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function EditableTestCaseCard({
  testCase,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onDuplicate,
}: EditableTestCaseCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCase, setEditedCase] = useState(testCase);
  const [draggedStepIndex, setDraggedStepIndex] = useState<number | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setEditedCase(testCase);
  }, [testCase]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, 2000);
  }, []);

  const handleSave = () => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    const newStatus: 'Original' | 'Modified' | 'New' = testCase.status === 'New' ? 'New' : 'Modified';
    const updated: EditableTestCase = {
      ...editedCase,
      status: newStatus,
      modifiedAt: new Date(),
    };
    onUpdate(updated);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedCase(testCase);
    setIsEditing(false);
  };

  const handleRevert = () => {
    if (testCase.originalVersion) {
      onUpdate({
        ...testCase.originalVersion,
        status: 'Original',
        modifiedAt: new Date(),
      });
    }
  };

  const updateField = <K extends keyof EditableTestCase>(field: K, value: EditableTestCase[K]) => {
    setEditedCase(prev => ({ ...prev, [field]: value }));
    scheduleAutoSave();
  };

  const addStep = (afterIndex?: number) => {
    const newStep: EditableTestStep = {
      step_number: 0,
      action: '',
      expected_behavior: '',
    };

    let newSteps: EditableTestStep[];
    if (afterIndex !== undefined) {
      newSteps = [
        ...editedCase.steps.slice(0, afterIndex + 1),
        newStep,
        ...editedCase.steps.slice(afterIndex + 1),
      ];
    } else {
      newSteps = [...editedCase.steps, newStep];
    }

    newSteps = newSteps.map((step, idx) => ({ ...step, step_number: idx + 1 }));
    updateField('steps', newSteps);
  };

  const updateStep = (index: number, field: keyof EditableTestStep, value: string | number) => {
    const newSteps = editedCase.steps.map((step, idx) =>
      idx === index ? { ...step, [field]: value } : step
    );
    updateField('steps', newSteps);
  };

  const deleteStep = (index: number) => {
    const newSteps = editedCase.steps
      .filter((_, idx) => idx !== index)
      .map((step, idx) => ({ ...step, step_number: idx + 1 }));
    updateField('steps', newSteps);
  };

  const duplicateStep = (index: number) => {
    const stepToCopy = editedCase.steps[index];
    const newSteps = [
      ...editedCase.steps.slice(0, index + 1),
      { ...stepToCopy, step_number: 0 },
      ...editedCase.steps.slice(index + 1),
    ].map((step, idx) => ({ ...step, step_number: idx + 1 }));
    updateField('steps', newSteps);
  };

  const moveStep = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= editedCase.steps.length) return;
    const newSteps = [...editedCase.steps];
    const [moved] = newSteps.splice(fromIndex, 1);
    newSteps.splice(toIndex, 0, moved);
    const renumbered = newSteps.map((step, idx) => ({ ...step, step_number: idx + 1 }));
    updateField('steps', renumbered);
  };

  const handleDragStart = (index: number) => {
    setDraggedStepIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedStepIndex !== null && draggedStepIndex !== index) {
      moveStep(draggedStepIndex, index);
      setDraggedStepIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedStepIndex(null);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'P0': case 'Critical': case 'Smoke': return 'bg-red-500/20 text-red-400';
      case 'P1': case 'High': case 'Sanity': return 'bg-orange-500/20 text-orange-400';
      case 'P2': case 'Medium': case 'Regression': return 'bg-yellow-500/20 text-yellow-400';
      case 'P3': case 'Low': return 'bg-blue-500/20 text-blue-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Original': return 'bg-green-500/20 text-green-400';
      case 'Modified': return 'bg-amber-500/20 text-amber-400';
      case 'New': return 'bg-primary/20 text-primary';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card className="overflow-hidden" data-testid={`test-case-card-${testCase.id}`}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="p-4 flex items-center gap-3">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelect}
            data-testid={`checkbox-select-${testCase.id}`}
          />

          <CollapsibleTrigger className="flex-1 flex items-center gap-3 text-left">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-sm text-muted-foreground">{testCase.testCaseId}</span>
                <span className="font-medium truncate">{testCase.title}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={`${getPriorityColor(testCase.priority)} text-xs`}>
                  {testCase.priority}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {testCase.type}
                </Badge>
                <Badge className={`${getStatusColor(testCase.status)} text-xs`}>
                  {testCase.status}
                </Badge>
              </div>
            </div>
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </CollapsibleTrigger>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); setIsExpanded(true); setIsEditing(true); }}
              data-testid={`button-edit-${testCase.id}`}
            >
              <Edit2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
              data-testid={`button-duplicate-${testCase.id}`}
            >
              <Copy className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              data-testid={`button-delete-${testCase.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t border-border p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Test Case ID</Label>
                <Input
                  value={editedCase.testCaseId}
                  onChange={(e) => updateField('testCaseId', e.target.value)}
                  disabled={!isEditing}
                  className="mt-1"
                  data-testid={`input-testcaseid-${testCase.id}`}
                />
              </div>
              <div>
                <Label>Title</Label>
                <Input
                  value={editedCase.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  disabled={!isEditing}
                  className="mt-1"
                  data-testid={`input-title-${testCase.id}`}
                />
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={editedCase.description || ''}
                onChange={(e) => updateField('description', e.target.value)}
                disabled={!isEditing}
                className="mt-1"
                rows={2}
                data-testid={`textarea-description-${testCase.id}`}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Priority</Label>
                <Select
                  value={editedCase.priority}
                  onValueChange={(v) => updateField('priority', v as EditableTestCase['priority'])}
                  disabled={!isEditing}
                >
                  <SelectTrigger className="mt-1" data-testid={`select-priority-${testCase.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Smoke">Smoke</SelectItem>
                    <SelectItem value="Sanity">Sanity</SelectItem>
                    <SelectItem value="Regression">Regression</SelectItem>
                    <SelectItem value="Critical">Critical</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select
                  value={editedCase.type}
                  onValueChange={(v) => updateField('type', v as EditableTestCase['type'])}
                  disabled={!isEditing}
                >
                  <SelectTrigger className="mt-1" data-testid={`select-type-${testCase.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Functional">Functional</SelectItem>
                    <SelectItem value="Edge Case">Edge Case</SelectItem>
                    <SelectItem value="Negative">Negative</SelectItem>
                    <SelectItem value="Boundary">Boundary</SelectItem>
                    <SelectItem value="Security">Security</SelectItem>
                    <SelectItem value="Accessibility">Accessibility</SelectItem>
                    <SelectItem value="Performance">Performance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Source Reference</Label>
                <Input
                  value={editedCase.sourceReference || ''}
                  onChange={(e) => updateField('sourceReference', e.target.value)}
                  disabled={!isEditing}
                  className="mt-1"
                  placeholder="Document or URL source"
                  data-testid={`input-source-${testCase.id}`}
                />
              </div>
            </div>

            <div>
              <Label>Preconditions</Label>
              <Textarea
                value={editedCase.preconditions || ''}
                onChange={(e) => updateField('preconditions', e.target.value)}
                disabled={!isEditing}
                className="mt-1"
                rows={2}
                placeholder="Prerequisites for this test case"
                data-testid={`textarea-preconditions-${testCase.id}`}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Test Steps</Label>
                {isEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addStep()}
                    data-testid={`button-add-step-${testCase.id}`}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Step
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {editedCase.steps.map((step, index) => (
                  <div
                    key={index}
                    draggable={isEditing}
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex gap-2 p-3 rounded-lg border ${
                      draggedStepIndex === index ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'
                    }`}
                    data-testid={`step-row-${testCase.id}-${index}`}
                  >
                    {isEditing && (
                      <div className="cursor-grab">
                        <GripVertical className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-medium">
                      {step.step_number}
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={step.action}
                        onChange={(e) => updateStep(index, 'action', e.target.value)}
                        disabled={!isEditing}
                        placeholder="Step action"
                        className="text-sm"
                        data-testid={`input-step-action-${testCase.id}-${index}`}
                      />
                      <Input
                        value={step.expected_behavior}
                        onChange={(e) => updateStep(index, 'expected_behavior', e.target.value)}
                        disabled={!isEditing}
                        placeholder="Expected behavior"
                        className="text-sm text-muted-foreground"
                        data-testid={`input-step-expected-${testCase.id}-${index}`}
                      />
                    </div>
                    {isEditing && (
                      <div className="flex flex-col gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => moveStep(index, index - 1)}
                          disabled={index === 0}
                        >
                          <ArrowUp className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => moveStep(index, index + 1)}
                          disabled={index === editedCase.steps.length - 1}
                        >
                          <ArrowDown className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => duplicateStep(index)}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => deleteStep(index)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Expected Results</Label>
                <Textarea
                  value={editedCase.expectedResults || ''}
                  onChange={(e) => updateField('expectedResults', e.target.value)}
                  disabled={!isEditing}
                  className="mt-1"
                  rows={2}
                  data-testid={`textarea-expected-${testCase.id}`}
                />
              </div>
              <div>
                <Label>Test Data</Label>
                <Textarea
                  value={editedCase.testData || ''}
                  onChange={(e) => updateField('testData', e.target.value)}
                  disabled={!isEditing}
                  className="mt-1"
                  rows={2}
                  placeholder="Sample test data"
                  data-testid={`textarea-testdata-${testCase.id}`}
                />
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={editedCase.notes || ''}
                onChange={(e) => updateField('notes', e.target.value)}
                disabled={!isEditing}
                className="mt-1"
                rows={2}
                placeholder="Additional notes or comments"
                data-testid={`textarea-notes-${testCase.id}`}
              />
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground">
                Created: {testCase.createdAt.toLocaleString()} | Modified: {testCase.modifiedAt.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={handleCancel}>
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave} data-testid={`button-save-${testCase.id}`}>
                      <Save className="w-4 h-4 mr-1" />
                      Save Changes
                    </Button>
                  </>
                ) : (
                  <>
                    {testCase.status === 'Modified' && testCase.originalVersion && (
                      <Button variant="outline" size="sm" onClick={handleRevert}>
                        <RotateCcw className="w-4 h-4 mr-1" />
                        Revert to Original
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                      <Edit2 className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

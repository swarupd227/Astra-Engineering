import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  FileText,
  Target,
  Users,
  Clock,
  DollarSign,
  Sparkles,
  Paperclip,
  X,
  ImagePlus,
  Image as ImageIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";


const BRD_TEMPLATE_PREVIEWS: Record<
  string,
  { label: string; description: string; preview: string }
> = {
  gold_1_0: {
    label: "Gold 1.0",
    description:
      "Enterprise-focused BRD structure with strict sectioning and traceability.",
    preview: `# Business Requirements Document

## 1. Document Information
## 2. Executive Summary
## 3. Introduction
### 3.1 Purpose
### 3.2 Scope
### 3.3 Definitions and Acronyms
## 4. Business Objectives
### 4.1 Business Goals
### 4.2 Success Criteria
### 4.3 Key Performance Indicators (KPIs)
## 5. Stakeholder Analysis
### 5.1 Key Stakeholders
### 5.2 User Personas
## 6. Requirements
### 6.1 Functional Requirements
### 6.2 Non-Functional Requirements
### 6.3 Technical Requirements
### 6.4 Integration Requirements
## 7. Business Rules
## 8. Data Requirements
### 8.1 Data Entities
### 8.2 Data Migration
## 9. Constraints and Assumptions
### 9.1 Constraints
### 9.2 Assumptions
### 9.3 Dependencies
## 10. Risks and Mitigation
## 11. Timeline and Milestones
## 12. Appendices
### 12.1 Reference Documents
### 12.2 Approval Matrix
## 13. Additional Organizational Guidelines`,
  },
  standard: {
    label: "Standard",
    description: "General BRD structure for common project documentation.",
    preview: `# Business Requirements Document

## 1. Document Information
## 2. Executive Summary
## 3. Introduction
## 4. Business Objectives
## 5. Stakeholder Analysis
## 6. Requirements
## 7. Business Rules
## 8. Data Requirements
## 9. Constraints and Assumptions
## 10. Risks and Mitigation
## 11. Timeline and Milestones
## 12. Appendices`,
  },
};

const brdFormSchema = z.object({
  brdName: z.string().optional(), // Optional - only required for new BRDs, validated in handleGenerate
  projectName: z.string().min(1, "Project name is required"),
  projectDescription: z
    .string()
    .min(10, "Please provide at least 10 characters describing your project"),
  businessObjectives: z.string().optional(),
  targetAudience: z.string().optional(),
  keyFeatures: z.string().optional(),
  constraints: z.string().optional(),
  successCriteria: z.string().optional(),
  timeline: z.string().optional(),
  budget: z.string().optional(),
  stakeholders: z.string().optional(),
  existingRequirements: z.string().optional(),
  useGoldenRepo: z.boolean().optional(),
});


export type BRDFormData = z.infer<typeof brdFormSchema>;

interface BRDInputFormProps {
  onSubmit: (data: BRDFormData) => void;
  isGenerating: boolean;
  defaultProjectName?: string | null;
  selectedBRDId?: string;
  tokenInfo?: {
    tokenQuota: number;
    tokenUsed: number;
    remainingTokens: number;
    tokenCost: number;
    canConsume: boolean;
    lowBalance?: boolean;
    isDepleted?: boolean;
  };
  brdData?: {
    brdName?: string;
    projectDescription?: string;
    businessObjectives?: string;
    successCriteria?: string;
    targetAudience?: string;
    stakeholders?: string;
    keyFeatures?: string;
    existingRequirements?: string;
    constraints?: string;
    timeline?: string;
    budget?: string;
    useGoldenRepo?: boolean;
  };

  onSave?: (data: BRDFormData) => void;
  onSaveBrdName?: (brdName: string) => Promise<void>; // Separate handler for BRD name save on blur
  onDirtyChange?: (isDirty: boolean) => void; // Notify parent when any field has been filled
  onReset?: () => void; // Notify parent when the form is explicitly reset
  // Confluence reference files (controlled by parent brd.tsx)
  confluenceFiles?: File[];
  onConfluenceFilesChange?: (files: File[]) => void;
  // Diagram / architecture images (controlled by parent brd.tsx)
  diagramImages?: File[];
  onDiagramImagesChange?: (files: File[]) => void;
}

export function BRDInputForm({
  onSubmit,
  isGenerating,
  defaultProjectName = "",
  selectedBRDId,
  tokenInfo,
  brdData,
  onSave,
  onSaveBrdName,
  onDirtyChange,
  onReset,
  confluenceFiles = [],
  onConfluenceFilesChange,
  diagramImages = [],
  onDiagramImagesChange,
}: BRDInputFormProps) {
  const { toast } = useToast();
  // Ref for the hidden file input for Confluence uploads
  const confluenceInputRef = useRef<HTMLInputElement>(null);
  // Ref for the hidden file input for diagram image uploads
  const diagramInputRef = useRef<HTMLInputElement>(null);
  const [diagramWarning, setDiagramWarning] = useState(false);

  const MAX_DIAGRAM_IMAGES = 5;
  const MAX_DIAGRAM_SIZE_MB = 10;
  const DIAGRAM_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
  const ALLOWED_DIAGRAM_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];

  const form = useForm<BRDFormData>({
    resolver: zodResolver(brdFormSchema),
    defaultValues: {
      brdName: brdData?.brdName || "",
      projectName: defaultProjectName || "",
      projectDescription: brdData?.projectDescription || "",
      businessObjectives: brdData?.businessObjectives || "",
      targetAudience: brdData?.targetAudience || "",
      keyFeatures: brdData?.keyFeatures || "",
      constraints: brdData?.constraints || "",
      successCriteria: brdData?.successCriteria || "",
      timeline: brdData?.timeline || "",
      budget: brdData?.budget || "",
      stakeholders: brdData?.stakeholders || "",
      existingRequirements: brdData?.existingRequirements || "",
      useGoldenRepo: brdData?.useGoldenRepo ?? true,
    },
  });

  // Local state for Golden Repo toggle to persist user choice across data reloads
  const [localUseGoldenRepo, setLocalUseGoldenRepo] = useState(brdData?.useGoldenRepo ?? true);


  // Helper function to ensure BRD name has "BRD-" prefix
  const ensureBrdPrefix = (name: string | undefined | null): string => {
    if (!name || name.trim() === "") return "";
    const trimmed = name.trim();
    return trimmed.startsWith("BRD-") ? trimmed : `BRD-${trimmed}`;
  };

  // Track which BRD ID we've loaded data for - prevents re-loading when brdData refetches
  const loadedBRDIdRef = useRef<string | undefined>(undefined);

  // Load BRD data ONLY when selectedBRDId changes (not when brdData refetches)
  // This effect handles clearing the form when BRD is deselected and resets the loaded flag
  useEffect(() => {
    // When selectedBRDId changes, reset the loaded flag so data can be loaded by the second effect
    if (selectedBRDId !== loadedBRDIdRef.current) {
      if (!selectedBRDId) {
        // Mark as cleared and clear form when no BRD is selected
        loadedBRDIdRef.current = undefined;

        form.reset({
          brdName: "",
          projectName: defaultProjectName || "",
          projectDescription: "",
          businessObjectives: "",
          targetAudience: "",
          keyFeatures: "",
          constraints: "",
          successCriteria: "",
          timeline: "",
          budget: "",
          stakeholders: "",
          existingRequirements: "",
          useGoldenRepo: true,
        });

        setLocalUseGoldenRepo(true);

        // Reset the initial mount flag
        isInitialMountRef.current = true;
        lastSavedValuesRef.current = "";
      } else {
        // Reset the loaded flag when a new BRD is selected, so the second effect can load it
        loadedBRDIdRef.current = undefined;
      }
    }
    // CRITICAL: Only depend on selectedBRDId - do NOT include brdData or form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBRDId]);

  // Separate effect: when brdData becomes available for the first time for current selectedBRDId
  // This handles the case where selectedBRDId changes but brdData is still loading (async)
  // We track whether we've loaded data using loadedBRDIdRef to prevent re-loading on refetches
  useEffect(() => {
    // Only load if:
    // 1. We have a selectedBRDId
    // 2. brdData is available (has at least one property)
    // 3. We haven't loaded data for this BRD ID yet
    const hasBrdData =
      brdData &&
      (brdData.brdName !== undefined ||
        brdData.projectDescription !== undefined);

    if (
      selectedBRDId &&
      hasBrdData &&
      loadedBRDIdRef.current !== selectedBRDId
    ) {
      // Mark this BRD as loaded BEFORE resetting
      loadedBRDIdRef.current = selectedBRDId;

      // Ensure BRD name has prefix when loading
      const brdNameWithPrefix = ensureBrdPrefix(brdData.brdName);
      const resolvedUseGoldenRepo = brdData.useGoldenRepo ?? true;

      form.reset({
        brdName: brdNameWithPrefix,
        projectName: defaultProjectName || "",
        projectDescription: brdData.projectDescription || "",
        businessObjectives: brdData.businessObjectives || "",
        targetAudience: brdData.targetAudience || "",
        keyFeatures: brdData.keyFeatures || "",
        constraints: brdData.constraints || "",
        successCriteria: brdData.successCriteria || "",
        timeline: brdData.timeline || "",
        budget: brdData.budget || "",
        stakeholders: brdData.stakeholders || "",
        existingRequirements: brdData.existingRequirements || "",
        useGoldenRepo: resolvedUseGoldenRepo,
      });

      setLocalUseGoldenRepo(resolvedUseGoldenRepo);

      // Reset the initial mount flag
      isInitialMountRef.current = true;
      lastSavedValuesRef.current = "";
    }
    // Depend on both selectedBRDId and brdData, but use loadedBRDIdRef to prevent re-loading on refetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBRDId, brdData]);

  // Keep project name in sync when provided externally (separate from BRD loading)
  useEffect(() => {
    if (
      defaultProjectName &&
      form.getValues("projectName") !== defaultProjectName
    ) {
      form.setValue("projectName", defaultProjectName, {
        shouldValidate: false,
      });
    }
  }, [defaultProjectName, form]);

  // Auto-save with debounce
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMountRef = useRef(true);
  const lastSavedValuesRef = useRef<string>("");

  // Watch all form values except projectName and brdName (brdName saves only on blur)
  const brdName = form.watch("brdName");
  const projectDescription = form.watch("projectDescription");
  const businessObjectives = form.watch("businessObjectives");
  const successCriteria = form.watch("successCriteria");
  const targetAudience = form.watch("targetAudience");
  const stakeholders = form.watch("stakeholders");
  const keyFeatures = form.watch("keyFeatures");
  const existingRequirements = form.watch("existingRequirements");
  const constraints = form.watch("constraints");
  const timeline = form.watch("timeline");
  const budget = form.watch("budget");

  // Inform parent when user has entered any BRD details (for unsaved-change warnings)
  useEffect(() => {
    if (!onDirtyChange) return;

    const fieldsToCheck = [
      brdName,
      projectDescription,
      businessObjectives,
      successCriteria,
      targetAudience,
      stakeholders,
      keyFeatures,
      existingRequirements,
      constraints,
      timeline,
      budget,
    ];

    const hasAnyValue = fieldsToCheck.some(
      (value) => typeof value === "string" && value.trim() !== ""
    );

    onDirtyChange(hasAnyValue);
  }, [
    brdName,
    projectDescription,
    businessObjectives,
    successCriteria,
    targetAudience,
    stakeholders,
    keyFeatures,
    existingRequirements,
    constraints,
    timeline,
    budget,
    onDirtyChange,
  ]);

  useEffect(() => {
    // Skip auto-save on initial mount (when BRD data is first loaded)
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      // Store current values as the "last saved" state (excluding brdName)
      const currentValues = JSON.stringify({
        projectDescription,
        businessObjectives,
        successCriteria,
        targetAudience,
        stakeholders,
        keyFeatures,
        existingRequirements,
        constraints,
        timeline,
        budget,
      });
      lastSavedValuesRef.current = currentValues;
      return;
    }

    if (!selectedBRDId || !onSave) return;

    // Create a string representation of current values (excluding brdName)
    const currentValues = JSON.stringify({
      projectDescription,
      businessObjectives,
      successCriteria,
      targetAudience,
      stakeholders,
      keyFeatures,
      existingRequirements,
      constraints,
      timeline,
      budget,
    });

    // Only save if values have actually changed
    if (currentValues === lastSavedValuesRef.current) {
      return;
    }

    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for debounced save
    saveTimeoutRef.current = setTimeout(() => {
      const formData = form.getValues();
      onSave(formData);
      // Update last saved values after successful save
      lastSavedValuesRef.current = currentValues;
    }, 500); // 500ms debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    projectDescription,
    businessObjectives,
    successCriteria,
    targetAudience,
    stakeholders,
    keyFeatures,
    existingRequirements,
    constraints,
    timeline,
    budget,
    selectedBRDId,
    onSave,
    form,
  ]);

  // Reset initial mount flag when BRD changes
  useEffect(() => {
    isInitialMountRef.current = true;
    lastSavedValuesRef.current = "";
  }, [selectedBRDId]);

  const renderEnhancer = (fieldName: keyof BRDFormData, itemName?: string) => {
    const value = form.watch(fieldName);
    if (typeof value !== "string") return null;

    return (
      <AiEnhanceWithDiff
        locationKey="brd.field"
        value={value || ""}
        onEnhanced={(enhancedText) =>
          form.setValue(fieldName, enhancedText as any, { shouldValidate: true })
        }
        buttonVariant="ghost"
        buttonSize="sm"
        className="justify-end"
        itemName={
          itemName || fieldName.charAt(0).toUpperCase() + fieldName.slice(1)
        }
      />
    );
  };


  const handleReset = () => {
    const isExistingBRD = !!selectedBRDId;

    form.reset({
      // For existing BRDs, keep the BRD name read-only and unchanged.
      // For new BRDs, clear the name so it can be edited again.
      brdName: isExistingBRD ? form.getValues("brdName") : "",
      projectName: defaultProjectName || "",
      projectDescription: "",
      businessObjectives: "",
      targetAudience: "",
      keyFeatures: "",
      constraints: "",
      successCriteria: "",
      timeline: "",
      budget: "",
      stakeholders: "",
      existingRequirements: "",
      useGoldenRepo: true,
    });

    setLocalUseGoldenRepo(true);
    onReset?.();
  };


  return (
    <Card className="lg:h-full min-h-0 flex flex-col overflow-hidden">
      <CardHeader className="pb-4">
        <div className="rounded-lg border bg-muted/50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1 pt-0.5">
              <CardTitle className="leading-tight">BRD Generator</CardTitle>
              <CardDescription className="mt-1 leading-relaxed">
                Fill in your project details to generate a professional Business
                Requirements Document
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0 flex flex-col">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col h-full"
          >
            <ScrollArea className="flex-1 px-6 pt-6">
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="brdName"
                  render={({ field }) => {
                    // Strip "BRD-" prefix when displaying
                    const displayValue = field.value?.startsWith("BRD-")
                      ? field.value.substring(4)
                      : field.value || "";

                    // Only allow editing BRD name for new BRDs (when no selectedBRDId)
                    const isNewBRD = !selectedBRDId;

                    return (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          BRD Name {isNewBRD ? "*" : ""}
                        </FormLabel>
                        <FormControl>
                          {isNewBRD ? (
                            // Editable input for new BRDs
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-muted-foreground">
                                BRD-
                              </span>
                              <Input
                                placeholder="e.g., Customer Portal Requirements v1.0"
                                value={displayValue}
                                onChange={(e) => {
                                  const customName = e.target.value.trim();
                                  // Automatically add "BRD-" prefix when user types
                                  const fullName = customName
                                    ? `BRD-${customName}`
                                    : "";
                                  field.onChange(fullName);
                                }}
                                onBlur={field.onBlur}
                                disabled={isGenerating}
                                data-testid="input-brd-name"
                                className="flex-1"
                              />
                            </div>
                          ) : (
                            // Read-only display for existing BRDs
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-muted-foreground">
                                BRD-
                              </span>
                              <div className="flex-1 px-3 py-2 bg-muted/60 rounded-md text-sm font-medium">
                                {displayValue || "No name"}
                              </div>
                            </div>
                          )}
                        </FormControl>
                        <FormDescription>
                          {isNewBRD
                            ? "A unique name to identify this BRD document (without 'BRD-' prefix)"
                            : "BRD name cannot be changed after creation"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                <FormField
                  control={form.control}
                  name="projectName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Project Name *
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Customer Portal Redesign"
                          {...field}
                          readOnly
                          disabled={isGenerating}
                          className="bg-muted/60"
                          data-testid="input-project-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />



                <FormField
                  control={form.control}
                  name="useGoldenRepo"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          Use Golden Repo Guidance
                        </FormLabel>
                        <FormDescription>
                          Enable RAG guidance from organizational golden repositories for higher quality results.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={localUseGoldenRepo}
                          onCheckedChange={(checked) => {
                            setLocalUseGoldenRepo(checked);
                            field.onChange(checked);
                          }}
                          disabled={isGenerating}
                          data-testid="toggle-use-golden-repo"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="projectDescription"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Project Description *</FormLabel>
                        {renderEnhancer("projectDescription")}
                      </div>
                      <FormControl>
                        <Textarea
                          placeholder="Describe your project, its purpose, and what problem it solves..."
                          className="min-h-[120px] resize-none"
                          {...field}
                          disabled={isGenerating}
                          data-testid="input-project-description"
                        />
                      </FormControl>
                      <FormDescription>
                        Provide a detailed overview of your project to help
                        generate comprehensive requirements
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="business">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        <span>Business Details</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-4">
                      <FormField
                        control={form.control}
                        name="businessObjectives"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Business Objectives</FormLabel>
                              {renderEnhancer("businessObjectives")}
                            </div>
                            <FormControl>
                              <Textarea
                                placeholder="What are the main business goals this project aims to achieve?"
                                className="min-h-[80px] resize-none"
                                {...field}
                                disabled={isGenerating}
                                data-testid="input-business-objectives"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="successCriteria"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Success Criteria</FormLabel>
                              {renderEnhancer("successCriteria")}
                            </div>
                            <FormControl>
                              <Textarea
                                placeholder="How will you measure the success of this project?"
                                className="min-h-[80px] resize-none"
                                {...field}
                                disabled={isGenerating}
                                data-testid="input-success-criteria"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="users">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <span>Users & Stakeholders</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-4">
                      <FormField
                        control={form.control}
                        name="targetAudience"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Target Audience</FormLabel>
                              {renderEnhancer("targetAudience")}
                            </div>
                            <FormControl>
                              <Textarea
                                placeholder="Who are the primary users of this system? Describe their roles and needs."
                                className="min-h-[80px] resize-none"
                                {...field}
                                disabled={isGenerating}
                                data-testid="input-target-audience"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="stakeholders"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Key Stakeholders</FormLabel>
                              {renderEnhancer("stakeholders")}
                            </div>
                            <FormControl>
                              <Textarea
                                placeholder="List the key stakeholders and their interests in this project"
                                className="min-h-[80px] resize-none"
                                {...field}
                                disabled={isGenerating}
                                data-testid="input-stakeholders"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="features">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span>Features & Requirements</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-4">
                      <FormField
                        control={form.control}
                        name="keyFeatures"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Key Features</FormLabel>
                              {renderEnhancer("keyFeatures")}
                            </div>
                            <FormControl>
                              <Textarea
                                placeholder="List the main features and capabilities this system should have"
                                className="min-h-[80px] resize-none"
                                {...field}
                                disabled={isGenerating}
                                data-testid="input-key-features"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="existingRequirements"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Existing Requirements</FormLabel>
                              {renderEnhancer("existingRequirements")}
                            </div>
                            <FormControl>
                              <Textarea
                                placeholder="Paste any existing requirements, notes, or context that should be incorporated"
                                className="min-h-[80px] resize-none"
                                {...field}
                                disabled={isGenerating}
                                data-testid="input-existing-requirements"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="constraints">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        <span>Constraints & Resources</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-4">
                      <FormField
                        control={form.control}
                        name="constraints"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Constraints</FormLabel>
                              {renderEnhancer("constraints")}
                            </div>
                            <FormControl>
                              <Textarea
                                placeholder="What are the technical, regulatory, or other constraints?"
                                className="min-h-[80px] resize-none"
                                {...field}
                                disabled={isGenerating}
                                data-testid="input-constraints"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </ScrollArea>

            {/* ── Confluence Reference Panel ─────────────────────────────── */}
            <div className="border-t px-6 py-3 bg-muted/30 shrink-0">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Confluence Reference
                  </span>
                </div>

                {/* File badges */}
                {confluenceFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {confluenceFiles.map((file, idx) => (
                      <span
                        key={`${file.name}-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 px-3 py-1 text-xs font-medium text-blue-800 dark:text-blue-200 max-w-[220px]"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate" title={file.name}>{file.name}</span>
                        <button
                          type="button"
                          disabled={isGenerating}
                          className="ml-0.5 rounded-full hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          onClick={() =>
                            onConfluenceFilesChange?.(
                              confluenceFiles.filter((_, i) => i !== idx),
                            )
                          }
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add button — hidden when 2 files already attached */}
                {confluenceFiles.length < 2 && (
                  <button
                    type="button"
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-blue-400 dark:border-blue-600 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    onClick={() => confluenceInputRef.current?.click()}
                  >
                    <Paperclip className="h-3 w-3" />
                    Attach Confluence page (.docx)
                  </button>
                )}

                {/* Hidden file input */}
                <input
                  ref={confluenceInputRef}
                  type="file"
                  accept=".docx,.doc"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const incoming = Array.from(e.target.files ?? []);
                    if (incoming.length === 0) return;
                    const combined = [...confluenceFiles, ...incoming].slice(0, 2);
                    if (confluenceFiles.length + incoming.length > 2) {
                      toast({
                        title: "Max 2 files allowed",
                        description:
                          "You can attach at most 2 Confluence Word exports.",
                        variant: "destructive",
                      });
                    }
                    onConfluenceFilesChange?.(combined);
                    // Reset the input so the same file can be re-selected after removal
                    e.target.value = "";
                  }}
                />

                <span className="text-xs text-muted-foreground ml-auto self-center">
                  {confluenceFiles.length === 0
                    ? "Attach up to 2 Confluence Word exports to use as reference"
                    : confluenceFiles.length === 2
                    ? "2 / 2 files attached"
                    : `${confluenceFiles.length} / 2 file${confluenceFiles.length !== 1 ? "s" : ""} attached`}
                </span>
              </div>
            </div>

            {/* ── Diagram / Architecture Image Attachment Panel ──────────── */}
            <div className="border-t px-6 py-3 bg-muted/20 shrink-0">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ImagePlus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Diagrams &amp; Images
                  </span>
                </div>

                {/* Image badge pills */}
                {diagramImages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {diagramImages.map((img, idx) => (
                      <span
                        key={`${img.name}-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-700 px-3 py-1 text-xs font-medium text-violet-800 dark:text-violet-200 max-w-[220px]"
                      >
                        <ImageIcon className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate" title={img.name}>{img.name}</span>
                        <button
                          type="button"
                          disabled={isGenerating}
                          className="ml-0.5 rounded-full hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          onClick={() =>
                            onDiagramImagesChange?.(diagramImages.filter((_, i) => i !== idx))
                          }
                          aria-label={`Remove ${img.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add button — hidden when cap reached */}
                {diagramImages.length < MAX_DIAGRAM_IMAGES && (
                  <button
                    type="button"
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-violet-400 dark:border-violet-600 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    onClick={() => diagramInputRef.current?.click()}
                  >
                    <ImagePlus className="h-3 w-3" />
                    Attach diagram / screenshot
                  </button>
                )}

                {/* Hidden file input */}
                <input
                  ref={diagramInputRef}
                  type="file"
                  accept={DIAGRAM_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const incoming = Array.from(e.target.files ?? []);
                    if (incoming.length === 0) return;
                    const valid = incoming.filter((f) => {
                      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
                      if (!ALLOWED_DIAGRAM_EXTS.includes(ext)) return false;
                      if (f.size > MAX_DIAGRAM_SIZE_MB * 1024 * 1024) return false;
                      return true;
                    });
                    const combined = [...diagramImages, ...valid].slice(0, MAX_DIAGRAM_IMAGES);
                    const overflow = diagramImages.length + valid.length > MAX_DIAGRAM_IMAGES;
                    setDiagramWarning(overflow);
                    if (overflow) setTimeout(() => setDiagramWarning(false), 3000);
                    onDiagramImagesChange?.(combined);
                    e.target.value = "";
                  }}
                />

                <span className="text-xs text-muted-foreground ml-auto self-center">
                  {diagramWarning
                    ? `Max ${MAX_DIAGRAM_IMAGES} images — extra ignored`
                    : diagramImages.length === 0
                    ? `Attach up to ${MAX_DIAGRAM_IMAGES} workflow/architecture diagrams (PNG, JPEG, WEBP, GIF · max ${MAX_DIAGRAM_SIZE_MB} MB each)`
                    : diagramImages.length === MAX_DIAGRAM_IMAGES
                    ? `${MAX_DIAGRAM_IMAGES} / ${MAX_DIAGRAM_IMAGES} images attached`
                    : `${diagramImages.length} / ${MAX_DIAGRAM_IMAGES} image${diagramImages.length !== 1 ? "s" : ""} attached`}
                </span>
              </div>
            </div>


            <div className="border-t px-6 py-4 bg-background shrink-0">
              {tokenInfo && (
                <div className="mb-2 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {/* <span className="text-muted-foreground">
                      Tokens Remaining:{" "}
                      {tokenInfo.remainingTokens.toLocaleString()} /{" "}
                      {tokenInfo.tokenQuota.toLocaleString()}
                    </span> */}
                    {tokenInfo.isDepleted ? (
                      <Badge variant="destructive" className="text-xs">
                        No tokens remaining
                      </Badge>
                    ) : tokenInfo.lowBalance ? (
                      <Badge
                        variant="outline"
                        className="text-xs border-amber-500 text-amber-700 bg-amber-50 dark:border-amber-500/70 dark:text-amber-300 dark:bg-amber-500/10"
                      >
                        Low balance
                      </Badge>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={isGenerating}
                  onClick={handleReset}
                  className="w-32"
                  data-testid="button-reset-brd"
                >
                  Reset
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  size="lg"
                  disabled={isGenerating || (tokenInfo != null && !tokenInfo.canConsume)}
                  data-testid="button-generate-brd"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Generating BRD...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" />
                      Generate BRD
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

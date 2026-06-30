import { z } from "zod";

export const pipelineCreationModeSchema = z.enum([
  "yamlRepoMode",
  "yamlGeneratedMode",
  "existingPipelineMode",
  "cloneDefinitionMode",
  "templateMode",
]);

export const infraBootstrapOptionSchema = z.enum([
  "none",
  "resourceGroupOnly",
  "appServiceBootstrap",
  "swaBootstrap",
]);

export const templateScopeSchema = z.enum(["project", "organization", "global"]);

export const pipelineTemplateSpecSchema = z.object({
  baseMode: pipelineCreationModeSchema,
  defaultPipelineName: z.string().optional(),
  yamlPath: z.string().optional(),
  repoStrategy: z.enum(["required", "optional", "none"]).default("optional"),
  branchStrategy: z.enum(["required", "optional", "none"]).default("optional"),
  variableSchema: z
    .array(
      z.object({
        key: z.string(),
        required: z.boolean().default(false),
        isSecret: z.boolean().default(false),
        defaultValue: z.string().optional(),
      }),
    )
    .default([]),
  secretRefs: z.array(z.string()).default([]),
});

export const createPipelineTemplateSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  scope: templateScopeSchema.default("project"),
  spec: pipelineTemplateSpecSchema,
});

export const upsertPipelineSecretSchema = z.object({
  key: z.string().min(2),
  value: z.string().min(1),
  scope: templateScopeSchema.default("project"),
  projectId: z.string().optional(),
  organization: z.string().optional(),
  environment: z.string().optional(),
});

export const orchestratePipelineSchema = z.object({
  mode: pipelineCreationModeSchema,
  templateId: z.string().optional(),
  templateVersion: z.number().optional(),
  pipelineName: z.string().optional(),
  organization: z.string().optional(),
  projectName: z.string().optional(),
  repoId: z.string().optional(),
  repoName: z.string().optional(),
  branchName: z.string().optional(),
  yamlPath: z.string().optional(),
  sourcePipelineId: z.number().optional(),
  existingPipelineId: z.number().optional(),
  generatedYaml: z.string().optional(),
  runAfterCreate: z.boolean().default(false),
  variableInputs: z.record(z.string(), z.string()).default({}),
  secretKeys: z.array(z.string()).default([]),
  infraBootstrapOption: infraBootstrapOptionSchema.default("none"),
  infraConfig: z
    .object({
      subscriptionId: z.string().optional(),
      resourceGroupName: z.string().optional(),
      location: z.string().optional(),
      appServiceName: z.string().optional(),
      staticWebAppName: z.string().optional(),
      databaseName: z.string().optional(),
      databaseServerName: z.string().optional(),
      useExistingServices: z.boolean().default(false),
      dbMigrationEnabled: z.boolean().default(false),
    })
    .optional(),
  saveAsTemplate: z.boolean().default(false),
  saveTemplatePayload: createPipelineTemplateSchema.optional(),
});

export type PipelineCreationMode = z.infer<typeof pipelineCreationModeSchema>;
export type InfraBootstrapOption = z.infer<typeof infraBootstrapOptionSchema>;
export type TemplateScope = z.infer<typeof templateScopeSchema>;
export type PipelineTemplateSpec = z.infer<typeof pipelineTemplateSpecSchema>;
export type CreatePipelineTemplateInput = z.infer<typeof createPipelineTemplateSchema>;
export type UpsertPipelineSecretInput = z.infer<typeof upsertPipelineSecretSchema>;
export type OrchestratePipelineInput = z.infer<typeof orchestratePipelineSchema>;

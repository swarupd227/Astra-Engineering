# SDLC Project Configuration - Usage Guide

## Overview

This guide explains how to access and use the Azure DevOps configuration and repository information stored when creating an SDLC project from the Golden Repositories page.

## What Gets Stored?

When you click "Create SDLC Project" after selecting a repository, the following configuration is automatically stored:

```typescript
interface SDLCProjectConfig {
  // Repository Information
  repositoryId: string;          // ID of the selected golden repository
  repositoryName: string;        // Name of the repository (e.g., "Insurance_standard")
  
  // Azure DevOps Configuration
  azureOrganizationUrl: string;  // e.g., "https://dev.azure.com/DevXPlatform/"
  azureProjectName: string;      // e.g., "MyProject"
  azureApiVersion: string;       // e.g., "7.0"
  isPatConfigured: boolean;      // Whether PAT token is configured on server (never exposes actual token)
  
  // SDLC Project Information
  sdlcProjectId?: number;        // ID of the created SDLC project
  sdlcProjectName?: string;      // Name of the SDLC project
  
  // Metadata
  createdAt?: string;            // Timestamp when config was created
}
```

**Important Security Notes:**
- The PAT (Personal Access Token) is stored securely on the server side as an environment variable (`ADO_PAT`) and is **never exposed** to the frontend
- The `isPatConfigured` boolean flag indicates whether a PAT is configured on the server, allowing you to show appropriate UI without exposing the actual token
- This approach ensures sensitive credentials never reach the client-side code or browser

## How to Use the Configuration

### 1. Import the Hook

```typescript
import { useSDLCProject } from "@/context/sdlc-project-context";
```

### 2. Access the Configuration in Any Component

```typescript
export default function MyComponent() {
  const { projectConfig, isConfigured } = useSDLCProject();

  // Check if configuration exists
  if (!isConfigured || !projectConfig) {
    return <div>No SDLC project configuration found</div>;
  }

  // Access specific values
  const {
    repositoryId,
    repositoryName,
    azureOrganizationUrl,
    azureProjectName,
    azureApiVersion,
    isPatConfigured,
    sdlcProjectId,
    sdlcProjectName,
  } = projectConfig;

  return (
    <div>
      <h2>SDLC Project: {sdlcProjectName}</h2>
      <p>Repository: {repositoryName}</p>
      <p>Azure Organization: {azureOrganizationUrl}</p>
      <p>Azure Project: {azureProjectName}</p>
      {!isPatConfigured && (
        <div className="text-destructive">
          Warning: Azure DevOps PAT not configured. Please configure in Settings.
        </div>
      )}
    </div>
  );
}
```

### 3. Checking PAT Configuration Status

Before making API calls to Azure DevOps, check if a PAT is configured:

```typescript
import { useSDLCProject } from "@/context/sdlc-project-context";

export default function AdoIntegration() {
  const { projectConfig, isConfigured } = useSDLCProject();

  if (!isConfigured || !projectConfig) {
    return (
      <div className="p-6">
        <p>Please create an SDLC project first.</p>
      </div>
    );
  }

  if (!projectConfig.isPatConfigured) {
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <h3 className="font-semibold text-destructive">Azure DevOps PAT Not Configured</h3>
          <p className="text-sm text-muted-foreground mt-2">
            To use Azure DevOps integration features, please configure your Personal Access Token in Settings.
          </p>
        </div>
        <Button onClick={() => navigate("/settings")}>
          Go to Settings
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Your Azure DevOps integration UI */}
    </div>
  );
}
```

### 4. Making Azure DevOps API Calls

When making API calls to Azure DevOps, use the stored configuration:

```typescript
import { useSDLCProject } from "@/context/sdlc-project-context";
import { useMutation } from "@tanstack/react-query";

export default function CreateWorkItem() {
  const { projectConfig } = useSDLCProject();

  const createWorkItemMutation = useMutation({
    mutationFn: async (workItemData: any) => {
      // Use the stored Azure DevOps configuration
      const response = await fetch("/api/ado/work-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationUrl: projectConfig?.azureOrganizationUrl,
          projectName: projectConfig?.azureProjectName,
          repositoryId: projectConfig?.repositoryId,
          ...workItemData,
        }),
        credentials: "include",
      });
      return response.json();
    },
  });

  const handleCreate = () => {
    createWorkItemMutation.mutate({
      title: "New Epic",
      description: "Epic description",
      type: "Epic",
    });
  };

  return <button onClick={handleCreate}>Create Work Item</button>;
}
```

### 5. Example: Fetching Work Items for Current Project

```typescript
import { useSDLCProject } from "@/context/sdlc-project-context";
import { useQuery } from "@tanstack/react-query";

export default function WorkItemsList() {
  const { projectConfig, isConfigured } = useSDLCProject();

  const { data: workItems, isLoading } = useQuery({
    queryKey: [
      "/api/ado/work-items",
      projectConfig?.azureProjectName,
      projectConfig?.repositoryId,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        organizationUrl: projectConfig?.azureOrganizationUrl || "",
        projectName: projectConfig?.azureProjectName || "",
        repositoryId: projectConfig?.repositoryId || "",
      });
      
      const response = await fetch(`/api/ado/work-items?${params}`, {
        credentials: "include",
      });
      return response.json();
    },
    enabled: isConfigured && !!projectConfig,
  });

  if (!isConfigured) {
    return <div>Please create an SDLC project first</div>;
  }

  if (isLoading) return <div>Loading work items...</div>;

  return (
    <div>
      <h2>Work Items for {projectConfig?.sdlcProjectName}</h2>
      <ul>
        {workItems?.map((item: any) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

### 6. Updating the Configuration

```typescript
import { useSDLCProject } from "@/context/sdlc-project-context";

export default function UpdateConfig() {
  const { projectConfig, setProjectConfig } = useSDLCProject();

  const handleUpdate = () => {
    if (!projectConfig) return;
    
    // Update the configuration
    setProjectConfig({
      ...projectConfig,
      azureProjectName: "NewProjectName",
    });
  };

  return <button onClick={handleUpdate}>Update Project Name</button>;
}
```

### 7. Clearing the Configuration

```typescript
import { useSDLCProject } from "@/context/sdlc-project-context";

export default function ClearConfig() {
  const { clearProjectConfig } = useSDLCProject();

  const handleClear = () => {
    // This will clear the configuration from both state and localStorage
    clearProjectConfig();
  };

  return <button onClick={handleClear}>Clear SDLC Configuration</button>;
}
```

## Backend API Implementation Example

When creating a backend API that uses the Azure DevOps configuration:

```typescript
// server/routes.ts

app.post("/api/ado/work-items", async (req, res) => {
  try {
    const { organizationUrl, projectName, repositoryId, title, description, type } = req.body;
    
    // The PAT token is accessed from environment variables (server-side only)
    const pat = process.env.ADO_PAT;
    
    if (!pat) {
      return res.status(500).json({ error: "Azure DevOps PAT not configured" });
    }

    // Create authorization header
    const authToken = Buffer.from(`:${pat}`).toString('base64');
    const headers = {
      'Content-Type': 'application/json-patch+json',
      'Authorization': `Basic ${authToken}`,
    };

    // Make request to Azure DevOps API
    const adoUrl = `${organizationUrl}${projectName}/_apis/wit/workitems/$${type}?api-version=7.0`;
    
    const response = await fetch(adoUrl, {
      method: "POST",
      headers,
      body: JSON.stringify([
        {
          op: "add",
          path: "/fields/System.Title",
          value: title,
        },
        {
          op: "add",
          path: "/fields/System.Description",
          value: description,
        },
      ]),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error creating work item:", error);
    res.status(500).json({ error: "Failed to create work item" });
  }
});
```

## Complete Example: SDLC Phase Component

Here's a complete example showing how to use the configuration in a real SDLC phase component:

```typescript
import { useSDLCProject } from "@/context/sdlc-project-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function RequirementsPhase() {
  const { projectConfig, isConfigured } = useSDLCProject();
  const { toast } = useToast();

  // Fetch requirements for this SDLC project
  const { data: requirements, isLoading } = useQuery({
    queryKey: ["/api/requirements", projectConfig?.sdlcProjectId],
    enabled: isConfigured && !!projectConfig?.sdlcProjectId,
  });

  // Push requirements to Azure DevOps
  const pushToAdoMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ado/push-requirements", {
        organizationUrl: projectConfig?.azureOrganizationUrl,
        projectName: projectConfig?.azureProjectName,
        repositoryId: projectConfig?.repositoryId,
        requirements: requirements,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Requirements pushed to Azure DevOps successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to push requirements to Azure DevOps",
        variant: "destructive",
      });
    },
  });

  if (!isConfigured) {
    return (
      <div className="p-6">
        <p>Please create an SDLC project from a Golden Repository first.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{projectConfig?.sdlcProjectName}</h2>
          <p className="text-muted-foreground">
            Repository: {projectConfig?.repositoryName}
          </p>
          <p className="text-sm text-muted-foreground">
            Azure DevOps: {projectConfig?.azureOrganizationUrl} / {projectConfig?.azureProjectName}
          </p>
        </div>
        <Button
          onClick={() => pushToAdoMutation.mutate()}
          disabled={pushToAdoMutation.isPending}
        >
          {pushToAdoMutation.isPending ? "Pushing..." : "Push to Azure DevOps"}
        </Button>
      </div>

      {isLoading ? (
        <div>Loading requirements...</div>
      ) : (
        <div>
          <h3 className="text-lg font-semibold">Requirements</h3>
          {/* Render requirements list */}
        </div>
      )}
    </div>
  );
}
```

## Storage Details

- **Frontend Storage:** The configuration is stored in `localStorage` with the key `sdlc_project_config`
- **Persistence:** The configuration persists across browser sessions and page refreshes
- **Security:** The PAT token is **never** stored in the frontend for security reasons
- **Clearing:** The configuration is automatically cleared when `clearProjectConfig()` is called or when creating a new SDLC project

## Common Use Cases

### 1. Display Current Project Info
Show the current SDLC project and repository information in headers or dashboards.

### 2. API Integration
Use the stored Azure DevOps configuration to make API calls without asking the user repeatedly.

### 3. Work Item Management
Create, update, or fetch work items from Azure DevOps using the stored project and organization details.

### 4. Repository Operations
Perform git operations or fetch repository information using the stored repository ID.

### 5. Audit Trail
Use the `createdAt` timestamp to track when the SDLC project was initiated.

## Best Practices

1. **Always Check `isConfigured`**: Before using `projectConfig`, check if it exists
2. **Handle Missing Config**: Provide fallback UI when configuration is not available
3. **Never Store PAT in Frontend**: Always use server-side environment variables for sensitive data
4. **Validate on Server**: Always validate organization URL and project name on the backend
5. **Clear When Appropriate**: Clear the configuration when switching between SDLC projects

## Troubleshooting

### Configuration Not Loading
- Check if you've created an SDLC project from the Golden Repositories page
- Verify that `SDLCProjectProvider` is wrapping your component tree in `App.tsx`
- Check browser localStorage for the `sdlc_project_config` key

### API Calls Failing
- Verify that Azure DevOps settings are configured in Settings page
- Ensure PAT token is set in server environment variables (`ADO_PAT`)
- Check that organization URL and project name are correct
- Verify API version compatibility (currently using 7.0)

### Configuration Persisting Unexpectedly
- Call `clearProjectConfig()` to manually clear the configuration
- Check localStorage in browser DevTools and manually delete the key if needed

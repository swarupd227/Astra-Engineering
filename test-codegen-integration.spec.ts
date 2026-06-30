import { test, expect } from '@playwright/test';

test.describe('CodeGen Page SDLC Integration', () => {
  test('should populate organization and project from URL params', async ({ page }) => {
    // Navigate to CodeGen page with SDLC parameters
    await page.goto('/sdlc/DevX-Platform/code-gen?organization=DevX-Platform&projectName=DevX-Platform&projectId=DevX-Platform&organizationUrl=https://dev.azure.com/DevX-Platform');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    // Check that organization field is populated and disabled
    const orgField = page.locator('[data-testid="organization-field"]');
    await expect(orgField).toContainText('DevX-Platform');
    await expect(orgField).toContainText('From SDLC');
    
    // Check that project field is populated and disabled  
    const projectField = page.locator('[data-testid="project-field"]');
    await expect(projectField).toContainText('DevX-Platform');
    await expect(projectField).toContainText('From SDLC');
    
    // Check success message
    const successMessage = page.locator('text=Organization and project selected successfully');
    await expect(successMessage).toBeVisible();
    await expect(page.locator('text=Pre-populated from SDLC workflow')).toBeVisible();
    
    // Verify fields are not editable
    const orgSelect = page.locator('#organization-select');
    await expect(orgSelect).not.toBeVisible(); // Should be hidden when disabled
    
    const projectSelect = page.locator('#project-select');
    await expect(projectSelect).not.toBeVisible(); // Should be hidden when disabled
  });
  
  test('should handle missing URL parameters gracefully', async ({ page }) => {
    // Navigate to CodeGen page without SDLC parameters
    await page.goto('/code-gen');
    
    // Check that fields are editable and not pre-populated
    const orgSelect = page.locator('#organization-select');
    await expect(orgSelect).toBeVisible();
    await expect(orgSelect).toBeEnabled();
    
    const projectSelect = page.locator('#project-select');  
    await expect(projectSelect).toBeVisible();
    // Project select should be disabled until org is selected
  });
  
  test('should handle both organization and organizationName parameters', async ({ page }) => {
    // Test with organizationName param (for compatibility)
    await page.goto('/sdlc/TestOrg/code-gen?organizationName=TestOrg&projectName=TestProject&projectId=test-123');
    
    await page.waitForLoadState('networkidle');
    
    // Should still work with organizationName
    const orgField = page.locator('[data-testid="organization-field"]');
    await expect(orgField).toContainText('TestOrg');
  });
});
import type { DiscoveredWorkflow } from './crawl-orchestrator';
import type { WorkflowStep, TestStep } from '@shared/qe-schema';

export interface GeneratedTestCase {
  testId: string;
  workflowId: string;
  name: string;
  objective: string;
  given: string;
  when: string;
  then: string;
  selector?: string;
  preconditions: string[];
  test_steps: TestStep[];
  postconditions: string[];
  test_data?: Record<string, any>;
  test_type: 'Functional' | 'Negative' | 'Boundary';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  type: string;
  tags: string[];
  workflow: {
    id: string;
    name: string;
    type: string;
  };
}

export class TestCaseGenerator {
  private testCaseCounter = 0;

  generateTestCases(workflows: DiscoveredWorkflow[]): GeneratedTestCase[] {
    console.log(`[TestCaseGenerator] Generating test cases for ${workflows.length} workflows`);
    this.testCaseCounter = 0;
    const testCases: GeneratedTestCase[] = [];

    for (const workflow of workflows) {
      console.log(`[TestCaseGenerator] Processing workflow: ${workflow.id} (${workflow.type})`);
      const workflowTestCases = this.generateTestCasesForWorkflow(workflow);
      console.log(`[TestCaseGenerator] Generated ${workflowTestCases.length} test cases for workflow ${workflow.id}`);
      testCases.push(...workflowTestCases);
    }

    console.log(`[TestCaseGenerator] Total test cases generated: ${testCases.length}`);
    return testCases;
  }

  private generateTestCasesForWorkflow(workflow: DiscoveredWorkflow): GeneratedTestCase[] {
    const testCases: GeneratedTestCase[] = [];

    switch (workflow.type) {
      case 'form_submission':
        testCases.push(...this.generateFormTestCases(workflow));
        break;
      case 'navigation_path':
        testCases.push(...this.generateNavigationTestCases(workflow));
        break;
      case 'cta_flow':
        testCases.push(...this.generateCTATestCases(workflow));
        break;
    }

    return testCases;
  }

  private generateFormTestCases(workflow: DiscoveredWorkflow): GeneratedTestCase[] {
    const testCases: GeneratedTestCase[] = [];
    const priority = this.determinePriority(workflow);

    const happyPathSteps: TestStep[] = workflow.steps
      .filter((step) => step.action === 'fill' || step.action === 'click')
      .map((step, index) => ({
        step_number: index + 1,
        action: step.description,
        expected_behavior: step.expectedOutcome || `${step.description} should complete successfully`,
      }));

    testCases.push({
      testId: this.generateTestId(),
      workflowId: workflow.id,
      name: `${workflow.name} - Happy Path`,
      objective: `Verify that users can successfully submit the form at ${workflow.entryPoint} with valid data`,
      given: `User is on the ${workflow.entryPoint} page`,
      when: this.buildWhenClause(workflow.steps),
      then: 'Form should submit successfully and show confirmation',
      selector: this.extractPrimarySelector(workflow.steps),
      preconditions: [
        'User has a valid browser session',
        `User can access ${workflow.entryPoint}`,
        'Form is loaded and all fields are visible',
      ],
      test_steps: happyPathSteps.length > 0 ? happyPathSteps : [{
        step_number: 1,
        action: 'Submit form with valid data',
        expected_behavior: 'Form submits successfully',
      }],
      postconditions: [
        'Form data is submitted to the server',
        'User receives confirmation message',
        'Form is cleared or user is redirected',
      ],
      test_data: this.generateFormTestData(workflow.steps),
      test_type: 'Functional',
      priority,
      type: 'form_submission',
      tags: this.generateTags(workflow, 'happy-path', 'form'),
      workflow: {
        id: workflow.id,
        name: workflow.name,
        type: workflow.type,
      },
    });

    testCases.push({
      testId: this.generateTestId(),
      workflowId: workflow.id,
      name: `${workflow.name} - Empty Fields Validation`,
      objective: `Verify that the form at ${workflow.entryPoint} properly validates required fields and prevents submission with empty data`,
      given: `User is on the ${workflow.entryPoint} page`,
      when: 'User clicks submit without filling any fields',
      then: 'Form should display validation errors for required fields',
      selector: this.extractSubmitButtonSelector(workflow.steps),
      preconditions: [
        'User has a valid browser session',
        `User can access ${workflow.entryPoint}`,
        'Form is loaded and all fields are visible',
      ],
      test_steps: [
        {
          step_number: 1,
          action: 'Navigate to the form page',
          expected_behavior: 'Form loads with all fields empty',
        },
        {
          step_number: 2,
          action: 'Click the submit button without entering data',
          expected_behavior: 'Validation errors appear for required fields',
        },
        {
          step_number: 3,
          action: 'Verify error messages are displayed',
          expected_behavior: 'Clear, user-friendly error messages are shown',
        },
      ],
      postconditions: [
        'Form data is NOT submitted to the server',
        'User remains on the form page',
        'Error messages are clearly visible',
      ],
      test_type: 'Negative',
      priority: priority === 'P0' ? 'P1' : 'P2',
      type: 'form_validation',
      tags: this.generateTags(workflow, 'validation', 'negative-test', 'form'),
      workflow: {
        id: workflow.id,
        name: workflow.name,
        type: workflow.type,
      },
    });

    const inputSteps = workflow.steps.filter((step) => step.action === 'fill');
    if (inputSteps.length > 0) {
      testCases.push({
        testId: this.generateTestId(),
        workflowId: workflow.id,
        name: `${workflow.name} - Input Field Accessibility`,
        objective: `Verify that all form input fields at ${workflow.entryPoint} are accessible and functional`,
        given: `User is on the ${workflow.entryPoint} page`,
        when: 'User focuses on each input field',
        then: 'Each field should be focusable and accept input',
        selector: inputSteps[0].selector,
        preconditions: [
          'User has a valid browser session',
          `User can access ${workflow.entryPoint}`,
          'Form is loaded and all fields are visible',
        ],
        test_steps: inputSteps.map((step, index) => ({
          step_number: index + 1,
          action: `Focus on ${step.description.toLowerCase()} field`,
          expected_behavior: 'Field receives focus and cursor appears',
        })),
        postconditions: [
          'All fields are verified to be accessible',
          'No accessibility issues detected',
        ],
        test_type: 'Functional',
        priority: 'P3',
        type: 'form_interaction',
        tags: this.generateTags(workflow, 'interaction', 'accessibility', 'form'),
        workflow: {
          id: workflow.id,
          name: workflow.name,
          type: workflow.type,
        },
      });
    }

    return testCases;
  }

  private generateNavigationTestCases(workflow: DiscoveredWorkflow): GeneratedTestCase[] {
    const testCases: GeneratedTestCase[] = [];
    const priority = 'P2';

    const navigationSteps: TestStep[] = workflow.steps
      .filter((step) => step.action === 'click' || step.action === 'navigate')
      .map((step, index) => ({
        step_number: index + 1,
        action: step.description,
        expected_behavior: step.expectedOutcome || `Page should navigate successfully`,
      }));

    testCases.push({
      testId: this.generateTestId(),
      workflowId: workflow.id,
      name: `${workflow.name} - Navigation Flow`,
      objective: `Verify that users can successfully navigate from ${workflow.entryPoint} following the discovered navigation path`,
      given: `User is on the ${workflow.entryPoint} page`,
      when: this.buildWhenClause(workflow.steps),
      then: 'User should successfully navigate through all pages',
      selector: this.extractPrimarySelector(workflow.steps),
      preconditions: [
        'User has a valid browser session',
        `User can access ${workflow.entryPoint}`,
        'All navigation links are functional',
      ],
      test_steps: navigationSteps.length > 0 ? navigationSteps : [{
        step_number: 1,
        action: 'Navigate through the page flow',
        expected_behavior: 'Navigation completes successfully',
      }],
      postconditions: [
        'User reaches the expected destination page',
        'No navigation errors occur',
        'Page loads completely',
      ],
      test_type: 'Functional',
      priority,
      type: 'navigation',
      tags: this.generateTags(workflow, 'happy-path', 'navigation'),
      workflow: {
        id: workflow.id,
        name: workflow.name,
        type: workflow.type,
      },
    });

    const clickSteps = workflow.steps.filter((step) => step.action === 'click');
    if (clickSteps.length > 0) {
      testCases.push({
        testId: this.generateTestId(),
        workflowId: workflow.id,
        name: `${workflow.name} - Link Accessibility`,
        objective: `Verify that all navigation links at ${workflow.entryPoint} are visible, accessible, and meet WCAG guidelines`,
        given: `User is on the ${workflow.entryPoint} page`,
        when: 'User checks all navigation links',
        then: 'All links should be visible and clickable',
        selector: clickSteps[0].selector,
        preconditions: [
          'User has a valid browser session',
          `User can access ${workflow.entryPoint}`,
          'Page is fully loaded',
        ],
        test_steps: clickSteps.slice(0, 3).map((step, index) => ({
          step_number: index + 1,
          action: `Verify ${step.description.toLowerCase()} link is accessible`,
          expected_behavior: 'Link is visible, has proper ARIA labels, and is keyboard accessible',
        })),
        postconditions: [
          'All links pass accessibility checks',
          'No accessibility violations detected',
        ],
        test_type: 'Functional',
        priority: 'P3',
        type: 'navigation_accessibility',
        tags: this.generateTags(workflow, 'accessibility', 'navigation'),
        workflow: {
          id: workflow.id,
          name: workflow.name,
          type: workflow.type,
        },
      });
    }

    return testCases;
  }

  private generateCTATestCases(workflow: DiscoveredWorkflow): GeneratedTestCase[] {
    const testCases: GeneratedTestCase[] = [];
    const priority = this.determinePriority(workflow);

    const ctaSteps: TestStep[] = workflow.steps
      .filter((step) => step.action === 'click')
      .map((step, index) => ({
        step_number: index + 1,
        action: step.description,
        expected_behavior: step.expectedOutcome || 'CTA action executes successfully',
      }));

    testCases.push({
      testId: this.generateTestId(),
      workflowId: workflow.id,
      name: `${workflow.name} - CTA Click`,
      objective: `Verify that the call-to-action at ${workflow.entryPoint} functions correctly and completes the intended user action`,
      given: `User is on the ${workflow.entryPoint} page`,
      when: this.buildWhenClause(workflow.steps),
      then: 'CTA action should complete successfully',
      selector: this.extractPrimarySelector(workflow.steps),
      preconditions: [
        'User has a valid browser session',
        `User can access ${workflow.entryPoint}`,
        'CTA button is visible and clickable',
      ],
      test_steps: ctaSteps.length > 0 ? ctaSteps : [{
        step_number: 1,
        action: 'Click the CTA button',
        expected_behavior: 'CTA action completes successfully',
      }],
      postconditions: [
        'CTA action is executed',
        'User receives appropriate feedback',
        'Expected behavior occurs (download, redirect, etc.)',
      ],
      test_type: 'Functional',
      priority,
      type: 'cta_interaction',
      tags: this.generateTags(workflow, 'happy-path', 'cta', 'conversion'),
      workflow: {
        id: workflow.id,
        name: workflow.name,
        type: workflow.type,
      },
    });

    testCases.push({
      testId: this.generateTestId(),
      workflowId: workflow.id,
      name: `${workflow.name} - CTA Visibility`,
      objective: `Verify that the call-to-action at ${workflow.entryPoint} is prominently displayed and meets visibility requirements`,
      given: `User is on the ${workflow.entryPoint} page`,
      when: 'User loads the page',
      then: 'CTA button should be visible and prominently displayed',
      selector: this.extractPrimarySelector(workflow.steps),
      preconditions: [
        'User has a valid browser session',
        `User can access ${workflow.entryPoint}`,
        'Page loads without errors',
      ],
      test_steps: [
        {
          step_number: 1,
          action: 'Load the page',
          expected_behavior: 'Page loads completely',
        },
        {
          step_number: 2,
          action: 'Verify CTA button is visible in viewport',
          expected_behavior: 'CTA is visible without scrolling',
        },
        {
          step_number: 3,
          action: 'Check CTA contrast and size',
          expected_behavior: 'CTA meets visibility and accessibility standards',
        },
      ],
      postconditions: [
        'CTA visibility verified',
        'No UI rendering issues detected',
      ],
      test_type: 'Functional',
      priority: 'P2',
      type: 'cta_visibility',
      tags: this.generateTags(workflow, 'visibility', 'cta', 'ux'),
      workflow: {
        id: workflow.id,
        name: workflow.name,
        type: workflow.type,
      },
    });

    return testCases;
  }

  private determinePriority(workflow: DiscoveredWorkflow): 'P0' | 'P1' | 'P2' | 'P3' {
    if (workflow.confidence >= 0.9) {
      if (workflow.name.toLowerCase().includes('login') || 
          workflow.name.toLowerCase().includes('checkout') ||
          workflow.name.toLowerCase().includes('payment')) {
        return 'P0';
      }
      return 'P1';
    }
    
    if (workflow.confidence >= 0.7) {
      return 'P2';
    }
    
    return 'P3';
  }

  private buildWhenClause(steps: WorkflowStep[]): string {
    const actionableSteps = steps.filter((step) => 
      step.action === 'click' || step.action === 'fill' || step.action === 'select'
    );

    if (actionableSteps.length === 0) {
      return 'User interacts with the page';
    }

    if (actionableSteps.length === 1) {
      return `User ${actionableSteps[0].description.toLowerCase()}`;
    }

    const descriptions = actionableSteps.map((step) => step.description.toLowerCase());
    const lastStep = descriptions.pop();
    return `User ${descriptions.join(', ')} and ${lastStep}`;
  }

  private extractPrimarySelector(steps: WorkflowStep[]): string | undefined {
    const actionableSteps = steps.filter((step) => 
      step.selector && (step.action === 'click' || step.action === 'fill')
    );
    
    return actionableSteps.length > 0 ? actionableSteps[0].selector : undefined;
  }

  private extractSubmitButtonSelector(steps: WorkflowStep[]): string | undefined {
    const submitStep = steps.find((step) => 
      step.action === 'click' && 
      (step.description.toLowerCase().includes('submit') || 
       step.description.toLowerCase().includes('send'))
    );
    
    return submitStep?.selector;
  }

  private generateTags(workflow: DiscoveredWorkflow, ...additionalTags: string[]): string[] {
    const tags: string[] = [];
    
    tags.push(workflow.type.replace('_', '-'));
    
    const workflowNameLower = workflow.name.toLowerCase();
    if (workflowNameLower.includes('login') || workflowNameLower.includes('sign in')) {
      tags.push('authentication');
    }
    if (workflowNameLower.includes('register') || workflowNameLower.includes('sign up')) {
      tags.push('registration');
    }
    if (workflowNameLower.includes('checkout') || workflowNameLower.includes('payment')) {
      tags.push('payment', 'critical-path');
    }
    if (workflowNameLower.includes('contact')) {
      tags.push('contact', 'support');
    }
    if (workflowNameLower.includes('search')) {
      tags.push('search');
    }
    
    if (workflow.confidence >= 0.9) {
      tags.push('high-confidence');
    } else if (workflow.confidence <= 0.6) {
      tags.push('low-confidence');
    }
    
    tags.push(...additionalTags);
    
    return Array.from(new Set(tags));
  }

  private generateFormTestData(steps: WorkflowStep[]): Record<string, any> | undefined {
    const formData: Record<string, any> = {};
    
    for (const step of steps) {
      if (step.action === 'fill' && step.description) {
        const fieldName = step.description.toLowerCase();
        
        if (fieldName.includes('email')) {
          formData.email = 'test.user@example.com';
        } else if (fieldName.includes('name') || fieldName.includes('first')) {
          formData.firstName = 'John';
        } else if (fieldName.includes('last')) {
          formData.lastName = 'Doe';
        } else if (fieldName.includes('phone')) {
          formData.phone = '+1 (555) 123-4567';
        } else if (fieldName.includes('address')) {
          formData.address = '123 Main Street';
        } else if (fieldName.includes('city')) {
          formData.city = 'San Francisco';
        } else if (fieldName.includes('zip') || fieldName.includes('postal')) {
          formData.zipCode = '94105';
        } else if (fieldName.includes('password')) {
          formData.password = 'SecurePass123!';
        } else if (fieldName.includes('message') || fieldName.includes('comment')) {
          formData.message = 'This is a test message';
        } else {
          formData[step.description.replace(/\s+/g, '_').toLowerCase()] = 'test_value';
        }
      }
    }
    
    return Object.keys(formData).length > 0 ? formData : undefined;
  }

  private generateTestId(): string {
    this.testCaseCounter++;
    return `TC-${String(this.testCaseCounter).padStart(4, '0')}`;
  }

  reset(): void {
    this.testCaseCounter = 0;
  }
}

export const testCaseGenerator = new TestCaseGenerator();

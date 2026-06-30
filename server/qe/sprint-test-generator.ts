import type { TestStep } from '@shared/qe-schema';

interface UserStoryInput {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
}

export interface GeneratedTestCase {
  testCaseId: string;
  title: string;
  objective: string;
  preconditions: string[];
  testSteps: TestStep[];
  expectedResult: string;
  testData: Record<string, any>;
  testType: 'Functional' | 'Negative' | 'Edge' | 'Accessibility';
  priority: string;
}

export class SprintTestGenerator {
  public generateTestCases(userStory: UserStoryInput, userStoryId: string): GeneratedTestCase[] {
    const testCases: GeneratedTestCase[] = [];
    const baseId = userStoryId.substring(0, 8);
    
    const acceptanceCriteriaList = this.parseAcceptanceCriteria(userStory.acceptanceCriteria);
    const descriptionFeatures = this.extractFeatures(userStory.description);
    
    let testCaseCounter = 1;

    testCases.push(...this.generateFunctionalTests(baseId, testCaseCounter, userStory, acceptanceCriteriaList, descriptionFeatures));
    testCaseCounter += 8;

    testCases.push(...this.generateNegativeTests(baseId, testCaseCounter, userStory, acceptanceCriteriaList));
    testCaseCounter += 3;

    testCases.push(...this.generateEdgeTests(baseId, testCaseCounter, userStory, acceptanceCriteriaList));
    testCaseCounter += 2;

    testCases.push(...this.generateAccessibilityTests(baseId, testCaseCounter, userStory));

    return testCases;
  }

  private parseAcceptanceCriteria(criteria?: string): string[] {
    if (!criteria) return [];
    
    const lines = criteria.split('\n').filter(line => line.trim());
    return lines.map(line => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  }

  private extractFeatures(description?: string): string[] {
    if (!description) return [];
    
    const features: string[] = [];
    const sentences = description.split(/[.!?]/).filter(s => s.trim());
    
    sentences.forEach(sentence => {
      if (sentence.toLowerCase().includes('user') || 
          sentence.toLowerCase().includes('should') ||
          sentence.toLowerCase().includes('must') ||
          sentence.toLowerCase().includes('can')) {
        features.push(sentence.trim());
      }
    });
    
    return features;
  }

  private generateFunctionalTests(
    baseId: string,
    startCounter: number,
    userStory: UserStoryInput,
    acceptanceCriteria: string[],
    features: string[]
  ): GeneratedTestCase[] {
    const tests: GeneratedTestCase[] = [];
    
    tests.push({
      testCaseId: `TC-${baseId}-${String(startCounter).padStart(3, '0')}`,
      title: `${userStory.title} - Happy Path Flow`,
      objective: `Verify that ${userStory.title} works as expected under normal conditions`,
      preconditions: [
        'User is logged into the system',
        'User has necessary permissions',
        'System is in a stable state'
      ],
      testSteps: [
        { step_number: 1, action: 'Navigate to the feature', expected_behavior: 'Feature page loads successfully' },
        { step_number: 2, action: 'Enter valid input data', expected_behavior: 'Data is accepted without errors' },
        { step_number: 3, action: 'Submit the form/action', expected_behavior: 'Action completes successfully' },
        { step_number: 4, action: 'Verify the result', expected_behavior: 'Expected outcome is displayed' }
      ],
      expectedResult: 'User completes the workflow successfully with all acceptance criteria met',
      testData: { validInput: 'test@example.com', validValue: '12345' },
      testType: 'Functional',
      priority: 'P0'
    });

    if (acceptanceCriteria.length > 0) {
      acceptanceCriteria.slice(0, 3).forEach((criterion, index) => {
        tests.push({
          testCaseId: `TC-${baseId}-${String(startCounter + 1 + index).padStart(3, '0')}`,
          title: `Verify: ${criterion.substring(0, 50)}...`,
          objective: `Validate acceptance criterion: ${criterion}`,
          preconditions: ['User is logged into the system', 'Test data is prepared'],
          testSteps: [
            { step_number: 1, action: 'Set up test conditions', expected_behavior: 'Conditions are ready' },
            { step_number: 2, action: `Perform action related to: ${criterion.substring(0, 40)}`, expected_behavior: 'Action executes' },
            { step_number: 3, action: 'Verify acceptance criterion is met', expected_behavior: `${criterion}` }
          ],
          expectedResult: `Acceptance criterion validated: ${criterion}`,
          testData: { criterion: criterion },
          testType: 'Functional',
          priority: 'P1'
        });
      });
    }

    tests.push({
      testCaseId: `TC-${baseId}-${String(startCounter + 4).padStart(3, '0')}`,
      title: `${userStory.title} - Data Validation`,
      objective: 'Verify that all input fields validate data correctly',
      preconditions: ['User has access to the feature'],
      testSteps: [
        { step_number: 1, action: 'Open the input form', expected_behavior: 'Form displays correctly' },
        { step_number: 2, action: 'Enter data in each field', expected_behavior: 'Data is accepted' },
        { step_number: 3, action: 'Verify field validations', expected_behavior: 'Validations work correctly' }
      ],
      expectedResult: 'All fields validate input data as per requirements',
      testData: { validData: true },
      testType: 'Functional',
      priority: 'P1'
    });

    tests.push({
      testCaseId: `TC-${baseId}-${String(startCounter + 5).padStart(3, '0')}`,
      title: `${userStory.title} - Multiple Operations`,
      objective: 'Verify feature works correctly with multiple consecutive operations',
      preconditions: ['User is logged in', 'Feature is accessible'],
      testSteps: [
        { step_number: 1, action: 'Perform first operation', expected_behavior: 'Operation completes' },
        { step_number: 2, action: 'Perform second operation', expected_behavior: 'Operation completes' },
        { step_number: 3, action: 'Perform third operation', expected_behavior: 'Operation completes' },
        { step_number: 4, action: 'Verify all operations', expected_behavior: 'All operations successful' }
      ],
      expectedResult: 'Multiple operations complete successfully without conflicts',
      testData: { operations: ['op1', 'op2', 'op3'] },
      testType: 'Functional',
      priority: 'P2'
    });

    tests.push({
      testCaseId: `TC-${baseId}-${String(startCounter + 6).padStart(3, '0')}`,
      title: `${userStory.title} - Error Messages Display`,
      objective: 'Verify that appropriate error messages are shown when errors occur',
      preconditions: ['User has access to the feature'],
      testSteps: [
        { step_number: 1, action: 'Trigger an expected error condition', expected_behavior: 'Error is triggered' },
        { step_number: 2, action: 'Observe error message', expected_behavior: 'Clear error message is displayed' },
        { step_number: 3, action: 'Verify message content', expected_behavior: 'Message is helpful and accurate' }
      ],
      expectedResult: 'Error messages are displayed clearly and guide user to resolution',
      testData: { errorScenario: true },
      testType: 'Functional',
      priority: 'P2'
    });

    tests.push({
      testCaseId: `TC-${baseId}-${String(startCounter + 7).padStart(3, '0')}`,
      title: `${userStory.title} - Session Persistence`,
      objective: 'Verify data persists correctly across sessions',
      preconditions: ['User is logged in', 'Data has been entered'],
      testSteps: [
        { step_number: 1, action: 'Enter and save data', expected_behavior: 'Data is saved' },
        { step_number: 2, action: 'Log out from system', expected_behavior: 'User logged out' },
        { step_number: 3, action: 'Log back in', expected_behavior: 'User logged in' },
        { step_number: 4, action: 'Verify saved data', expected_behavior: 'Data is still present' }
      ],
      expectedResult: 'Data persists correctly across user sessions',
      testData: { sessionData: 'test-data-123' },
      testType: 'Functional',
      priority: 'P2'
    });

    return tests;
  }

  private generateNegativeTests(
    baseId: string,
    startCounter: number,
    userStory: UserStoryInput,
    acceptanceCriteria: string[]
  ): GeneratedTestCase[] {
    return [
      {
        testCaseId: `TC-${baseId}-${String(startCounter).padStart(3, '0')}`,
        title: `${userStory.title} - Invalid Input Handling`,
        objective: 'Verify system handles invalid input gracefully without crashing',
        preconditions: ['User is logged into the system'],
        testSteps: [
          { step_number: 1, action: 'Navigate to input form', expected_behavior: 'Form loads' },
          { step_number: 2, action: 'Enter invalid data (special characters, SQL injection attempts)', expected_behavior: 'System rejects invalid data' },
          { step_number: 3, action: 'Submit form', expected_behavior: 'Appropriate error message shown' },
          { step_number: 4, action: 'Verify system stability', expected_behavior: 'System remains stable' }
        ],
        expectedResult: 'System rejects invalid input and displays appropriate error without crashing',
        testData: { invalidInput: '<script>alert("XSS")</script>', sqlInjection: "'; DROP TABLE users--" },
        testType: 'Negative',
        priority: 'P0'
      },
      {
        testCaseId: `TC-${baseId}-${String(startCounter + 1).padStart(3, '0')}`,
        title: `${userStory.title} - Missing Required Fields`,
        objective: 'Verify system validates required fields appropriately',
        preconditions: ['User has access to feature'],
        testSteps: [
          { step_number: 1, action: 'Open form/feature', expected_behavior: 'Form displays' },
          { step_number: 2, action: 'Leave required fields empty', expected_behavior: 'Fields remain empty' },
          { step_number: 3, action: 'Attempt to submit', expected_behavior: 'Validation errors displayed' },
          { step_number: 4, action: 'Verify specific error messages', expected_behavior: 'Each required field shows error' }
        ],
        expectedResult: 'System prevents submission and clearly indicates all required fields',
        testData: { requiredFields: ['field1', 'field2', 'field3'] },
        testType: 'Negative',
        priority: 'P1'
      },
      {
        testCaseId: `TC-${baseId}-${String(startCounter + 2).padStart(3, '0')}`,
        title: `${userStory.title} - Unauthorized Access Attempt`,
        objective: 'Verify system prevents unauthorized access to feature',
        preconditions: ['User without proper permissions is logged in'],
        testSteps: [
          { step_number: 1, action: 'Attempt to access feature directly via URL', expected_behavior: 'Access denied' },
          { step_number: 2, action: 'Verify error message', expected_behavior: 'Unauthorized access message shown' },
          { step_number: 3, action: 'Attempt to manipulate permissions client-side', expected_behavior: 'Server validates and denies' }
        ],
        expectedResult: 'System prevents unauthorized access and displays appropriate message',
        testData: { unauthorizedUser: 'test-user-no-perms' },
        testType: 'Negative',
        priority: 'P0'
      }
    ];
  }

  private generateEdgeTests(
    baseId: string,
    startCounter: number,
    userStory: UserStoryInput,
    acceptanceCriteria: string[]
  ): GeneratedTestCase[] {
    return [
      {
        testCaseId: `TC-${baseId}-${String(startCounter).padStart(3, '0')}`,
        title: `${userStory.title} - Maximum Input Length`,
        objective: 'Verify system handles maximum allowed input lengths correctly',
        preconditions: ['User is logged into system'],
        testSteps: [
          { step_number: 1, action: 'Open input form', expected_behavior: 'Form loads' },
          { step_number: 2, action: 'Enter maximum length data in each field', expected_behavior: 'Data accepted up to limit' },
          { step_number: 3, action: 'Attempt to exceed maximum length', expected_behavior: 'System prevents or truncates' },
          { step_number: 4, action: 'Submit form with max length data', expected_behavior: 'Submission successful' }
        ],
        expectedResult: 'System handles maximum input lengths correctly without errors',
        testData: { maxLengthString: 'A'.repeat(255), maxNumber: 999999999 },
        testType: 'Edge',
        priority: 'P2'
      },
      {
        testCaseId: `TC-${baseId}-${String(startCounter + 1).padStart(3, '0')}`,
        title: `${userStory.title} - Concurrent User Actions`,
        objective: 'Verify system handles concurrent operations from same user',
        preconditions: ['User is logged in', 'Feature supports multiple operations'],
        testSteps: [
          { step_number: 1, action: 'Open feature in multiple browser tabs', expected_behavior: 'Feature loads in all tabs' },
          { step_number: 2, action: 'Perform same action simultaneously in all tabs', expected_behavior: 'System processes all requests' },
          { step_number: 3, action: 'Verify data consistency', expected_behavior: 'No data corruption or conflicts' }
        ],
        expectedResult: 'System handles concurrent operations without data corruption',
        testData: { concurrentTabs: 3 },
        testType: 'Edge',
        priority: 'P2'
      }
    ];
  }

  private generateAccessibilityTests(
    baseId: string,
    startCounter: number,
    userStory: UserStoryInput
  ): GeneratedTestCase[] {
    return [
      {
        testCaseId: `TC-${baseId}-${String(startCounter).padStart(3, '0')}`,
        title: `${userStory.title} - Keyboard Navigation`,
        objective: 'Verify all functionality is accessible via keyboard only',
        preconditions: ['User can access the feature'],
        testSteps: [
          { step_number: 1, action: 'Navigate to feature using Tab key only', expected_behavior: 'All interactive elements receive focus' },
          { step_number: 2, action: 'Activate controls using Enter/Space keys', expected_behavior: 'Controls respond correctly' },
          { step_number: 3, action: 'Complete entire workflow using keyboard', expected_behavior: 'Workflow completes successfully' }
        ],
        expectedResult: 'All functionality is fully accessible via keyboard without mouse',
        testData: { accessibilityMode: 'keyboard' },
        testType: 'Accessibility',
        priority: 'P1'
      },
      {
        testCaseId: `TC-${baseId}-${String(startCounter + 1).padStart(3, '0')}`,
        title: `${userStory.title} - Screen Reader Compatibility`,
        objective: 'Verify feature is compatible with screen readers',
        preconditions: ['Screen reader software is enabled'],
        testSteps: [
          { step_number: 1, action: 'Navigate feature with screen reader', expected_behavior: 'All elements have proper labels' },
          { step_number: 2, action: 'Verify form field labels are announced', expected_behavior: 'Labels are clear and descriptive' },
          { step_number: 3, action: 'Complete workflow using screen reader', expected_behavior: 'Workflow is fully accessible' }
        ],
        expectedResult: 'Screen reader users can fully interact with the feature',
        testData: { screenReader: 'NVDA/JAWS' },
        testType: 'Accessibility',
        priority: 'P1'
      }
    ];
  }
}

export const sprintTestGenerator = new SprintTestGenerator();

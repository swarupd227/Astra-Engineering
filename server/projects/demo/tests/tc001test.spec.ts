import { test, expect } from '@playwright/test';
import { TestData } from '../fixtures/test-data';
import { executetestWorkflow } from '../actions/test.actions';

test.describe('test', () => {
  test('Execute recorded workflow', async ({ page }) => {
    await executetestWorkflow(page, TestData);
  });
});

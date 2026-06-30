import * as fs from 'fs';
import * as path from 'path';

export interface TestEvidence {
  testName: string;
  scenarioId: string;
  domain: string;
  screenshots: ScreenshotEvidence[];
  video: VideoEvidence | null;
  executionLog: ExecutionLogEntry[];
  healingLog: HealingLogEntry[];
  startTime: Date;
  endTime: Date;
  durationMs: number;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED';
}

export interface ScreenshotEvidence {
  stepName: string;
  filePath: string;
  capturedAt: Date;
  isFailureShot: boolean;
  elementRef: string;
}

export interface VideoEvidence {
  filePath: string;
  durationSecs: number;
  recordedAt: Date;
}

export interface ExecutionLogEntry {
  timestamp: Date;
  stepName: string;
  cliCommand: string;
  elementRef: string;
  status: 'PASS' | 'FAIL' | 'RETRY';
  durationMs: number;
  errorMessage?: string;
}

export interface HealingLogEntry {
  timestamp: Date;
  originalRef: string;
  newRef: string;
  healingLevel: 1 | 2 | 3 | 4;
  confidenceScore: number;
  elementLabel: string;
  success: boolean;
}

export class EvidencePipeline {
  private baseDir: string;
  private currentEvidence: TestEvidence | null = null;

  constructor(baseDir: string = './evidence') {
    this.baseDir = baseDir;
  }

  startCollection(testName: string, scenarioId: string, domain: string): void {
    this.currentEvidence = {
      testName,
      scenarioId,
      domain,
      screenshots: [],
      video: null,
      executionLog: [],
      healingLog: [],
      startTime: new Date(),
      endTime: new Date(),
      durationMs: 0,
      status: 'PASS'
    };
  }

  addScreenshot(stepName: string, screenshotData: string | Buffer, isFailureShot: boolean = false, elementRef: string = ''): string {
    if (!this.currentEvidence) return '';

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = stepName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const dir = this.getEvidenceDir('screenshots');
    const filePath = path.join(dir, `${safeName}_${timestamp}.png`);

    try {
      this.ensureDir(dir);
      if (typeof screenshotData === 'string') {
        fs.writeFileSync(filePath, Buffer.from(screenshotData, 'base64'));
      } else {
        fs.writeFileSync(filePath, screenshotData);
      }
    } catch (e: any) {
      console.error(`[EvidencePipeline] Failed to save screenshot: ${e.message}`);
    }

    const evidence: ScreenshotEvidence = {
      stepName,
      filePath,
      capturedAt: new Date(),
      isFailureShot,
      elementRef
    };
    this.currentEvidence.screenshots.push(evidence);
    return filePath;
  }

  addExecutionLog(entry: ExecutionLogEntry): void {
    if (!this.currentEvidence) return;
    this.currentEvidence.executionLog.push(entry);
  }

  addHealingLog(entry: HealingLogEntry): void {
    if (!this.currentEvidence) return;
    this.currentEvidence.healingLog.push(entry);
  }

  setVideo(filePath: string, durationSecs: number): void {
    if (!this.currentEvidence) return;
    this.currentEvidence.video = {
      filePath,
      durationSecs,
      recordedAt: new Date()
    };
  }

  markStatus(status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED'): void {
    if (!this.currentEvidence) return;
    this.currentEvidence.status = status;
  }

  finalize(): TestEvidence | null {
    if (!this.currentEvidence) return null;

    this.currentEvidence.endTime = new Date();
    this.currentEvidence.durationMs =
      this.currentEvidence.endTime.getTime() - this.currentEvidence.startTime.getTime();

    const logDir = this.getEvidenceDir('');
    this.ensureDir(logDir);

    try {
      const executionLogPath = path.join(logDir, 'execution.log');
      const logLines = this.currentEvidence.executionLog.map(entry =>
        `[${entry.timestamp.toISOString()}] ${entry.status} | ${entry.stepName} | ${entry.cliCommand} | ref:${entry.elementRef} | ${entry.durationMs}ms${entry.errorMessage ? ' | ERROR: ' + entry.errorMessage : ''}`
      ).join('\n');
      fs.writeFileSync(executionLogPath, logLines);

      if (this.currentEvidence.healingLog.length > 0) {
        const healingLogPath = path.join(logDir, 'healing.log');
        const healingLines = this.currentEvidence.healingLog.map(entry =>
          `[${entry.timestamp.toISOString()}] Level ${entry.healingLevel} | ${entry.elementLabel} | ${entry.originalRef} → ${entry.newRef} | confidence:${entry.confidenceScore}% | ${entry.success ? 'SUCCESS' : 'FAILED'}`
        ).join('\n');
        fs.writeFileSync(healingLogPath, healingLines);
      }

      const summaryPath = path.join(logDir, 'summary.json');
      const summary = {
        testName: this.currentEvidence.testName,
        scenarioId: this.currentEvidence.scenarioId,
        domain: this.currentEvidence.domain,
        status: this.currentEvidence.status,
        durationMs: this.currentEvidence.durationMs,
        startTime: this.currentEvidence.startTime.toISOString(),
        endTime: this.currentEvidence.endTime.toISOString(),
        screenshotsCount: this.currentEvidence.screenshots.length,
        stepsExecuted: this.currentEvidence.executionLog.length,
        stepsPassed: this.currentEvidence.executionLog.filter(e => e.status === 'PASS').length,
        stepsFailed: this.currentEvidence.executionLog.filter(e => e.status === 'FAIL').length,
        healingAttempts: this.currentEvidence.healingLog.length,
        healingSuccesses: this.currentEvidence.healingLog.filter(e => e.success).length,
        hasVideo: !!this.currentEvidence.video,
        tokenUsage: {
          estimated: this.currentEvidence.executionLog.length * 2550,
          mcpEquivalent: this.currentEvidence.executionLog.length * 6500,
          savings: `${Math.round((1 - 2550 / 6500) * 100)}%`
        }
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    } catch (e: any) {
      console.error(`[EvidencePipeline] Error writing evidence files: ${e.message}`);
    }

    const result = { ...this.currentEvidence };
    this.currentEvidence = null;
    return result;
  }

  getEvidenceForTest(domain: string, testName: string): TestEvidence[] {
    const safeName = testName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const testDir = path.join(this.baseDir, domain, safeName);

    if (!fs.existsSync(testDir)) return [];

    const runs: TestEvidence[] = [];
    try {
      const timestamps = fs.readdirSync(testDir).filter(d => {
        const fullPath = path.join(testDir, d);
        return fs.statSync(fullPath).isDirectory();
      });

      for (const ts of timestamps) {
        const summaryPath = path.join(testDir, ts, 'summary.json');
        if (fs.existsSync(summaryPath)) {
          const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
          runs.push({
            testName: summary.testName,
            scenarioId: summary.scenarioId,
            domain: summary.domain,
            screenshots: [],
            video: null,
            executionLog: [],
            healingLog: [],
            startTime: new Date(summary.startTime),
            endTime: new Date(summary.endTime),
            durationMs: summary.durationMs,
            status: summary.status
          });
        }
      }
    } catch (e: any) {
      console.error(`[EvidencePipeline] Error reading evidence: ${e.message}`);
    }

    return runs;
  }

  private getEvidenceDir(subDir: string): string {
    if (!this.currentEvidence) return this.baseDir;
    const safeName = this.currentEvidence.testName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const timestamp = this.currentEvidence.startTime.toISOString().replace(/[:.]/g, '-');
    const parts = [this.baseDir, this.currentEvidence.domain, safeName, timestamp];
    if (subDir) parts.push(subDir);
    return path.join(...parts);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

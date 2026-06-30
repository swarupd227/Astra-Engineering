import { NAT20PlaywrightCLI, SessionOptions, SessionContaminationError } from './nat20-playwright-cli';

export const SESSION_NAMES = {
  HEALTHCARE:    'nat2-healthcare-session',
  INSURANCE:     'nat2-insurance-session',
  BANKING:       'nat2-banking-session',
  FINTECH:       'nat2-fintech-session',
  REGRESSION:    'nat2-regression-session',
  ACCESSIBILITY: 'nat2-accessibility-session',
  VISUAL:        'nat2-visual-session',
} as const;

export type DomainKey = keyof typeof SESSION_NAMES;

interface SessionEntry {
  cli: NAT20PlaywrightCLI;
  domain: DomainKey;
  createdAt: Date;
  lastAccessedAt: Date;
  url: string;
  isActive: boolean;
}

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_PARALLEL_SESSIONS = 6;

export class SessionRegistry {
  private static instance: SessionRegistry;
  private sessions: Map<string, SessionEntry> = new Map();
  private ttlMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 60000);
  }

  static getInstance(): SessionRegistry {
    if (!SessionRegistry.instance) {
      SessionRegistry.instance = new SessionRegistry();
    }
    return SessionRegistry.instance;
  }

  async getOrCreateSession(
    domain: DomainKey,
    url: string,
    options?: SessionOptions
  ): Promise<NAT20PlaywrightCLI> {
    const sessionName = SESSION_NAMES[domain];
    const existing = this.sessions.get(sessionName);

    if (existing && existing.isActive && existing.cli.isActive()) {
      existing.lastAccessedAt = new Date();
      console.log(`[SessionRegistry] Reusing existing session: ${sessionName}`);
      return existing.cli;
    }

    if (existing && !existing.cli.isActive()) {
      console.log(`[SessionRegistry] Session ${sessionName} was stale, recreating...`);
      await this.forceReset(domain);
    }

    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isActive);
    if (activeSessions.length >= MAX_PARALLEL_SESSIONS) {
      const oldest = activeSessions.sort((a, b) => a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime())[0];
      const oldDomain = oldest.domain;
      console.log(`[SessionRegistry] Max sessions reached, closing oldest: ${SESSION_NAMES[oldDomain]}`);
      await this.forceReset(oldDomain);
    }

    const cli = new NAT20PlaywrightCLI(domain, {
      sessionName,
      ...options
    });

    await cli.initialize(url, options);

    this.sessions.set(sessionName, {
      cli,
      domain,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      url,
      isActive: true
    });

    console.log(`[SessionRegistry] Created new session: ${sessionName} for ${url}`);
    return cli;
  }

  async forceReset(domain: DomainKey): Promise<void> {
    const sessionName = SESSION_NAMES[domain];
    const entry = this.sessions.get(sessionName);
    if (entry) {
      try {
        await entry.cli.deleteSession();
      } catch (e: any) {
        console.error(`[SessionRegistry] Error closing session ${sessionName}:`, e.message);
      }
      this.sessions.delete(sessionName);
      console.log(`[SessionRegistry] Reset session: ${sessionName}`);
    }
  }

  async resetAllSessions(): Promise<void> {
    const domains = Object.keys(SESSION_NAMES) as DomainKey[];
    for (const domain of domains) {
      await this.forceReset(domain);
    }
    console.log(`[SessionRegistry] All sessions reset`);
  }

  listActiveSessions(): { name: string; domain: DomainKey; createdAt: Date; lastAccessed: Date; url: string }[] {
    const result: { name: string; domain: DomainKey; createdAt: Date; lastAccessed: Date; url: string }[] = [];
    for (const [name, entry] of this.sessions) {
      if (entry.isActive) {
        result.push({
          name,
          domain: entry.domain,
          createdAt: entry.createdAt,
          lastAccessed: entry.lastAccessedAt,
          url: entry.url
        });
      }
    }
    return result;
  }

  getSession(domain: DomainKey): NAT20PlaywrightCLI | null {
    const sessionName = SESSION_NAMES[domain];
    const entry = this.sessions.get(sessionName);
    if (entry && entry.isActive && entry.cli.isActive()) {
      entry.lastAccessedAt = new Date();
      return entry.cli;
    }
    return null;
  }

  checkContamination(domain1: DomainKey, domain2: DomainKey): void {
    if (domain1 === domain2) return;
    const session1 = this.sessions.get(SESSION_NAMES[domain1]);
    const session2 = this.sessions.get(SESSION_NAMES[domain2]);
    if (session1 && session2 && session1.isActive && session2.isActive) {
      if (session1.url === session2.url) {
        throw new SessionContaminationError([SESSION_NAMES[domain1], SESSION_NAMES[domain2]]);
      }
    }
  }

  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    for (const [name, entry] of this.sessions) {
      if (entry.isActive && (now - entry.lastAccessedAt.getTime() > this.ttlMs)) {
        console.log(`[SessionRegistry] Cleaning up stale session: ${name} (idle for ${Math.round((now - entry.lastAccessedAt.getTime()) / 60000)}min)`);
        try {
          await entry.cli.deleteSession();
        } catch (e: any) {
          console.error(`[SessionRegistry] Error cleaning up ${name}:`, e.message);
        }
        entry.isActive = false;
      }
    }
  }

  getStats(): {
    totalSessions: number;
    activeSessions: number;
    domains: string[];
    oldestSession: Date | null;
  } {
    const active = Array.from(this.sessions.values()).filter(s => s.isActive);
    return {
      totalSessions: this.sessions.size,
      activeSessions: active.length,
      domains: active.map(s => s.domain),
      oldestSession: active.length > 0
        ? new Date(Math.min(...active.map(s => s.createdAt.getTime())))
        : null
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

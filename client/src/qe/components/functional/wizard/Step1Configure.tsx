import { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Shield, ChevronDown, ChevronRight, Zap, Bot, Code, TestTube, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ApiDiscoveryPanel } from '@/components/functional/ApiDiscoveryPanel';

export interface WizardConfig {
  websiteUrl: string;
  testingMode: 'ui' | 'api' | 'both';
  designPattern: 'POM' | 'BDD' | 'both';
  domain: string;
  requiresAuth: boolean;
  loginUrl: string;
  username: string;
  password: string;
  authType: 'form' | 'basic' | 'custom';
  usernameSelector: string;
  passwordSelector: string;
  loginButtonSelector: string;
  maxPages: number;
  quickSample: boolean;
}

interface Step1ConfigureProps {
  config: WizardConfig;
  onChange: (updates: Partial<WizardConfig>) => void;
  onStart: () => void;
  isStarting?: boolean;
}

const DOMAINS = ['General', 'Insurance', 'Healthcare', 'Finance', 'E-Commerce', 'Education', 'Government', 'Retail'];

const TESTING_MODES = [
  { id: 'ui', label: 'UI Testing', icon: Globe, desc: 'Navigate pages, test interactions' },
  { id: 'api', label: 'API Testing', icon: Code, desc: 'Capture & test API endpoints' },
  { id: 'both', label: 'Both', icon: TestTube, desc: 'Full-stack coverage' },
] as const;

const PATTERNS = [
  { id: 'POM', label: 'Page Object Model', desc: 'Classes per page with typed locators' },
  { id: 'BDD', label: 'BDD / Gherkin', desc: 'Feature files + step definitions' },
  { id: 'both', label: 'POM + BDD', desc: 'Complete test automation suite' },
] as const;

export function Step1Configure({ config, onChange, onStart, isStarting }: Step1ConfigureProps) {
  const [showAuth, setShowAuth] = useState(config.requiresAuth);
  const [showAdvancedAuth, setShowAdvancedAuth] = useState(false);
  const [testLoginStatus, setTestLoginStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testLoginMsg, setTestLoginMsg] = useState('');

  const handleTestLogin = async () => {
    setTestLoginStatus('testing');
    setTestLoginMsg('');
    try {
      const res = await fetch('/api/wizard/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginUrl: config.loginUrl || config.websiteUrl,
          username: config.username,
          password: config.password,
          authType: config.authType,
          usernameSelector: config.usernameSelector || undefined,
          passwordSelector: config.passwordSelector || undefined,
          loginButtonSelector: config.loginButtonSelector || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestLoginStatus('success');
        setTestLoginMsg('Login successful!');
        if (data.detectedSelectors) {
          onChange({
            usernameSelector: data.detectedSelectors.usernameSelector,
            passwordSelector: data.detectedSelectors.passwordSelector,
            loginButtonSelector: data.detectedSelectors.submitSelector,
          });
        }
      } else {
        setTestLoginStatus('error');
        setTestLoginMsg(data.error || 'Login failed');
      }
    } catch (err: any) {
      setTestLoginStatus('error');
      setTestLoginMsg(err.message);
    }
  };

  const isValid = config.websiteUrl.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto space-y-6"
    >
      {/* Target URL */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          Application URL
        </Label>
        <Input
          placeholder="https://yourapp.com"
          value={config.websiteUrl}
          onChange={e => onChange({ websiteUrl: e.target.value })}
          className="font-mono text-sm"
        />
      </div>

      {/* Testing Mode */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Testing Mode</Label>
        <div className="grid grid-cols-3 gap-2">
          {TESTING_MODES.map(mode => (
            <button
              key={mode.id}
              onClick={() => onChange({ testingMode: mode.id })}
              className={cn(
                'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-left transition-all',
                config.testingMode === mode.id
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
              )}
            >
              <mode.icon className={cn('w-5 h-5', config.testingMode === mode.id ? 'text-primary' : 'text-muted-foreground')} />
              <span className={cn('text-xs font-semibold', config.testingMode === mode.id ? 'text-primary' : 'text-foreground')}>{mode.label}</span>
              <span className="text-[10px] text-muted-foreground text-center leading-tight">{mode.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Design Pattern (UI mode only) */}
      {config.testingMode !== 'api' && (
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Automation Design Pattern</Label>
          <div className="grid grid-cols-3 gap-2">
            {PATTERNS.map(pat => (
              <button
                key={pat.id}
                onClick={() => onChange({ designPattern: pat.id as any })}
                className={cn(
                  'flex flex-col gap-1 p-3 rounded-xl border-2 text-left transition-all',
                  config.designPattern === pat.id
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 shadow-sm'
                    : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
                )}
              >
                <span className={cn('text-xs font-semibold', config.designPattern === pat.id ? 'text-violet-700 dark:text-violet-300' : 'text-foreground')}>{pat.label}</span>
                <span className="text-[10px] text-muted-foreground">{pat.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Domain */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Application Domain</Label>
        <div className="flex flex-wrap gap-1.5">
          {DOMAINS.map(d => (
            <button
              key={d}
              onClick={() => onChange({ domain: d.toLowerCase() })}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                config.domain === d.toLowerCase()
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50'
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Options row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Switch
            checked={config.quickSample}
            onCheckedChange={v => onChange({ quickSample: v })}
          />
          <Label className="text-sm cursor-pointer">Quick Sample Mode</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Max pages:</Label>
          <Input
            type="number"
            value={config.maxPages}
            onChange={e => onChange({ maxPages: parseInt(e.target.value) || 20 })}
            min={1} max={100}
            className="w-20 h-7 text-xs"
          />
        </div>
      </div>

      {/* Authentication */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => {
            const next = !showAuth;
            setShowAuth(next);
            onChange({ requiresAuth: next });
          }}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold">Authentication</span>
            {config.requiresAuth && config.username && (
              <Badge variant="secondary" className="text-[10px] h-4">Configured</Badge>
            )}
          </div>
          {showAuth ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>

        {showAuth && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            className="border-t border-border"
          >
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Login URL (optional)</Label>
                  <Input
                    placeholder={config.websiteUrl + '/login'}
                    value={config.loginUrl}
                    onChange={e => onChange({ loginUrl: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Auth Type</Label>
                  <select
                    value={config.authType}
                    onChange={e => onChange({ authType: e.target.value as any })}
                    className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background"
                  >
                    <option value="form">Form Login</option>
                    <option value="basic">HTTP Basic Auth</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Username / Email</Label>
                  <Input
                    value={config.username}
                    onChange={e => onChange({ username: e.target.value })}
                    placeholder="user@example.com"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Password</Label>
                  <Input
                    type="password"
                    value={config.password}
                    onChange={e => onChange({ password: e.target.value })}
                    placeholder="••••••••"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Advanced selectors */}
              <button
                onClick={() => setShowAdvancedAuth(s => !s)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                {showAdvancedAuth ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Advanced selectors (auto-detected if empty)
              </button>

              {showAdvancedAuth && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Username selector</Label>
                    <Input value={config.usernameSelector} onChange={e => onChange({ usernameSelector: e.target.value })} placeholder="#username" className="h-7 text-xs font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Password selector</Label>
                    <Input value={config.passwordSelector} onChange={e => onChange({ passwordSelector: e.target.value })} placeholder="#password" className="h-7 text-xs font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Submit selector</Label>
                    <Input value={config.loginButtonSelector} onChange={e => onChange({ loginButtonSelector: e.target.value })} placeholder="button[type=submit]" className="h-7 text-xs font-mono" />
                  </div>
                </div>
              )}

              {/* Test login button */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestLogin}
                  disabled={testLoginStatus === 'testing' || !config.username || !config.password}
                >
                  {testLoginStatus === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Shield className="w-3.5 h-3.5 mr-1.5" />}
                  Test Login
                </Button>
                {testLoginMsg && (
                  <span className={cn('text-xs font-medium', testLoginStatus === 'success' ? 'text-emerald-600' : 'text-red-500')}>
                    {testLoginStatus === 'success' ? '✓' : '✗'} {testLoginMsg}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* API Discovery (shown in API / Both mode) */}
      {config.testingMode !== 'ui' && (
        <ApiDiscoveryPanel baseUrl={config.websiteUrl} />
      )}

      {/* Start button */}
      <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
        <Button
          size="lg"
          onClick={onStart}
          disabled={!isValid || isStarting}
          className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-500 shadow-lg shadow-primary/20"
        >
          {isStarting ? (
            <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Initializing Agents...</>
          ) : (
            <><Bot className="w-5 h-5 mr-2" /> Start Autonomous Testing</>
          )}
        </Button>
      </motion.div>
    </motion.div>
  );
}

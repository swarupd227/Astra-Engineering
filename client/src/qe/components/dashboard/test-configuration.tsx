import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Sparkles } from "lucide-react";

interface TestConfigurationProps {
  onStartDemo: (config: { 
    figmaUrl: string; 
    websiteUrl: string; 
    testScope: string; 
    browserTarget: string 
  }) => void;
}

export function TestConfiguration({ onStartDemo }: TestConfigurationProps) {
  const [, setLocation] = useLocation();
  const [figmaUrl, setFigmaUrl] = useState("https://www.figma.com/file/abc123/InsurancePortal");
  const [websiteUrl, setWebsiteUrl] = useState("https://demo.insurity.com/policy-portal");
  const [testScope, setTestScope] = useState("full-page");
  const [browserTarget, setBrowserTarget] = useState("chrome");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStartDemo({ figmaUrl, websiteUrl, testScope, browserTarget });
  };

  return (
    <div className="container mx-auto px-8 py-8">
      <Card className="w-full max-w-2xl p-8 mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <button
              type="button"
              onClick={() => setLocation('/dashboard')}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
              data-testid="button-back-dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
            <div className="w-px h-5 bg-border" />
            <Sparkles className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">Visual Regression</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure your visual regression test parameters. AI agents will analyze your Figma designs
            and compare them against your live website in real-time.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="figma-url" className="text-sm font-semibold text-foreground">
              Figma Design File URL
            </Label>
            <Input
              id="figma-url"
              type="text"
              placeholder="https://www.figma.com/file/..."
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
              className="min-h-10"
              data-testid="input-figma-url"
            />
            <p className="text-xs text-muted-foreground">
              The Figma file containing your baseline design specifications
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="website-url" className="text-sm font-semibold text-foreground">
              Website / Application URL
            </Label>
            <Input
              id="website-url"
              type="text"
              placeholder="https://your-app.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="min-h-10"
              data-testid="input-website-url"
            />
            <p className="text-xs text-muted-foreground">
              The live website or application to test against the design
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="test-scope" className="text-sm font-semibold text-foreground">
                Test Scope
              </Label>
              <Select value={testScope} onValueChange={setTestScope}>
                <SelectTrigger id="test-scope" className="min-h-10" data-testid="select-test-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full-page">Full Page</SelectItem>
                  <SelectItem value="component">Component</SelectItem>
                  <SelectItem value="accessibility">Accessibility Scan</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="browser-target" className="text-sm font-semibold text-foreground">
                Browser Target
              </Label>
              <Select value={browserTarget} onValueChange={setBrowserTarget}>
                <SelectTrigger id="browser-target" className="min-h-10" data-testid="select-browser-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chrome">Chrome</SelectItem>
                  <SelectItem value="firefox">Firefox</SelectItem>
                  <SelectItem value="safari">Safari</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="p-4 rounded-md bg-primary/10 border border-primary/20">
            <p className="text-sm text-foreground">
              <span className="font-semibold">Visual Regression Testing:</span> Configure your design comparison parameters above. Navigate to Functional Testing Agent from the sidebar to run intelligent functional tests with automated workflow discovery.
            </p>
          </div>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            data-testid="button-start-test"
          >
            Start Test Now
          </Button>
        </form>
      </Card>
    </div>
  );
}

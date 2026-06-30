import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Bot, Eye, Settings, Accessibility, Code2, Brain, GitBranch, BarChart3, Shield, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "@/contexts/BrandingContext";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { brand } = useBranding();

  useEffect(() => {
    const isAuthenticated = localStorage.getItem("isAuthenticated") === "true";
    if (isAuthenticated) {
      setLocation("/");
    }
  }, [setLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/login", { email, password });
      localStorage.setItem("isAuthenticated", "true");
      setLocation("/");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: error.message || "Please try again",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    { icon: <Bot className="w-10 h-10 text-indigo-500" />, title: "AI Agent Testing", description: "Autonomous agents analyze your applications and generate comprehensive test cases automatically." },
    { icon: <Eye className="w-10 h-10 text-indigo-500" />, title: "Visual Regression", description: "Compare Figma designs with live websites. Detect layout, color, and spacing discrepancies in real-time." },
    { icon: <Settings className="w-10 h-10 text-indigo-500" />, title: "Functional Testing", description: "Agents test button clicks, form submissions, navigation flows, and user interactions automatically." },
    { icon: <Accessibility className="w-10 h-10 text-indigo-500" />, title: "Accessibility Compliance", description: "Automated WCAG AA compliance testing. Detect contrast issues, keyboard navigation, and screen reader compatibility." },
    { icon: <Code2 className="w-10 h-10 text-indigo-500" />, title: "Code Review & QA", description: "Intelligent code analysis with automated quality checks. Review pull requests and identify potential issues." },
    { icon: <Brain className="w-10 h-10 text-indigo-500" />, title: "Agentic RAG Enabled", description: "AI-powered retrieval and generation. Learn from your test history to improve coverage and accuracy." },
    { icon: <GitBranch className="w-10 h-10 text-indigo-500" />, title: "CI/CD Compatible", description: "Seamless integration with GitHub, GitLab, and Jenkins. Automate testing in your existing pipeline." },
    { icon: <BarChart3 className="w-10 h-10 text-indigo-500" />, title: "Performance Monitoring", description: "Track test metrics, execution times, and coverage trends. Get actionable insights to optimize testing." },
    { icon: <Shield className="w-10 h-10 text-indigo-500" />, title: "Security Testing", description: "Automated vulnerability scanning and security compliance checks. Protect your applications from threats." },
    { icon: <Users className="w-10 h-10 text-indigo-500" />, title: "Multi-Team Support", description: "Collaborate seamlessly across QA, DevOps, and development teams. Real-time reporting and access control." },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-gray-100" style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 50%, #eff6ff 100%)' }}>
        {/* Subtle grid */}
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(to right, rgba(79,70,229,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(79,70,229,0.06) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }} />

        {/* Ambient glow */}
        <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full opacity-30"
             style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-20"
             style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)' }} />

        <div className="relative z-10 w-full max-w-4xl mx-auto px-8 py-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-6 tracking-wide"
               style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4f46e5' }}>
            AI-POWERED AUTONOMOUS TESTING
          </div>

          <h1 className="mb-4" data-testid="heading-hero" style={{ fontSize: 'clamp(3rem, 8vw, 6rem)', fontWeight: 800, color: '#111827', lineHeight: 1.1 }}>
            {brand.heroTitle.split(' ')[0]}
            {brand.heroTitle.split(' ').length > 1 && (
              <span style={{ color: '#4f46e5', marginLeft: '0.25em' }}>
                {brand.heroTitle.split(' ').slice(1).join(' ')}
              </span>
            )}
          </h1>

          <p className="text-lg text-gray-500 mb-8 max-w-2xl mx-auto" data-testid="text-subheading" style={{ lineHeight: 1.7 }}>
            {brand.heroSubtitle}
          </p>

          <div className="flex items-center justify-center gap-4 py-2 mb-8">
            <div className="h-px w-16 bg-gradient-to-r from-transparent via-indigo-300 to-transparent" />
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
            <div className="h-px w-16 bg-gradient-to-r from-transparent via-indigo-300 to-transparent" />
          </div>

          <Button
            size="lg"
            className="text-white font-semibold px-10 py-5 text-base rounded-lg transition-all duration-200 hover:opacity-90"
            style={{ background: '#4f46e5', boxShadow: '0 4px 14px rgba(79,70,229,0.3)' }}
            onClick={() => document.getElementById("login-section")?.scrollIntoView({ behavior: "smooth" })}
            data-testid="button-get-started"
          >
            Get Started
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-8 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3" data-testid="heading-features">
            Comprehensive Testing Capabilities
          </h2>
          <p className="text-base text-gray-500" data-testid="text-features-subtitle">
            Everything your testing team needs in one intelligent platform
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4">
          {features.map((feature, index) => (
            <Card
              key={index}
              className="p-5 border border-gray-200 hover:border-indigo-200 hover:shadow-sm cursor-pointer transition-all duration-200 bg-white"
              data-testid={`card-feature-${index}`}
            >
              <div className="flex flex-col items-center text-center space-y-3">
                {feature.icon}
                <h3 className="text-sm font-semibold text-gray-900">{feature.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{feature.description}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Login Section */}
      <section id="login-section" className="container mx-auto px-8 py-20 pb-32">
        <Card
          className="max-w-md mx-auto p-8 border border-gray-200 shadow-sm bg-white"
          data-testid="card-login"
        >
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900" data-testid="heading-login">
                {brand.loginTitle}
              </h2>
              <p className="text-sm text-gray-500 mt-2" data-testid="text-demo-mode">
                Demo mode: Use any credentials
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                type="email"
                placeholder="Enter any email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-gray-300 text-gray-900 bg-white"
                required
                data-testid="input-email"
              />
              <Input
                type="password"
                placeholder="Enter any password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-gray-300 text-gray-900 bg-white"
                required
                data-testid="input-password"
              />
              <Button
                type="submit"
                className="w-full font-semibold text-white"
                style={{ background: '#4f46e5' }}
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? "Logging in..." : "Login"}
              </Button>
            </form>
          </div>
        </Card>
      </section>
    </div>
  );
}

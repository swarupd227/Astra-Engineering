import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[AppErrorBoundary] Unhandled UI error:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoToOverview = () => {
    window.location.assign("/overview");
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full bg-background text-foreground flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-lg border bg-card shadow-sm p-8 text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              Something broke while loading this screen. Please try again.
            </p>
            <div className="pt-2 flex items-center justify-center gap-3">
              <Button
                onClick={this.handleReload}
                data-testid="button-error-boundary-reload"
              >
                Try Again
              </Button>
              <Button
                variant="outline"
                onClick={this.handleGoToOverview}
                data-testid="button-error-boundary-overview"
              >
                Go to Overview
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Reusable error banner component for displaying normalized errors
 */

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, LogIn, X } from "lucide-react";
import type { NormalizedError } from "@/types/errors";
import { cn } from "@/lib/utils";

export interface ErrorBannerProps {
  error: NormalizedError | null;
  onRetry?: () => void;
  onLogin?: () => void;
  onDismiss?: () => void;
  className?: string;
  showDetails?: boolean; // For dev/debug mode
}

export function ErrorBanner({
  error,
  onRetry,
  onLogin,
  onDismiss,
  className,
  showDetails = false,
}: ErrorBannerProps) {
  if (!error) return null;

  const showRetry = error.retryable && error.action === "RETRY" && onRetry;
  const showLogin = error.action === "LOGIN" && onLogin;
  const showDismiss = onDismiss;

  return (
    <Alert
      variant="destructive"
      className={cn("relative", className)}
      data-testid="error-banner"
    >
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription className="flex items-center justify-between gap-4 pr-8">
        <span 
          className="flex-1 text-sm leading-relaxed break-words" 
          data-testid="error-message"
        >
          {error.message}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {showRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="h-7 text-xs"
              data-testid="error-retry-button"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          )}
          {showLogin && (
            <Button
              variant="outline"
              size="sm"
              onClick={onLogin}
              className="h-7 text-xs"
              data-testid="error-login-button"
            >
              <LogIn className="h-3 w-3 mr-1" />
              Sign In
            </Button>
          )}
          {showDismiss && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="h-7 w-7 p-0 shrink-0"
              data-testid="error-dismiss-button"
              aria-label="Close error message"
              type="button"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </AlertDescription>
      {showDetails && error.details && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Technical Details
          </summary>
          <pre className="mt-2 p-2 bg-muted rounded overflow-auto max-h-40">
            {JSON.stringify(error.details, null, 2)}
          </pre>
        </details>
      )}
    </Alert>
  );
}


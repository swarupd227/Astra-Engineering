import React from "react";

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[QE ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      return (
        <div className="flex items-center justify-center h-screen bg-slate-50">
          <div className="max-w-lg w-full mx-4 p-6 bg-white rounded-xl shadow-lg border border-red-200">
            <h2 className="text-lg font-bold text-red-700 mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              The page encountered an unexpected error. See the details
              below, then try reloading. If the problem persists, share
              the stack with the Astra team.
            </p>
            {err && (
              <pre className="text-xs bg-red-50 text-red-800 p-3 rounded-lg overflow-auto max-h-40 mb-4 border border-red-100">
                {err.message}
                {"\n"}
                {err.stack}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

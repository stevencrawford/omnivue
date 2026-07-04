import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="sess-empty-state flex-1 h-full">
          <div className="flex flex-col items-center gap-3 max-w-xs">
            <div className="sess-empty-icon">
              <CircleAlert size={20} />
            </div>
            <p className="text-sm font-medium text-ov-text">Something went wrong</p>
            <p className="text-xs text-ov-text-secondary text-center leading-relaxed max-w-xs">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-md border border-accent-border bg-accent-muted text-accent hover:bg-accent/20 cursor-pointer transition-colors"
              onClick={() => this.setState({ hasError: false })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

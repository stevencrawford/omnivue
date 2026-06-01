import { Component, type ErrorInfo, type ReactNode } from "react";

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
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <svg className="size-8 text-red-400 mb-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53L4.47.22ZM6.5 6.5v3a.75.75 0 0 0 1.5 0v-3a.75.75 0 0 0-1.5 0ZM8 11a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
          </svg>
          <p className="text-sm font-medium text-gh-text">Something went wrong</p>
          <p className="text-xs text-gh-text-secondary mt-1 mb-3 max-w-sm">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            type="button"
            className="text-xs text-accent hover:underline cursor-pointer"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { i18n } from "@/shared/i18n";
import { reportError } from "@/shared/lib";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { componentStack: info.componentStack });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // ErrorBoundary sits OUTSIDE <I18nextProvider>, so the useTranslation
      // hook is unavailable here; read from the global i18n instance directly.
      return (
        this.props.fallback ?? (
          <div className="p-8 text-center">
            <h1 className="text-lg font-medium">{i18n.t("common.error.title")}</h1>
            <p className="text-foreground/60">{i18n.t("common.error.description")}</p>
            <button
              type="button"
              onClick={this.handleRetry}
              className="mt-4 h-9 rounded-md border border-foreground/20 px-4 text-sm"
            >
              {i18n.t("common.error.retry")}
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

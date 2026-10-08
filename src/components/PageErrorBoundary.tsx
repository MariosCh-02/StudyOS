import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  /** Changing this (e.g. the route path) clears the error, so navigating away recovers. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** A page's code failed to load (typically after an update while the app was open). */
const isChunkError = (e: Error) => /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(e.message);

/**
 * Catches errors in one page so the rest of StudyOS (sidebar, timer,
 * reminders) keeps working and the problem is visible instead of a blank window.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("StudyOS page error:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div role="alert" className="mx-auto mt-16 flex max-w-lg flex-col items-start gap-3 rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="size-5 text-warning" aria-hidden />
          {chunk ? "This page needs a reload" : "Something went wrong on this page"}
        </h2>
        <p className="text-sm text-muted">
          {chunk
            ? "StudyOS was updated while it was open, so this page's code couldn't be loaded. Reloading fixes it; your data is safe."
            : "Your data is safe. Try reloading; if it happens again, the details below help find the cause."}
        </p>
        {!chunk && <pre className="max-h-40 w-full overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap select-text">{error.message || String(error)}</pre>}
        <Button variant="primary" icon={<RefreshCw className="size-4" />} onClick={() => window.location.reload()}>
          Reload StudyOS
        </Button>
      </div>
    );
  }
}

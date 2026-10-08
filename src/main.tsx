import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { AuthGate } from "./features/auth/AuthGate";
import { applyCachedTheme } from "./hooks/useTheme";
import { installExternalLinkGuard } from "./lib/links";
import { installFlushOnExit } from "./lib/flush";
import "./index.css";
import "./styles/highlight.css";

applyCachedTheme();
installExternalLinkGuard();
installFlushOnExit();

const queryClient = new QueryClient({
  defaultOptions: {
    // Data is local: no network retries or refetch-on-focus storms.
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <HashRouter>
          {/* Last line of defence: a crash outside a page shows its error instead of a blank window. */}
          <PageErrorBoundary resetKey="app">
            <App />
          </PageErrorBoundary>
        </HashRouter>
      </AuthGate>
    </QueryClientProvider>
  </StrictMode>,
);

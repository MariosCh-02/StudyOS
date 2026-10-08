import { Outlet, useLocation } from "react-router";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { useSettings } from "@/hooks/queries";
import { useTheme } from "@/hooks/useTheme";
import { Sidebar } from "./Sidebar";

/** App frame with the sidebar. `fullBleed` gives editor-style screens the whole content area. */
export function AppShell({ fullBleed = false }: { fullBleed?: boolean }) {
  const settings = useSettings();
  const { pathname } = useLocation();
  useTheme(settings.data?.theme);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className={fullBleed ? "min-w-0 flex-1 overflow-hidden" : "min-w-0 flex-1 overflow-y-auto"}>
        {fullBleed ? (
          <PageErrorBoundary resetKey={pathname}>
            <Outlet />
          </PageErrorBoundary>
        ) : (
          <div className="mx-auto max-w-6xl px-8 py-7">
            <PageErrorBoundary resetKey={pathname}>
              <Outlet />
            </PageErrorBoundary>
          </div>
        )}
      </main>
    </div>
  );
}

/** Standard page heading used by every screen. */
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs text-muted">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

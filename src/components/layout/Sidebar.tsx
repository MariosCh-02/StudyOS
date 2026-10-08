import { NavLink } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertCircle, BarChart3, FileText, FolderKanban, FolderOpen, Brain, Layers, Lightbulb, MessageCircleQuestion, Search, BookOpen, CalendarDays, CalendarRange, CheckSquare, Cloud, CloudOff, GraduationCap, House, NotebookPen, RefreshCw, Settings, Timer } from "lucide-react";
import { useProgrammes, useSettings } from "@/hooks/queries";
import { setSetting } from "@/services/settings";
import { LABELS } from "@/domain/types";
import { describeSync, useSyncStatus } from "@/hooks/useSyncStatus";
import { syncNow } from "@/sync/syncService";
import { formatClock, useTimer } from "@/features/study/TimerProvider";

const NAV = [
  { to: "/", label: "Dashboard", icon: House, end: true },
  { to: "/studies", label: "My Studies", icon: BookOpen, end: false },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, end: false },
  { to: "/timetable", label: "Timetable", icon: CalendarRange, end: false },
  { to: "/notes", label: "Notes", icon: NotebookPen, end: false },
  { to: "/tasks", label: "Tasks", icon: CheckSquare, end: false },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: false },
  { to: "/papers", label: "Papers", icon: FileText, end: false },
  { to: "/practice", label: "Practice", icon: Brain, end: false },
  { to: "/flashcards", label: "Flashcards", icon: Layers, end: false },
  { to: "/knowledge", label: "Knowledge Base", icon: Lightbulb, end: false },
  { to: "/grades", label: "Grades", icon: BarChart3, end: false },
  { to: "/study", label: "Study", icon: Timer, end: false },
  { to: "/files", label: "Files", icon: FolderOpen, end: false },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/ask", label: "Ask My Studies", icon: MessageCircleQuestion, end: false },
];

function NavItem({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "flex h-9 items-center gap-3 rounded-md px-3 text-[13.5px] transition-colors",
          isActive ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
        )
      }
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </NavLink>
  );
}

function ProgrammeSwitcher() {
  const programmes = useProgrammes();
  const settings = useSettings();
  const client = useQueryClient();
  const list = programmes.data ?? [];
  if (list.length === 0) return null;

  const activeId = settings.data?.activeProgrammeId ?? "";
  const change = async (id: string) => {
    await setSetting("activeProgrammeId", id);
    await client.invalidateQueries();
  };

  return (
    <div className="px-3 pb-3">
      <label htmlFor="programme-switcher" className="mb-1 block px-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
        Programme
      </label>
      <select
        id="programme-switcher"
        value={list.some((p) => p.id === activeId) ? activeId : ""}
        onChange={(e) => void change(e.target.value)}
        className="h-9 w-full truncate rounded-md border border-border bg-surface-2 px-2 text-[13px] text-fg focus:border-accent focus:outline-none"
      >
        {!list.some((p) => p.id === activeId) && <option value="">Select a programme</option>}
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {LABELS.programmeStatus[p.status]}
          </option>
        ))}
      </select>
    </div>
  );
}

function MiniTimer() {
  const timer = useTimer();
  const s = timer.state;
  if (s.status === "idle") return null;
  return (
    <NavLink
      to="/study"
      className={clsx(
        "mx-3 mb-2 flex items-center justify-between rounded-md px-3 py-2 text-sm",
        s.phase === "focus" ? "bg-accent-soft text-accent" : "bg-success-soft text-success",
      )}
    >
      <span className="flex items-center gap-2">
        <Timer className="size-4" aria-hidden />
        {s.phase === "focus" ? "Focus" : "Break"}
        {s.status === "paused" && " (paused)"}
      </span>
      <span className="font-semibold tabular-nums">{formatClock(timer.remainingMs)}</span>
    </NavLink>
  );
}

function SyncIndicator() {
  const status = useSyncStatus();
  const Icon = status.phase === "syncing" ? RefreshCw : status.phase === "offline" ? CloudOff : status.phase === "error" ? AlertCircle : Cloud;
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={status.error ?? "Sync now"}
      className={clsx(
        "mb-1 flex h-8 w-full items-center gap-3 rounded-md px-3 text-xs transition-colors hover:bg-surface-2",
        status.phase === "error" ? "text-danger" : "text-subtle hover:text-fg",
      )}
    >
      <Icon className={clsx("size-3.5", status.phase === "syncing" && "animate-spin")} aria-hidden />
      <span className="truncate">{describeSync(status)}</span>
    </button>
  );
}

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
          <GraduationCap className="size-4" aria-hidden />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">StudyOS</span>
      </div>
      <ProgrammeSwitcher />
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {NAV.map((n) => (
          <NavItem key={n.to} {...n} />
        ))}
      </nav>
      <MiniTimer />
      <div className="border-t border-border p-3">
        <SyncIndicator />
        <NavItem to="/settings" label="Settings" icon={Settings} end={false} />
      </div>
    </aside>
  );
}

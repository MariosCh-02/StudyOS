import { useNavigate, useSearchParams } from "react-router";
import clsx from "clsx";
import { Brain, ClipboardCheck, History, LineChart, Map as MapIcon, Play, Sigma, Target } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { useDueCounts } from "@/hooks/queries";
import { FormulaLibrary } from "./FormulaLibrary";
import { DiagnosticsTab, HistoryTab, MasteryTab, QuestionsTab } from "./PracticeTabs";
import { TracksTab } from "./TracksTab";
import { VisualizationsTab } from "./VisualizationsTab";

const TABS = [
  { id: "tracks", label: "Learning tracks", icon: MapIcon },
  { id: "questions", label: "Questions", icon: Brain },
  { id: "mastery", label: "Mastery", icon: Target },
  { id: "diagnostics", label: "Diagnostics", icon: ClipboardCheck },
  { id: "formulas", label: "Formulas", icon: Sigma },
  { id: "visualizations", label: "Visualizations", icon: LineChart },
  { id: "history", label: "History", icon: History },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function PracticePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.some((t) => t.id === params.get("tab")) ? (params.get("tab") as TabId) : "tracks";
  const due = useDueCounts();
  const questionsDue = due.data?.questionsDue ?? 0;

  return (
    <>
      <PageHeader
        title="Practice"
        subtitle="Lessons, quizzes with adaptive difficulty, diagnostics and mastery for any subject."
        actions={
          <Button variant="primary" icon={<Play className="size-4" />} disabled={questionsDue === 0} onClick={() => navigate("/practice/quiz?due=1&kind=review&title=Review%20due%20questions&count=all")}>
            {questionsDue ? `Review ${questionsDue} due question${questionsDue === 1 ? "" : "s"}` : "No questions due"}
          </Button>
        }
      />
      <div role="tablist" aria-label="Practice sections" className="mb-5 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === "tracks" ? {} : { tab: t.id }, { replace: true })}
            className={clsx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm", tab === t.id ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg")}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>
      {tab === "tracks" && <TracksTab />}
      {tab === "questions" && <QuestionsTab />}
      {tab === "mastery" && <MasteryTab />}
      {tab === "diagnostics" && <DiagnosticsTab />}
      {tab === "formulas" && <FormulaLibrary />}
      {tab === "history" && <HistoryTab />}
      {tab === "visualizations" && <VisualizationsTab />}
    </>
  );
}

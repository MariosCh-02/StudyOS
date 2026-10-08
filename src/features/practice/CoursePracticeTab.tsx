import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Brain, Layers, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, Stat } from "@/components/ui/Feedback";
import { useFlashcards, useQuestions } from "@/hooks/queries";
import { toDateKey } from "@/domain/dates";
import { FlashcardForm } from "@/features/flashcards/FlashcardForm";
import { FormulaLibrary } from "./FormulaLibrary";
import { QuestionForm } from "./QuestionForm";

/** A course's practice material: flashcards, questions and its formula sheet. */
export function CoursePracticeTab({ courseId, courseName }: { courseId: string; courseName: string }) {
  const navigate = useNavigate();
  const cards = useFlashcards({ courseId });
  const questions = useQuestions({ courseId });
  const [addingCard, setAddingCard] = useState(false);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const defaults = useMemo(() => ({ courseId }), [courseId]);
  const today = toDateKey(new Date());
  const due = (cards.data ?? []).filter((c) => c.dueDate == null || c.dueDate <= today).length;

  return (
    <div className="grid grid-cols-[1fr_24rem] items-start gap-6">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-5">
          <Card>
            <CardHeader title="Flashcards" icon={<Layers className="size-3.5" />} action={<Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddingCard(true)}>Add</Button>} />
            <div className="flex gap-6 px-4 pb-3">
              <Stat label="Cards" value={cards.data?.length ?? "—"} />
              <Stat label="Due / new" value={due} />
            </div>
            <div className="px-4 pb-4">
              <Button variant="primary" className="w-full" icon={<Play className="size-4" />} disabled={due === 0} onClick={() => navigate(`/flashcards/review?course=${courseId}`)}>
                Review
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Questions" icon={<Brain className="size-3.5" />} action={<Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddingQuestion(true)}>Add</Button>} />
            <div className="flex gap-6 px-4 pb-3">
              <Stat label="Questions" value={questions.data?.length ?? "—"} />
            </div>
            <div className="px-4 pb-4">
              <Button variant="primary" className="w-full" icon={<Play className="size-4" />} disabled={!questions.data?.length} onClick={() => navigate(`/practice/quiz?course=${courseId}&kind=exam&title=${encodeURIComponent(`${courseName} practice`)}`)}>
                Practice quiz
              </Button>
            </div>
          </Card>
        </div>
        <p className="text-xs text-subtle">Make flashcards straight from your notes: select text in a note and use the Flashcard button in the toolbar.</p>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Formula sheet</h3>
        <FormulaLibrary courseId={courseId} compact />
      </div>
      <FlashcardForm open={addingCard} defaults={defaults} onClose={() => setAddingCard(false)} />
      <QuestionForm open={addingQuestion} defaults={defaults} onClose={() => setAddingQuestion(false)} />
    </div>
  );
}

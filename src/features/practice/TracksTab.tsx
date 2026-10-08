import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Map as MapIcon, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState, ProgressBar } from "@/components/ui/Feedback";
import { FormModal } from "@/components/ui/Modal";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { ColorPicker } from "@/components/ui/Pickers";
import { useSaveMutation, useTracks } from "@/hooks/queries";
import { AVAILABLE_PACKS, type PackListing } from "@/content/packs";
import { createTrack, updateTrack, type Track } from "@/services/learning";
import { installedPackVersion, installPack } from "@/services/packs";

export function TrackForm({ open, onClose, track }: { open: boolean; onClose: () => void; track?: Track }) {
  const [form, setForm] = useState({ title: "", description: "", color: null as string | null });
  const save = useSaveMutation(async (f: typeof form) => {
    if (track) await updateTrack(track.id, f);
    else await createTrack(f);
  }, onClose);
  useEffect(() => {
    if (open) setForm({ title: track?.title ?? "", description: track?.description ?? "", color: track?.color ?? null });
  }, [open, track]);
  return (
    <FormModal open={open} onClose={onClose} title={track ? "Edit learning track" : "New learning track"} submitLabel={track ? "Save" : "Create track"} submitting={save.isPending} formError={save.formError} onSubmit={() => save.mutate(form)}>
      <TextField label="Title" required autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={save.fieldErrors.title} placeholder="e.g. Organic Chemistry Preparation, Bar Exam Preparation" />
      <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />
    </FormModal>
  );
}

function PackRow({ pack }: { pack: PackListing }) {
  const client = useQueryClient();
  const [installed, setInstalled] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void installedPackVersion(pack.id).then(setInstalled);
  }, [pack.id]);

  const install = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await installPack(await pack.load());
      setInstalled(pack.version);
      setMessage(`Installed ${r.lessons} lessons, ${r.questions} questions, ${r.flashcards} flashcards, ${r.formulas} formulas.`);
      await client.invalidateQueries();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const upToDate = installed != null && installed >= pack.version;
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{pack.title}</p>
        <p className="text-xs text-muted">{pack.description}</p>
        {message && <p className="mt-1 text-xs text-accent">{message}</p>}
      </div>
      {upToDate ? (
        <span className="text-xs text-success">Installed (v{installed})</span>
      ) : (
        <Button size="sm" variant={installed ? "secondary" : "primary"} loading={busy} icon={installed ? <RefreshCw className="size-3.5" /> : <Download className="size-3.5" />} onClick={() => void install()}>
          {installed ? `Update to v${pack.version}` : "Install"}
        </Button>
      )}
    </li>
  );
}

export function TracksTab() {
  const tracks = useTracks();
  const [creating, setCreating] = useState(false);
  const list = tracks.data ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New track
        </Button>
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MapIcon className="size-5" />}
            title="No learning tracks yet"
            description="A track is a structured path through subjects, from Foundation to Challenge level, e.g. AI Preparation, Organic Chemistry or Bar Exam Preparation. Create your own or install a content pack."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {list.map((t) => (
            <Link key={t.id} to={`/practice/tracks/${t.id}`} className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/60">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: t.color ?? "var(--accent)" }} />
                <p className="font-medium group-hover:text-accent">{t.title}</p>
              </div>
              {t.description && <p className="line-clamp-2 text-[13px] text-muted">{t.description}</p>}
              <p className="text-xs text-subtle">
                {t.subjectCount} subjects · {t.completedCount} / {t.lessonCount} lessons done
              </p>
              {t.lessonCount > 0 && <ProgressBar value={t.completedCount / t.lessonCount} label={`${t.title} progress`} />}
            </Link>
          ))}
        </div>
      )}
      {AVAILABLE_PACKS.length > 0 && (
        <Card>
          <h2 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Content packs</h2>
          <ul className="divide-y divide-border">
            {AVAILABLE_PACKS.map((p) => (
              <PackRow key={p.id} pack={p} />
            ))}
          </ul>
        </Card>
      )}
      <TrackForm open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

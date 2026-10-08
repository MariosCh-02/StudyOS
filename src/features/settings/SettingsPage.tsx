import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, LogOut, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { ErrorState, Spinner } from "@/components/ui/Feedback";
import { SelectField, TextField } from "@/components/ui/Field";
import { qk, useProfile, useSettings, useTemplates } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { NoteTemplate } from "@/domain/types";
import { deleteTemplate, renameTemplate } from "@/services/templates";
import { REMINDER_OPTIONS, setSetting, updateProfile, type ReminderMinutes, type SettingsMap, type ThemePreference, type WeekStart } from "@/services/settings";
import { useAuth } from "@/features/auth/AuthGate";
import { describeSync, useSyncStatus } from "@/hooks/useSyncStatus";
import { syncNow } from "@/sync/syncService";
import { Section } from "./Section";
import { AiSection } from "./AiSection";
import { BackupSection } from "./BackupSection";
import { WindowsSection } from "./WindowsSection";

function ProfileSection({ initial }: { initial: string }) {
  const client = useQueryClient();
  const [name, setName] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(initial);
  }, [initial]);

  const save = async () => {
    setState("saving");
    setError(null);
    try {
      await updateProfile({ displayName: name });
      await client.invalidateQueries();
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  };

  return (
    <Section title="Profile" description="Used for your greeting. Stored only on this computer.">
      <form
        className="flex max-w-md items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          className="flex-1"
          label="Display name"
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            setState("idle");
          }}
          error={error ?? undefined}
        />
        <Button type="submit" variant="primary" loading={state === "saving"} disabled={name.trim() === initial}>
          Save
        </Button>
      </form>
      {state === "saved" && (
        <p className="mt-2 flex items-center gap-1 text-xs text-success">
          <Check className="size-3.5" /> Saved
        </p>
      )}
    </Section>
  );
}

const THEMES: { value: ThemePreference; label: string; icon: typeof Moon }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

function AppearanceSection({ theme }: { theme: ThemePreference }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const choose = async (value: ThemePreference) => {
    setError(null);
    try {
      await setSetting("theme", value);
      await client.invalidateQueries({ queryKey: qk.settings });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Section title="Appearance" description="Dark is the default and easiest on the eyes for long study sessions.">
      <div role="radiogroup" aria-label="Theme" className="flex gap-3">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={theme === t.value}
            onClick={() => void choose(t.value)}
            className={clsx(
              "flex w-28 flex-col items-center gap-2 rounded-lg border px-3 py-3 text-sm transition-colors",
              theme === t.value ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-fg",
            )}
          >
            <t.icon className="size-5" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Section>
  );
}

function AccountSection() {
  const { user, signOut } = useAuth();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Account & sync" description="Your data is stored on this PC and synced to your private cloud space, so you can sign in on another computer.">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">Signed in as</dt>
        <dd className="text-fg select-text">
          {user.email}
          {!user.emailVerified && <span className="ml-2 text-xs text-warning">Email not verified</span>}
        </dd>
        <dt className="text-muted">Sync</dt>
        <dd className={status.phase === "error" ? "text-danger" : "text-fg"}>
          {describeSync(status)}
          {status.error && <p className="mt-0.5 text-xs break-words text-danger">{status.error}</p>}
        </dd>
      </dl>
      <div className="mt-4 flex gap-2">
        <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={status.phase === "syncing"} onClick={() => void syncNow()}>
          Sync now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<LogOut className="size-3.5" />}
          loading={busy}
          onClick={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
        >
          Sign out
        </Button>
      </div>
    </Section>
  );
}

function CalendarSection({ settings }: { settings: SettingsMap }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const change = async <K extends "weekStart" | "notifications" | "reminderMinutes">(key: K, value: SettingsMap[K]) => {
    setError(null);
    try {
      await setSetting(key, value);
      await client.invalidateQueries({ queryKey: qk.settings });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Section title="Calendar & notifications" description="Windows notifications are shown while StudyOS is open (it can be minimised).">
      <div className="grid max-w-md grid-cols-2 gap-3">
        <SelectField
          label="Week starts on"
          value={settings.weekStart}
          onChange={(e) => void change("weekStart", e.target.value as WeekStart)}
          options={[
            { value: "monday", label: "Monday" },
            { value: "sunday", label: "Sunday" },
          ]}
        />
        <SelectField
          label="Reminders"
          value={settings.notifications}
          onChange={(e) => void change("notifications", e.target.value as "on" | "off")}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
        <SelectField
          label="Remind me"
          value={settings.reminderMinutes}
          disabled={settings.notifications === "off"}
          onChange={(e) => void change("reminderMinutes", e.target.value as ReminderMinutes)}
          options={REMINDER_OPTIONS.map((m) => ({ value: m, label: `${m} minutes before` }))}
          hint="Classes, study sessions and exams. Exams also get a reminder the day before."
          className="col-span-2"
        />
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Section>
  );
}

function TemplatesSection() {
  const client = useQueryClient();
  const templates = useTemplates();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useConfirmAction((t: NoteTemplate) => deleteTemplate(t.id));

  const saveName = async () => {
    if (!renaming) return;
    setError(null);
    try {
      await renameTemplate(renaming.id, renaming.name);
      await client.invalidateQueries({ queryKey: ["templates"] });
      setRenaming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const list = templates.data ?? [];
  return (
    <Section
      title="Note templates"
      description="The lecture template is built in. Save any note as a template from its toolbar; {{title}}, {{course}} and {{date}} are filled in automatically."
    >
      {list.length === 0 ? (
        <p className="text-sm text-subtle">No custom templates yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              {renaming?.id === t.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveName();
                  }}
                >
                  <input
                    aria-label="Template name"
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    className="h-8 flex-1 rounded-md border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <Button size="sm" type="submit" variant="primary">
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 truncate text-sm">{t.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: t.id, name: t.name })}>
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.ask(t)}>
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <ConfirmDialog
        open={remove.target != null}
        title="Delete template?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={<p>“{remove.target?.name}” will be removed. Notes created from it are not affected.</p>}
      />
    </Section>
  );
}

function DataSection() {
  const [location, setLocation] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    // These APIs only exist inside the desktop shell.
    void (async () => {
      try {
        const [{ appConfigDir, join }, { getVersion }] = await Promise.all([import("@tauri-apps/api/path"), import("@tauri-apps/api/app")]);
        setLocation(await join(await appConfigDir(), "studyos.db"));
        setVersion(await getVersion());
      } catch {
        setLocation(null);
      }
    })();
  }, []);
  return (
    <Section
      title="Your data"
      description="A local copy keeps StudyOS fast and usable offline. There is no analytics, tracking or telemetry; only your own data is synced, to your account."
    >
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">Local copy</dt>
        <dd className="break-all text-fg select-text">{location ?? "Available in the desktop app"}</dd>
        <dt className="text-muted">Version</dt>
        <dd className="text-fg">{version ?? "—"}</dd>
      </dl>
    </Section>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const profile = useProfile();
  if (settings.isPending || profile.isPending) return <Spinner />;
  if (settings.error || profile.error) return <ErrorState error={settings.error ?? profile.error} />;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-4">
        <ProfileSection initial={profile.data.displayName} />
        <AccountSection />
        <CalendarSection settings={settings.data} />
        <TemplatesSection />
        <AiSection settings={settings.data} />
        <AppearanceSection theme={settings.data.theme} />
        <WindowsSection settings={settings.data} />
        <BackupSection settings={settings.data} />
        <DataSection />
      </div>
    </>
  );
}

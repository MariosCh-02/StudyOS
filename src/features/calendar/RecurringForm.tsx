import { useEffect, useState } from "react";
import clsx from "clsx";
import { FormModal } from "@/components/ui/Modal";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useAllCourses, useAllSemesters, useSaveMutation } from "@/hooks/queries";
import { EVENT_TYPE_META } from "@/domain/conflicts";
import { ruleDuration } from "@/domain/recurrence";
import { formatDuration, WEEKDAY_SHORT, type DateKey } from "@/domain/time";
import { toDateKey, formatDateRange } from "@/domain/dates";
import { createRecurring, updateRecurring, type RecurringEvent, type RecurringInput, type RecurringType } from "@/services/calendar";

const RECURRING_TYPES: RecurringType[] = ["class", "work", "study", "internship", "research", "personal", "other"];

export interface RecurringPreset {
  type: RecurringType;
  courseId?: string;
  weekdays?: number[];
  startTime?: string;
  endTime?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  series?: RecurringEvent;
  preset?: RecurringPreset;
}

const PRESET_DEFAULTS: Record<string, Partial<RecurringInput>> = {
  work: { title: "Work", weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "16:00" },
  study: { title: "Study session", weekdays: [1, 3], startTime: "19:30", endTime: "20:30" },
  class: { weekdays: [], startTime: "17:00", endTime: "19:00" },
};

function initial(series: RecurringEvent | undefined, preset: RecurringPreset | undefined): RecurringInput {
  if (series) return { ...series };
  const type = preset?.type ?? "class";
  const d = PRESET_DEFAULTS[type] ?? {};
  return {
    type,
    title: d.title ?? "",
    courseId: preset?.courseId ?? null,
    semesterId: null,
    weekdays: preset?.weekdays ?? d.weekdays ?? [],
    startTime: preset?.startTime ?? d.startTime ?? "09:00",
    endTime: preset?.endTime ?? d.endTime ?? "10:00",
    startDate: toDateKey(new Date()),
    endDate: null,
    intervalWeeks: 1,
    location: null,
    lecturer: null,
    notes: null,
  };
}

/** Create/edit a weekly recurring item: a class in the timetable, a work schedule, a study routine… */
export function RecurringForm({ open, onClose, series, preset }: Props) {
  const courses = useAllCourses();
  const semesters = useAllSemesters();
  const [form, setForm] = useState<RecurringInput>(() => initial(series, preset));
  const save = useSaveMutation((input: RecurringInput) => (series ? updateRecurring(series.id, input) : createRecurring(input)), onClose);

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(initial(series, preset));
  }, [open, series, preset]);

  // Classes picked from a course take its name, room and lecturer.
  useEffect(() => {
    if (!open || series || !preset?.courseId) return;
    const c = courses.data?.find((x) => x.id === preset.courseId);
    if (c) setForm((f) => ({ ...f, title: f.title || c.name, location: f.location ?? c.location, lecturer: f.lecturer ?? c.lecturer, semesterId: f.semesterId ?? c.semesterId }));
  }, [open, series, preset, courses.data]);

  // Linking a semester fills in its dates.
  useEffect(() => {
    if (!form.semesterId) return;
    const s = semesters.data?.find((x) => x.id === form.semesterId);
    if (s?.startDate) setForm((f) => (f.startDate === s.startDate && f.endDate === s.endDate ? f : { ...f, startDate: s.startDate!, endDate: s.endDate }));
  }, [form.semesterId, semesters.data]);

  const set = <K extends keyof RecurringInput>(k: K, v: RecurringInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (d: number) => set("weekdays", form.weekdays.includes(d) ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d].sort());
  const onCourse = (id: string) => {
    const c = courses.data?.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      courseId: id || null,
      title: c && (!f.title || courses.data?.some((x) => x.name === f.title)) ? c.name : f.title,
      location: f.location || c?.location || null,
      lecturer: f.lecturer || c?.lecturer || null,
      semesterId: c?.semesterId ?? f.semesterId,
    }));
  };
  const e = save.fieldErrors;
  const valid = /^\d\d:\d\d$/.test(form.startTime) && /^\d\d:\d\d$/.test(form.endTime) && form.startTime !== form.endTime;
  const noun = form.type === "work" ? "work schedule" : form.type === "class" ? "class" : "recurring event";

  const semesterOptions = [
    { value: "", label: "Custom dates" },
    ...(semesters.data ?? [])
      .filter((s) => s.startDate)
      .map((s) => ({ value: s.id, label: `${s.programmeName} · ${s.yearLabel} · ${s.label} (${formatDateRange(s.startDate, s.endDate)})` })),
  ];

  return (
    <FormModal
      open={open}
      onClose={onClose}
      width="lg"
      title={series ? `Edit ${noun}` : `New ${noun}`}
      submitLabel={series ? "Save" : "Add"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={() => save.mutate(form)}
    >
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Type"
          value={form.type}
          onChange={(ev) => set("type", ev.target.value as RecurringType)}
          options={RECURRING_TYPES.map((t) => ({ value: t, label: `${EVENT_TYPE_META[t].emoji} ${EVENT_TYPE_META[t].label}` }))}
        />
        <SelectField
          label={form.type === "class" ? "Course" : "Course (optional)"}
          value={form.courseId ?? ""}
          onChange={(ev) => onCourse(ev.target.value)}
          options={[{ value: "", label: "None" }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))]}
        />
      </div>
      <TextField label="Title" required value={form.title} onChange={(ev) => set("title", ev.target.value)} error={e.title} />

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-muted">Repeats on</legend>
        <div className="flex gap-1.5">
          {WEEKDAY_SHORT.map((label, i) => {
            const day = i + 1;
            const on = form.weekdays.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(day)}
                className={clsx("h-8 w-11 rounded-md border text-xs font-medium transition-colors", on ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg")}
              >
                {label}
              </button>
            );
          })}
        </div>
        {e.weekdays && <p className="mt-1 text-xs text-danger">{e.weekdays}</p>}
      </fieldset>

      <div className="grid grid-cols-3 gap-3">
        <TextField label="Starts" type="time" value={form.startTime} onChange={(ev) => set("startTime", ev.target.value)} error={e.startTime} />
        <TextField
          label="Ends"
          type="time"
          value={form.endTime}
          onChange={(ev) => set("endTime", ev.target.value)}
          error={e.endTime}
          hint={valid ? `${formatDuration(ruleDuration(form))}${form.endTime < form.startTime ? ", ends next day" : ""}` : undefined}
        />
        <SelectField
          label="Every"
          value={String(form.intervalWeeks)}
          onChange={(ev) => set("intervalWeeks", Number(ev.target.value))}
          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: n === 1 ? "Week" : `${n} weeks` }))}
          error={e.intervalWeeks}
        />
      </div>

      <SelectField label="Dates" value={form.semesterId ?? ""} onChange={(ev) => set("semesterId", ev.target.value || null)} options={semesterOptions} hint="Link a semester to use its start and end dates." />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="From" type="date" value={form.startDate} onChange={(ev) => setForm((f) => ({ ...f, startDate: ev.target.value as DateKey, semesterId: null }))} error={e.startDate} />
        <TextField
          label="Until (optional)"
          type="date"
          value={form.endDate ?? ""}
          onChange={(ev) => setForm((f) => ({ ...f, endDate: ev.target.value || null, semesterId: null }))}
          error={e.endDate}
          hint={form.endDate ? undefined : "Repeats with no end"}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Room / location" value={form.location ?? ""} onChange={(ev) => set("location", ev.target.value)} />
        {form.type === "class" && <TextField label="Lecturer" value={form.lecturer ?? ""} onChange={(ev) => set("lecturer", ev.target.value)} />}
      </div>
      <TextAreaField label="Notes" value={form.notes ?? ""} onChange={(ev) => set("notes", ev.target.value)} />
    </FormModal>
  );
}

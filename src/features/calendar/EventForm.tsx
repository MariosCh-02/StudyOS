import { useEffect, useState } from "react";
import { FormModal } from "@/components/ui/Modal";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useAllCourses, useSaveMutation } from "@/hooks/queries";
import { EVENT_TYPE_META, EVENT_TYPES, type EventType } from "@/domain/conflicts";
import { addDays, addMinutes, dateOf, joinDateTime, timeOf, type LocalDateTime } from "@/domain/time";
import { toDateKey } from "@/domain/dates";
import { createEvent, updateEvent, type CalendarEvent, type CalendarEventInput } from "@/services/calendar";

interface Props {
  open: boolean;
  onClose: () => void;
  event?: CalendarEvent;
  /** Prefill for new events (e.g. the clicked time slot). */
  defaultStart?: LocalDateTime;
  defaultType?: EventType;
}

interface FormState {
  title: string;
  type: EventType;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  courseId: string;
  location: string;
  notes: string;
}

function initial(event: CalendarEvent | undefined, defaultStart: LocalDateTime | undefined, defaultType: EventType): FormState {
  if (event) {
    // All-day ends are exclusive in storage; the form shows the last day.
    const lastDay = event.allDay ? addDays(dateOf(event.end), -1) : dateOf(event.end);
    return {
      title: event.title,
      type: event.type,
      allDay: event.allDay,
      startDate: dateOf(event.start),
      startTime: timeOf(event.start),
      endDate: lastDay,
      endTime: timeOf(event.end),
      courseId: event.courseId ?? "",
      location: event.location ?? "",
      notes: event.notes ?? "",
    };
  }
  const start = defaultStart ?? joinDateTime(toDateKey(new Date()), "09:00");
  const end = addMinutes(start, 60);
  return {
    title: "",
    type: defaultType,
    allDay: false,
    startDate: dateOf(start),
    startTime: timeOf(start),
    endDate: dateOf(end),
    endTime: timeOf(end),
    courseId: "",
    location: "",
    notes: "",
  };
}

export function EventForm({ open, onClose, event, defaultStart, defaultType = "study" }: Props) {
  const courses = useAllCourses();
  const [form, setForm] = useState<FormState>(() => initial(event, defaultStart, defaultType));
  const save = useSaveMutation((input: CalendarEventInput) => (event ? updateEvent(event.id, input) : createEvent(input)), onClose);

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(initial(event, defaultStart, defaultType));
  }, [open, event, defaultStart, defaultType]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const e = save.fieldErrors;

  const submit = () => {
    const start = joinDateTime(form.startDate, form.allDay ? "00:00" : form.startTime);
    const end = form.allDay ? joinDateTime(addDays(form.endDate || form.startDate, 1), "00:00") : joinDateTime(form.endDate || form.startDate, form.endTime);
    save.mutate({
      title: form.title,
      type: form.type,
      allDay: form.allDay,
      start,
      end,
      courseId: form.courseId || null,
      location: form.location,
      notes: form.notes,
    });
  };

  const onCourse = (id: string) => {
    const c = courses.data?.find((x) => x.id === id);
    setForm((f) => ({ ...f, courseId: id, title: f.title || (c ? c.name : ""), location: f.location || c?.location || "" }));
  };

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={event ? "Edit event" : "New event"}
      submitLabel={event ? "Save" : "Add to calendar"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={submit}
    >
      <TextField label="Title" required autoFocus value={form.title} onChange={(ev) => set("title", ev.target.value)} error={e.title} placeholder="e.g. Revise chapter 3" />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Type"
          value={form.type}
          onChange={(ev) => set("type", ev.target.value as EventType)}
          options={EVENT_TYPES.map((t) => ({ value: t, label: `${EVENT_TYPE_META[t].emoji} ${EVENT_TYPE_META[t].label}` }))}
        />
        <SelectField
          label="Course (optional)"
          value={form.courseId}
          onChange={(ev) => onCourse(ev.target.value)}
          options={[{ value: "", label: "None" }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))]}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.allDay} onChange={(ev) => set("allDay", ev.target.checked)} className="size-4 accent-[var(--accent)]" />
        All day
      </label>
      {form.allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField label="From" type="date" value={form.startDate} onChange={(ev) => set("startDate", ev.target.value)} error={e.start} />
          <TextField label="To" type="date" value={form.endDate} onChange={(ev) => set("endDate", ev.target.value)} error={e.end} />
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_7rem_7rem] gap-3">
          <TextField
            label="Date"
            type="date"
            value={form.startDate}
            onChange={(ev) => setForm((f) => ({ ...f, startDate: ev.target.value, endDate: ev.target.value }))}
            error={e.start}
          />
          <TextField label="Start" type="time" value={form.startTime} onChange={(ev) => set("startTime", ev.target.value)} />
          <TextField label="End" type="time" value={form.endTime} onChange={(ev) => set("endTime", ev.target.value)} error={e.end} />
        </div>
      )}
      <TextField label="Location" value={form.location} onChange={(ev) => set("location", ev.target.value)} />
      <TextAreaField label="Notes" value={form.notes} onChange={(ev) => set("notes", ev.target.value)} />
    </FormModal>
  );
}

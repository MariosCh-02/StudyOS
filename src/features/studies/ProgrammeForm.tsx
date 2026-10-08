import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { FormModal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { numberToInput, parseOptionalNumber, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { ColorPicker, GradeInput } from "@/components/ui/Pickers";
import { useInstitutions, useSaveMutation } from "@/hooks/queries";
import { LABELS, PROGRAMME_LEVELS, PROGRAMME_STATUSES, type Programme, type ProgrammeInput } from "@/domain/types";
import { GRADING_PRESETS, scaleFromPreset, type GradingPreset, type GradingScale } from "@/domain/grading";
import { createProgramme, updateProgramme, type ProgrammeWithInstitution } from "@/services/programmes";
import { InstitutionForm } from "./InstitutionForm";

interface Props {
  open: boolean;
  onClose: () => void;
  programme?: Programme;
  defaultInstitutionId?: string;
  onSaved?: (p: ProgrammeWithInstitution) => void;
}

interface FormState {
  institutionId: string;
  name: string;
  level: ProgrammeInput["level"];
  status: ProgrammeInput["status"];
  field: string;
  startDate: string;
  endDate: string;
  totalCredits: string;
  creditUnit: string;
  scale: GradingScale;
  scaleMin: string;
  scaleMax: string;
  scalePass: string;
  targetGrade: string;
  color: string | null;
  notes: string;
}

function toState(p: Programme | undefined, institutionId: string): FormState {
  const scale = p?.gradingScale ?? scaleFromPreset("ten_point");
  return {
    institutionId: p?.institutionId ?? institutionId,
    name: p?.name ?? "",
    level: p?.level ?? "bachelor",
    status: p?.status ?? "active",
    field: p?.field ?? "",
    startDate: p?.startDate ?? "",
    endDate: p?.endDate ?? "",
    totalCredits: numberToInput(p?.totalCredits),
    creditUnit: p?.creditUnit ?? "ECTS",
    scale,
    scaleMin: String(scale.min),
    scaleMax: String(scale.max),
    scalePass: String(scale.pass),
    targetGrade: numberToInput(p?.targetGrade),
    color: p?.color ?? null,
    notes: p?.notes ?? "",
  };
}

function toInput(f: FormState): ProgrammeInput {
  const num = (v: string) => parseOptionalNumber(v) ?? Number.NaN;
  const gradingScale: GradingScale =
    f.scale.preset === "custom"
      ? { ...f.scale, min: num(f.scaleMin), max: num(f.scaleMax), pass: num(f.scalePass) }
      : { ...f.scale, pass: num(f.scalePass) };
  return {
    institutionId: f.institutionId,
    name: f.name,
    level: f.level,
    status: f.status,
    field: f.field,
    startDate: f.startDate || null,
    endDate: f.endDate || null,
    totalCredits: parseOptionalNumber(f.totalCredits),
    creditUnit: f.creditUnit,
    gradingScale,
    targetGrade: parseOptionalNumber(f.targetGrade),
    color: f.color,
    notes: f.notes,
  };
}

export function ProgrammeForm({ open, onClose, programme, defaultInstitutionId, onSaved }: Props) {
  const institutions = useInstitutions();
  const [form, setForm] = useState<FormState>(() => toState(programme, defaultInstitutionId ?? ""));
  const [newInstitution, setNewInstitution] = useState(false);
  const save = useSaveMutation(
    (input: ProgrammeInput) => (programme ? updateProgramme(programme.id, input) : createProgramme(input)),
    (saved) => {
      onSaved?.(saved);
      onClose();
    },
  );

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(toState(programme, defaultInstitutionId ?? institutions.data?.[0]?.id ?? ""));
  }, [open, programme]);

  // Pick the first institution once the list arrives for a new programme.
  useEffect(() => {
    if (open && !form.institutionId && institutions.data?.[0]) setForm((f) => ({ ...f, institutionId: institutions.data[0]!.id }));
  }, [open, form.institutionId, institutions.data]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const choosePreset = (preset: GradingPreset) => {
    const scale = scaleFromPreset(preset);
    setForm((f) => ({ ...f, scale, scaleMin: String(scale.min), scaleMax: String(scale.max), scalePass: String(scale.pass), targetGrade: "" }));
  };
  const e = save.fieldErrors;
  const custom = form.scale.preset === "custom";
  const institutionOptions = (institutions.data ?? []).map((i) => ({ value: i.id, label: i.name }));

  return (
    <>
      <FormModal
        open={open && !newInstitution}
        onClose={onClose}
        width="lg"
        title={programme ? "Edit programme" : "New programme"}
        submitLabel={programme ? "Save" : "Create programme"}
        submitting={save.isPending}
        formError={save.formError}
        onSubmit={() => save.mutate(toInput(form))}
      >
        <div className="flex items-end gap-2">
          <SelectField
            className="flex-1"
            label="Institution"
            required
            value={form.institutionId}
            onChange={(ev) => set("institutionId", ev.target.value)}
            options={institutionOptions.length ? institutionOptions : [{ value: "", label: "No institutions yet" }]}
            error={e.institutionId}
          />
          <Button icon={<Plus className="size-4" />} onClick={() => setNewInstitution(true)}>
            New
          </Button>
        </div>
        <TextField
          label="Programme name"
          required
          autoFocus
          placeholder="e.g. MSc Artificial Intelligence"
          value={form.name}
          onChange={(ev) => set("name", ev.target.value)}
          error={e.name}
        />
        <div className="grid grid-cols-3 gap-3">
          <SelectField
            label="Level"
            value={form.level}
            onChange={(ev) => set("level", ev.target.value as FormState["level"])}
            options={PROGRAMME_LEVELS.map((l) => ({ value: l, label: LABELS.programmeLevel[l] }))}
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={(ev) => set("status", ev.target.value as FormState["status"])}
            options={PROGRAMME_STATUSES.map((s) => ({ value: s, label: LABELS.programmeStatus[s] }))}
          />
          <TextField label="Field of study" placeholder="e.g. Law" value={form.field} onChange={(ev) => set("field", ev.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Start date" type="date" value={form.startDate} onChange={(ev) => set("startDate", ev.target.value)} error={e.startDate} />
          <TextField label="End date" type="date" value={form.endDate} onChange={(ev) => set("endDate", ev.target.value)} error={e.endDate} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Credits required"
            inputMode="decimal"
            placeholder="e.g. 90"
            value={form.totalCredits}
            onChange={(ev) => set("totalCredits", ev.target.value)}
            error={e.totalCredits}
            hint="Used for programme progress"
          />
          <TextField label="Credit unit" value={form.creditUnit} onChange={(ev) => set("creditUnit", ev.target.value)} error={e.creditUnit} hint="ECTS, credits, units…" />
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-[13px] font-medium text-muted">Grading</legend>
          <SelectField
            label="Grading scale"
            value={form.scale.preset}
            onChange={(ev) => choosePreset(ev.target.value as GradingPreset)}
            options={Object.entries(GRADING_PRESETS).map(([k, v]) => ({ value: k, label: v.label }))}
            error={e.gradingScale}
          />
          <div className="grid grid-cols-3 gap-3">
            <TextField label="Minimum" inputMode="decimal" disabled={!custom} value={form.scaleMin} onChange={(ev) => set("scaleMin", ev.target.value)} />
            <TextField label="Maximum" inputMode="decimal" disabled={!custom} value={form.scaleMax} onChange={(ev) => set("scaleMax", ev.target.value)} />
            <TextField label="Pass mark" inputMode="decimal" value={form.scalePass} onChange={(ev) => set("scalePass", ev.target.value)} />
          </div>
          <GradeInput
            label="Target grade"
            scale={form.scale}
            value={form.targetGrade}
            onChange={(v) => set("targetGrade", v)}
            error={e.targetGrade}
            hint="Your personal goal for the programme average"
          />
        </fieldset>

        <ColorPicker value={form.color} onChange={(c) => set("color", c)} />
        <TextAreaField label="Notes" value={form.notes} onChange={(ev) => set("notes", ev.target.value)} />
      </FormModal>

      <InstitutionForm
        open={open && newInstitution}
        onClose={() => setNewInstitution(false)}
        onSaved={(i) => set("institutionId", i.id)}
      />
    </>
  );
}

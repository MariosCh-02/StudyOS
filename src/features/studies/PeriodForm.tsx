import { useEffect, useState } from "react";
import { FormModal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { useSaveMutation } from "@/hooks/queries";
import type { AcademicYear, Semester } from "@/domain/types";
import { createAcademicYear, createSemester, updateAcademicYear, updateSemester } from "@/services/terms";

interface PeriodState {
  label: string;
  startDate: string;
  endDate: string;
}

type Target =
  | { kind: "year"; programmeId: string; existing?: AcademicYear }
  | { kind: "semester"; academicYearId: string; existing?: Semester };

interface Props {
  open: boolean;
  onClose: () => void;
  target: Target;
}

/** Shared create/edit form for academic years and semesters (both are labelled date ranges). */
export function PeriodForm({ open, onClose, target }: Props) {
  const [form, setForm] = useState<PeriodState>({ label: "", startDate: "", endDate: "" });
  const save = useSaveMutation(async (f: PeriodState) => {
    const v = { label: f.label, startDate: f.startDate || null, endDate: f.endDate || null };
    if (target.kind === "year") {
      return target.existing ? updateAcademicYear(target.existing.id, v) : createAcademicYear({ ...v, programmeId: target.programmeId });
    }
    return target.existing ? updateSemester(target.existing.id, v) : createSemester({ ...v, academicYearId: target.academicYearId });
  }, onClose);

  useEffect(() => {
    if (!open) return;
    save.reset();
    const ex = target.existing;
    setForm({ label: ex?.label ?? "", startDate: ex?.startDate ?? "", endDate: ex?.endDate ?? "" });
  }, [open, target.existing]);

  const isYear = target.kind === "year";
  const noun = isYear ? "academic year" : "semester";
  const e = save.fieldErrors;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={`${target.existing ? "Edit" : "New"} ${noun}`}
      submitLabel={target.existing ? "Save" : `Create ${noun}`}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={() => save.mutate(form)}
    >
      <TextField
        label="Name"
        required
        autoFocus
        placeholder={isYear ? "e.g. 2026–2027 or Year 2" : "e.g. Semester 1, Fall term, Q3"}
        value={form.label}
        onChange={(ev) => setForm({ ...form, label: ev.target.value })}
        error={e.label}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Start date" type="date" value={form.startDate} onChange={(ev) => setForm({ ...form, startDate: ev.target.value })} error={e.startDate} />
        <TextField label="End date" type="date" value={form.endDate} onChange={(ev) => setForm({ ...form, endDate: ev.target.value })} error={e.endDate} />
      </div>
      {!isYear && <p className="text-xs text-subtle">Dates let StudyOS work out which semester is current.</p>}
    </FormModal>
  );
}

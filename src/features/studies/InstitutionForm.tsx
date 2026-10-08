import { useEffect, useState } from "react";
import { FormModal } from "@/components/ui/Modal";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useSaveMutation } from "@/hooks/queries";
import { INSTITUTION_KINDS, LABELS, type Institution, type InstitutionInput } from "@/domain/types";
import { createInstitution, updateInstitution } from "@/services/institutions";

interface Props {
  open: boolean;
  onClose: () => void;
  institution?: Institution;
  onSaved?: (i: Institution) => void;
}

const empty = (): InstitutionInput => ({ name: "", kind: "university", country: "", website: "", notes: "" });

export function InstitutionForm({ open, onClose, institution, onSaved }: Props) {
  const [form, setForm] = useState<InstitutionInput>(empty);
  const save = useSaveMutation(
    (input: InstitutionInput) => (institution ? updateInstitution(institution.id, input) : createInstitution(input)),
    (saved) => {
      onSaved?.(saved);
      onClose();
    },
  );

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(institution ? { ...institution } : empty());
  }, [open, institution]);

  const set = <K extends keyof InstitutionInput>(k: K, v: InstitutionInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const e = save.fieldErrors;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={institution ? "Edit institution" : "New institution"}
      submitLabel={institution ? "Save" : "Create institution"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={() => save.mutate(form)}
    >
      <TextField
        label="Name"
        required
        autoFocus
        placeholder="e.g. University of Cyprus"
        value={form.name}
        onChange={(ev) => set("name", ev.target.value)}
        error={e.name}
      />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Type"
          value={form.kind}
          onChange={(ev) => set("kind", ev.target.value as InstitutionInput["kind"])}
          options={INSTITUTION_KINDS.map((k) => ({ value: k, label: LABELS.institutionKind[k] }))}
          error={e.kind}
        />
        <TextField label="Country" value={form.country ?? ""} onChange={(ev) => set("country", ev.target.value)} />
      </div>
      <TextField
        label="Website"
        placeholder="https://"
        value={form.website ?? ""}
        onChange={(ev) => set("website", ev.target.value)}
        error={e.website}
      />
      <TextAreaField label="Notes" value={form.notes ?? ""} onChange={(ev) => set("notes", ev.target.value)} />
    </FormModal>
  );
}

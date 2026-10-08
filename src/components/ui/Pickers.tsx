import clsx from "clsx";
import { Check } from "lucide-react";
import type { GradingScale } from "@/domain/grading";
import { numberToInput, parseOptionalNumber, SelectField, TextField } from "./Field";

export const COLOR_SWATCHES = ["#7b8ff7", "#4cc790", "#f0717a", "#e0b05c", "#5bc0de", "#c084fc", "#f472b6", "#94a3b8"];

export function ColorPicker({ value, onChange, label = "Colour" }: { value: string | null; onChange: (c: string | null) => void; label?: string }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium text-muted">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={value === c}
            onClick={() => onChange(value === c ? null : c)}
            className={clsx("flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-surface", value === c && "ring-2 ring-fg")}
            style={{ background: c }}
          >
            {value === c && <Check className="size-3.5 text-black/70" aria-hidden />}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

interface GradeInputProps {
  label: string;
  scale: GradingScale;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
}

/** Text input for numeric scales, a letter dropdown for letter scales. Value is the raw input string. */
export function GradeInput({ label, scale, value, onChange, error, hint }: GradeInputProps) {
  if (scale.letters?.length) {
    const options = [
      { value: "", label: "Not set" },
      ...scale.letters.map((l) => ({ value: String(l.value), label: `${l.label} (${l.value.toFixed(scale.decimals)})` })),
    ];
    const n = parseOptionalNumber(value);
    const match = scale.letters.find((l) => n != null && Math.abs(l.value - n) < 1e-9);
    return (
      <SelectField
        label={label}
        error={error}
        hint={hint}
        options={options}
        value={match ? String(match.value) : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <TextField
      label={label}
      inputMode="decimal"
      placeholder={`${scale.min}–${scale.max}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      hint={hint}
    />
  );
}

export { numberToInput, parseOptionalNumber };

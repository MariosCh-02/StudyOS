import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import clsx from "clsx";

const CONTROL =
  "w-full rounded-md border bg-surface px-3 text-sm text-fg placeholder:text-subtle transition-colors focus:border-accent focus:outline-none disabled:opacity-60";

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

function FieldShell({ label, error, hint, required, className, children }: FieldShellProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-muted">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? (
        <p id={msgId} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label: string; error?: string; hint?: string; className?: string };

export function TextField({ label, error, hint, className, required, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy) => (
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={clsx(CONTROL, "h-9", error ? "border-danger" : "border-border")}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({ label, error, hint, className, required, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy) => (
        <textarea
          id={id}
          rows={3}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={clsx(CONTROL, "resize-y py-2", error ? "border-danger" : "border-border")}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  error,
  hint,
  className,
  required,
  options,
  ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement> & { options: Option[] }) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={clsx(CONTROL, "h-9 pr-8", error ? "border-danger" : "border-border")}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

/** Parses a numeric text input; empty → null, invalid → NaN (caught by validation). */
export const parseOptionalNumber = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")));
export const numberToInput = (v: number | null | undefined): string => (v == null ? "" : String(v));

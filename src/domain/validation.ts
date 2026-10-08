import { isDateKey } from "./dates";

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export class ValidationError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? "Invalid input.");
    this.name = "ValidationError";
  }
}

export function requireText(value: string, label: string, max = 200): string | undefined {
  const v = value.trim();
  if (!v) return `${label} is required.`;
  if (v.length > max) return `${label} must be at most ${max} characters.`;
  return undefined;
}

export function optionalDate(value: string | null, label: string): string | undefined {
  if (value == null || value === "") return undefined;
  return isDateKey(value) ? undefined : `${label} must be a valid date.`;
}

export function dateOrder(start: string | null, end: string | null): string | undefined {
  if (start && end && end < start) return "End date must be on or after the start date.";
  return undefined;
}

export function optionalNonNegative(value: number | null, label: string): string | undefined {
  if (value == null) return undefined;
  return Number.isFinite(value) && value >= 0 ? undefined : `${label} must be zero or more.`;
}

/** Throws a ValidationError when any entry is defined. */
export function assertValid(errors: Record<string, string | undefined>): void {
  const defined = Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as Record<string, string>;
  if (Object.keys(defined).length) throw new ValidationError(defined);
}

/** Normalises empty / whitespace strings to null. */
export const blankToNull = (v: string | null | undefined): string | null => (v == null || v.trim() === "" ? null : v.trim());

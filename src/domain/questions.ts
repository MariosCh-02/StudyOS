/**
 * Question types, their data shapes, validation and automatic grading.
 * Coding, debugging (without options) and "explain" answers are self-assessed
 * against a model answer: StudyOS never executes code.
 */

export const QUESTION_TYPES = ["mcq", "numeric", "short", "explain", "predict", "matching", "coding", "debugging"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  numeric: "Numerical",
  short: "Short answer",
  explain: "Explain in your own words",
  predict: "Predict the output",
  matching: "Matching",
  coding: "Coding",
  debugging: "Debugging",
};

export interface Choice {
  id: string;
  text: string; // (md)
  correct: boolean;
  /** Why picking this option is wrong (shown as feedback). */
  why?: string;
}

export type QuestionData =
  | { type: "mcq"; choices: Choice[]; multiple?: boolean }
  | { type: "numeric"; answer: number; tolerance?: number; relTolerance?: number; unit?: string }
  | { type: "short"; accepted: string[]; caseSensitive?: boolean }
  | { type: "explain"; modelAnswer: string; keyPoints: string[] }
  | { type: "predict"; code: string; language: string; output: string }
  | { type: "matching"; pairs: { left: string; right: string }[] }
  | { type: "coding"; language: string; starter?: string; solution: string; keyPoints?: string[] }
  | { type: "debugging"; language: string; code: string; choices?: Choice[]; modelAnswer?: string };

export type Response =
  | { type: "mcq"; selected: string[] }
  | { type: "numeric"; value: string }
  | { type: "short"; text: string }
  | { type: "explain"; text: string }
  | { type: "predict"; text: string }
  | { type: "matching"; matches: Record<number, number> } // left index → right index
  | { type: "coding"; code: string }
  | { type: "debugging"; selected?: string[]; text?: string };

export type GradeResult =
  | { status: "correct"; score: 1 }
  | { status: "partial"; score: number }
  | { status: "incorrect"; score: 0 }
  /** Needs the learner to compare with the model answer and self-assess. */
  | { status: "self" };

const normalise = (s: string, caseSensitive = false) => {
  const t = s.trim().replace(/\s+/g, " ").replace(/[.;]+$/, "");
  return caseSensitive ? t : t.toLowerCase();
};

/** Normalises program output for comparison: trims line ends and trailing blank lines. */
export const normaliseOutput = (s: string) =>
  s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n+$/, "")
    .replace(/^\n+/, "");

/**
 * Parses "1.5", "1,5" (decimal comma), "1,000" and "1,234.5" (thousands),
 * "3/4", "1 1/2", "-2e-3", "−5" (Unicode minus) and "45%" (as 45).
 */
export function parseNumber(input: string): number | null {
  let s = input.trim().replace(/[\u2212\u2012\u2013]/g, "-").replace(/%$/, "").trim();
  if (!s) return null;
  const mixed = /^(-?)(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) {
    const den = Number(mixed[4]);
    if (!den) return null;
    const v = Number(mixed[2]) + Number(mixed[3]) / den;
    return mixed[1] ? -v : v;
  }
  s = s.replace(/\s/g, "");
  if (/^[-+]?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(/^([-+]?\d+),(\d+)$/, "$1.$2");
  const frac = /^([-+]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  // Plain decimal or scientific notation only (no hex, binary or "Infinity").
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function gradeChoices(choices: Choice[], selected: string[]): GradeResult {
  const correct = new Set(choices.filter((c) => c.correct).map((c) => c.id));
  const picked = new Set(selected);
  if (picked.size === 0) return { status: "incorrect", score: 0 };
  const hits = [...picked].filter((id) => correct.has(id)).length;
  const wrong = picked.size - hits;
  if (hits === correct.size && wrong === 0) return { status: "correct", score: 1 };
  // Partial credit for multi-select: hits minus wrong picks, never negative.
  const score = Math.max(0, (hits - wrong) / correct.size);
  return score > 0 && correct.size > 1 ? { status: "partial", score } : { status: "incorrect", score: 0 };
}

export function grade(data: QuestionData, response: Response): GradeResult {
  switch (data.type) {
    case "mcq":
      return response.type === "mcq" ? gradeChoices(data.choices, response.selected) : { status: "incorrect", score: 0 };
    case "numeric": {
      if (response.type !== "numeric") return { status: "incorrect", score: 0 };
      const v = parseNumber(response.value);
      if (v == null) return { status: "incorrect", score: 0 };
      const abs = data.tolerance ?? 0;
      const rel = data.relTolerance ?? (abs ? 0 : 1e-6);
      const ok = Math.abs(v - data.answer) <= Math.max(abs, Math.abs(data.answer) * rel, 1e-12);
      return ok ? { status: "correct", score: 1 } : { status: "incorrect", score: 0 };
    }
    case "short": {
      if (response.type !== "short") return { status: "incorrect", score: 0 };
      const given = normalise(response.text, data.caseSensitive);
      return data.accepted.some((a) => normalise(a, data.caseSensitive) === given) ? { status: "correct", score: 1 } : { status: "incorrect", score: 0 };
    }
    case "predict":
      if (response.type !== "predict") return { status: "incorrect", score: 0 };
      return normaliseOutput(response.text) === normaliseOutput(data.output) ? { status: "correct", score: 1 } : { status: "incorrect", score: 0 };
    case "matching": {
      if (response.type !== "matching") return { status: "incorrect", score: 0 };
      const right = data.pairs.filter((_, i) => response.matches[i] === i).length;
      if (right === data.pairs.length) return { status: "correct", score: 1 };
      return right > 0 ? { status: "partial", score: right / data.pairs.length } : { status: "incorrect", score: 0 };
    }
    case "debugging":
      if (data.choices?.length && response.type === "debugging") return gradeChoices(data.choices, response.selected ?? []);
      return { status: "self" };
    case "explain":
    case "coding":
      return { status: "self" };
  }
}

/** The correct answer, formatted for feedback (Markdown). */
export function correctAnswerText(data: QuestionData): string {
  switch (data.type) {
    case "mcq":
      return data.choices.filter((c) => c.correct).map((c) => c.text).join("\n\n");
    case "numeric":
      return `${data.answer}${data.unit ? ` ${data.unit}` : ""}${data.tolerance ? ` (± ${data.tolerance})` : ""}`;
    case "short":
      return data.accepted[0] ?? "";
    case "explain":
      return data.modelAnswer + (data.keyPoints.length ? `\n\n**Key points**\n\n${data.keyPoints.map((p) => `- ${p}`).join("\n")}` : "");
    case "predict":
      return "```\n" + data.output + "\n```";
    case "matching":
      return data.pairs.map((p) => `- ${p.left} → ${p.right}`).join("\n");
    case "coding":
      return "```" + data.language + "\n" + data.solution + "\n```" + (data.keyPoints?.length ? `\n\n${data.keyPoints.map((p) => `- ${p}`).join("\n")}` : "");
    case "debugging":
      return data.choices?.length ? data.choices.filter((c) => c.correct).map((c) => c.text).join("\n\n") : (data.modelAnswer ?? "");
  }
}

/** Option-specific "why this is wrong" texts for the options the learner picked. */
export function whyWrongForResponse(data: QuestionData, response: Response): string[] {
  const choices = data.type === "mcq" ? data.choices : data.type === "debugging" ? (data.choices ?? []) : [];
  const selected = response.type === "mcq" ? response.selected : response.type === "debugging" ? (response.selected ?? []) : [];
  return choices.filter((c) => selected.includes(c.id) && !c.correct && c.why).map((c) => c.why!);
}

/** Problems that would make a question unanswerable; empty when valid. */
export function validateQuestionData(data: QuestionData): string[] {
  const errors: string[] = [];
  const checkChoices = (choices: Choice[]) => {
    if (choices.length < 2) errors.push("Add at least two options.");
    if (!choices.some((c) => c.correct)) errors.push("Mark at least one option as correct.");
    if (choices.some((c) => !c.text.trim())) errors.push("Options can't be empty.");
  };
  switch (data.type) {
    case "mcq":
      checkChoices(data.choices);
      if (!data.multiple && data.choices.filter((c) => c.correct).length > 1) errors.push("Single-answer questions need exactly one correct option (or allow multiple answers).");
      break;
    case "numeric":
      if (!Number.isFinite(data.answer)) errors.push("Enter the numerical answer.");
      if (data.tolerance != null && !(data.tolerance >= 0)) errors.push("Tolerance must be zero or more.");
      break;
    case "short":
      if (!data.accepted.some((a) => a.trim())) errors.push("Add at least one accepted answer.");
      break;
    case "explain":
      if (!data.modelAnswer.trim()) errors.push("Add a model answer.");
      break;
    case "predict":
      if (!data.code.trim()) errors.push("Add the code.");
      if (!data.output.trim()) errors.push("Add the expected output.");
      break;
    case "matching":
      if (data.pairs.length < 2) errors.push("Add at least two pairs.");
      if (data.pairs.some((p) => !p.left.trim() || !p.right.trim())) errors.push("Pairs can't have empty sides.");
      break;
    case "coding":
      if (!data.solution.trim()) errors.push("Add a reference solution.");
      break;
    case "debugging":
      if (!data.code.trim()) errors.push("Add the buggy code.");
      if (data.choices?.length) checkChoices(data.choices);
      else if (!data.modelAnswer?.trim()) errors.push("Add the fix (model answer) or options.");
      break;
  }
  return errors;
}

/** A fresh, empty data object for a question type (used by the editor). */
export function emptyData(type: QuestionType): QuestionData {
  switch (type) {
    case "mcq":
      return { type, choices: [{ id: "a", text: "", correct: true }, { id: "b", text: "", correct: false }] };
    case "numeric":
      return { type, answer: Number.NaN, tolerance: 0 };
    case "short":
      return { type, accepted: [""] };
    case "explain":
      return { type, modelAnswer: "", keyPoints: [] };
    case "predict":
      return { type, code: "", language: "python", output: "" };
    case "matching":
      return { type, pairs: [{ left: "", right: "" }, { left: "", right: "" }] };
    case "coding":
      return { type, language: "python", starter: "", solution: "" };
    case "debugging":
      return { type, language: "python", code: "", modelAnswer: "" };
  }
}

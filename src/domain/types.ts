import type { GradingScale } from "./grading";

export const INSTITUTION_KINDS = ["university", "college", "school", "online", "certification", "other"] as const;
export type InstitutionKind = (typeof INSTITUTION_KINDS)[number];

export const PROGRAMME_LEVELS = [
  "school",
  "diploma",
  "bachelor",
  "master",
  "doctorate",
  "certification",
  "course",
  "self_learning",
  "other",
] as const;
export type ProgrammeLevel = (typeof PROGRAMME_LEVELS)[number];

export const PROGRAMME_STATUSES = ["planned", "active", "completed", "paused", "withdrawn"] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];

export const COURSE_STATUSES = ["planned", "in_progress", "completed", "dropped"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const LABELS = {
  institutionKind: {
    university: "University",
    college: "College",
    school: "School",
    online: "Online provider",
    certification: "Certification body",
    other: "Other",
  } satisfies Record<InstitutionKind, string>,
  programmeLevel: {
    school: "School",
    diploma: "Diploma",
    bachelor: "Bachelor's",
    master: "Master's",
    doctorate: "Doctorate / PhD",
    certification: "Professional certification",
    course: "Short course",
    self_learning: "Self-learning",
    other: "Other",
  } satisfies Record<ProgrammeLevel, string>,
  programmeStatus: {
    planned: "Future",
    active: "Active",
    completed: "Completed",
    paused: "Paused",
    withdrawn: "Withdrawn",
  } satisfies Record<ProgrammeStatus, string>,
  courseStatus: {
    planned: "Planned",
    in_progress: "In progress",
    completed: "Completed",
    dropped: "Dropped",
  } satisfies Record<CourseStatus, string>,
};

interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface Institution extends Timestamps {
  id: string;
  name: string;
  kind: InstitutionKind;
  country: string | null;
  website: string | null;
  notes: string | null;
}

export interface Programme extends Timestamps {
  id: string;
  institutionId: string;
  name: string;
  level: ProgrammeLevel;
  status: ProgrammeStatus;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
  totalCredits: number | null;
  creditUnit: string;
  gradingScale: GradingScale;
  targetGrade: number | null;
  color: string | null;
  notes: string | null;
}

export interface AcademicYear extends Timestamps {
  id: string;
  programmeId: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
}

export interface Semester extends Timestamps {
  id: string;
  academicYearId: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
}

export interface Course extends Timestamps {
  id: string;
  programmeId: string;
  semesterId: string | null;
  name: string;
  code: string | null;
  credits: number | null;
  lecturer: string | null;
  lecturerEmail: string | null;
  location: string | null;
  status: CourseStatus;
  finalGrade: number | null;
  targetGrade: number | null;
  color: string | null;
  description: string | null;
}

/** Input types: everything except generated fields. */
export type InstitutionInput = Omit<Institution, "id" | keyof Timestamps>;
export type ProgrammeInput = Omit<Programme, "id" | keyof Timestamps>;
export type AcademicYearInput = Omit<AcademicYear, "id" | keyof Timestamps>;
export type SemesterInput = Omit<Semester, "id" | keyof Timestamps>;
export type CourseInput = Omit<Course, "id" | keyof Timestamps>;

// ------------------------------------------------------------- Phase 2

export const REVISION_STATUSES = ["not_reviewed", "needs_review", "reviewed", "mastered"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const REVISION_LABELS: Record<RevisionStatus, string> = {
  not_reviewed: "Not reviewed",
  needs_review: "Needs review",
  reviewed: "Reviewed",
  mastered: "Mastered",
};

export interface LectureLink {
  label: string;
  url: string;
}

export interface Lecture extends Timestamps {
  id: string;
  courseId: string;
  number: number | null;
  title: string;
  date: string | null;
  startTime: string | null;
  lecturer: string | null;
  links: LectureLink[];
  comments: string | null;
  revisionStatus: RevisionStatus;
}
export type LectureInput = Omit<Lecture, "id" | keyof Timestamps>;

/** Note without its (potentially large) body, for lists. */
export interface NoteSummary {
  id: string;
  courseId: string | null;
  lectureId: string | null;
  /** Set on research workspace and project notes. */
  projectId?: string | null;
  /** Set on reading notes for a paper. */
  paperId?: string | null;
  title: string;
  snippet: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Note extends NoteSummary {
  /** Editor document as JSON. */
  content: string;
  contentText: string;
}

export type AttachmentOwnerType = "course" | "lecture" | "note" | "assignment" | "exam" | "project" | "paper";

export interface Attachment extends Timestamps {
  id: string;
  ownerType: AttachmentOwnerType;
  ownerId: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  isSlides: boolean;
}

export interface NoteTemplate extends Timestamps {
  id: string;
  name: string;
  content: string;
}

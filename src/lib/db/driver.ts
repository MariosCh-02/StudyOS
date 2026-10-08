export type SqlValue = string | number | null;

export interface ExecResult {
  rowsAffected: number;
}

/**
 * Minimal database contract used by every service.
 * Queries use `$1, $2, ...` positional placeholders.
 */
export interface DbDriver {
  execute(sql: string, params?: SqlValue[]): Promise<ExecResult>;
  select<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

export class DatabaseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DatabaseError";
  }
}

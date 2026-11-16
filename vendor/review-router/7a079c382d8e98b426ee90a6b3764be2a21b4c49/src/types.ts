// Type-only shim for the two pinned ReviewRouter modules.
//
// The pinned files import `Finding` and `Severity` from `../../types` with
// `import type`, so this module is erased at runtime. It exists only so the
// declaration build can resolve the type-only imports without editing the
// pinned source bytes.

export type Severity = "critical" | "major" | "minor";

export interface Finding {
  file: string;
  line: number;
  startLine?: number;
  endLine?: number;
  severity: Severity;
  title: string;
  message: string;
  category: string;
  suggestion?: string;
}

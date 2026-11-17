/** Per-reply snapshot; no text, credentials, or inferred model usage. */
export type ReplyMemoryMode = "off" | "shadow" | "active";
export type ReplyMemorySkipReason =
  | "module_off"
  | "scope_missed"
  | "service_unavailable"
  | "path_not_run"
  | "gate_suppressed"
  | "no_package_match"
  | "recall_failed"
  | "package_not_selected"
  | "context_not_injected";
export interface ReplyMemoryPackageDetail {
  source: "primary" | "shadow";
  engine: string;
  groupId: string;
  members?: number;
  retained?: number;
  heat?: number;
  score?: number;
  stage: "recalled" | "selected" | "injected";
  reason?:
    | "capacity_trimmed"
    | "not_selected"
    | "shadow_only"
    | "context_filtered";
}
export interface ReplyMemoryObservation {
  replyMemoryModuleConfiguredMode?: ReplyMemoryMode;
  replyMemoryModuleMode?: ReplyMemoryMode;
  /** shadow + effective off + false means the user is outside configured scope. */
  replyMemoryScopeMatched?: boolean;
  replyMemoryShadowStatus?: "ok" | "empty" | "skipped" | "failed";
  replyMemoryExecutionStatus: "not_run" | "succeeded" | "empty" | "failed";
  replyMemorySkipReason?: ReplyMemorySkipReason;
  replyMemoryPackageInjected: boolean;
  replyMemoryLegacyFallback: boolean;
  replyMemoryPackageDetails: ReplyMemoryPackageDetail[];
  replyMemoryPackageDetailsTruncated: boolean;
}

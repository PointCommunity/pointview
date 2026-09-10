import type { FeedbackDetail } from "./service";

export function presentFeedback(record: FeedbackDetail) {
  return {
    id: record.id,
    source_app: record.sourceApp,
    context: record.screen || record.route,
    environment: record.environment,
    route: record.route,
    app_version: record.appVersion,
    source_revision: record.sourceRevision,
    state: record.state,
    submitted_at: record.submittedAt.toISOString(),
    raw_delete_after: record.rawDeleteAfter?.toISOString() ?? null,
    feedback: record.feedback,
    attachments: record.attachments.map((attachment) => ({
      id: attachment.id,
      media_type: attachment.mediaType,
      size_bytes: attachment.sizeBytes,
      width: attachment.width,
      height: attachment.height,
    })),
    units: record.units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      state: unit.state,
      disposition: unit.disposition,
      github_url: unit.githubUrl,
    })),
    operator_detail: record.operatorDetail ? {
      decisions: record.operatorDetail.decisions,
      evidence: record.operatorDetail.evidence.map((item) => ({ ...item, capturedAt: item.capturedAt.toISOString() })),
      operations: record.operatorDetail.operations.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })),
      model_runs: record.operatorDetail.modelRuns.map((item) => ({ ...item, finishedAt: item.finishedAt?.toISOString() ?? null })),
      annotations: record.operatorDetail.annotations.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    } : null,
  };
}

export function presentFeedbackSummary(record: FeedbackDetail) {
  const detail = presentFeedback(record);
  return {
    id: detail.id,
    source_app: detail.source_app,
    context: detail.context,
    state: detail.state,
    submitted_at: detail.submitted_at,
    raw_delete_after: detail.raw_delete_after,
  };
}

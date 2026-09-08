import { createHash } from "node:crypto";

import type postgres from "postgres";
import { z } from "zod";

import type { Role, AccountStatus } from "@/server/auth/types";
import { canReadFeedback } from "@/server/auth/policy";
import { appendAuditEventInTransaction } from "@/server/audit/repository";
import { newId } from "@/server/db/ids";
import { normalizeScreenshot, validateAttachmentCount } from "@/server/feedback/images";
import type { AttachmentScanner } from "@/server/feedback/scanner";

type StagedObject = { key: string; commit(): Promise<void>; abort(): Promise<void> };
export type AttachmentStore = {
  stage(bytes: Buffer): Promise<StagedObject>;
  delete(key: string): Promise<void>;
};

export type RequestAccount = { accountId: string; role: Role; status: AccountStatus };

export class FeedbackError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "FeedbackError";
  }
}

type LaunchContextRow = {
  launchSessionId: string;
  sourceAppId: string;
  sourceApp: string;
  environment: string;
  route: string;
  screen: string;
  appVersion: string;
  sourceRevision: string;
  returnUrl: string;
};

export type FeedbackDetail = {
  id: string;
  state: string;
  submittedAt: Date;
  sourceApp: string;
  environment: string;
  route: string;
  screen: string;
  appVersion: string;
  sourceRevision: string;
  feedback: string | null;
  attachmentCount: number;
  rawDeleteAfter: Date | null;
  attachments: Array<{ id: string; mediaType: string; sizeBytes: number; width: number; height: number }>;
  units: Array<{ id: string; title: string; state: string; disposition: string | null; githubUrl: string | null }>;
};

function normalizeFeedbackText(value: string): string {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  const characters = [...normalized].length;
  if (characters < 1 || characters > 20_000) {
    throw new FeedbackError("FEEDBACK_INVALID", "Feedback must contain between 1 and 20,000 characters", 400);
  }
  if (/\u0000/.test(normalized)) throw new FeedbackError("FEEDBACK_INVALID", "Feedback contains an unsupported character", 400);
  return normalized;
}

function validId(value: string, kind: string): string {
  if (!z.uuid().safeParse(value).success) throw new FeedbackError("IDENTIFIER_INVALID", `${kind} identifier is invalid`, 400);
  return value;
}

export async function getLaunchContext(
  sql: postgres.Sql,
  input: { accountId: string; launchSessionId: string },
): Promise<LaunchContextRow> {
  const [launch] = await sql<LaunchContextRow[]>`
    select ls.id as "launchSessionId", ls.source_app_id as "sourceAppId", sa.display_name as "sourceApp",
      ls.environment, ls.route, ls.screen, ls.app_version as "appVersion", ls.source_revision as "sourceRevision",
      ls.return_url as "returnUrl"
    from launch_sessions ls
    join source_apps sa on sa.id = ls.source_app_id
    where ls.id = ${input.launchSessionId} and ls.account_id = ${input.accountId}
      and ls.consumed_at is null and ls.expires_at > now() and sa.enabled and sa.paused_at is null
  `;
  if (!launch) throw new FeedbackError("LAUNCH_UNAVAILABLE", "The verified launch is missing, expired, or already used", 409);
  return launch;
}

export async function createFeedback(
  sql: postgres.Sql,
  input: {
    accountId: string;
    launchSessionId: string;
    feedback: string;
    privacyAcknowledged: boolean;
    screenshots: Array<{ bytes: Buffer; name: string; mimeType: string }>;
    policyVersion: string;
    store: AttachmentStore;
    scanner: AttachmentScanner;
    correlationId?: string;
  },
): Promise<FeedbackDetail> {
  if (!input.privacyAcknowledged) {
    throw new FeedbackError("PRIVACY_ACKNOWLEDGEMENT_REQUIRED", "The privacy notice must be acknowledged", 400);
  }
  const feedback = normalizeFeedbackText(input.feedback);
  try {
    validateAttachmentCount(input.screenshots.length);
  } catch (error) {
    throw new FeedbackError("ATTACHMENT_COUNT_INVALID", error instanceof Error ? error.message : "Screenshot count is invalid", 400);
  }

  const prepared: Array<{
    staged: StagedObject;
    displayName: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    sha256: string;
    scanStatus: "CLEAN" | "UNAVAILABLE";
    id: string;
  }> = [];
  try {
    for (const screenshot of input.screenshots) {
      const normalized = await normalizeScreenshot({
        bytes: screenshot.bytes,
        originalName: screenshot.name,
        claimedMime: screenshot.mimeType,
      }).catch((error: unknown) => {
        throw new FeedbackError("ATTACHMENT_INVALID", error instanceof Error ? error.message : "Screenshot is invalid", 415);
      });
      const scan = await input.scanner.scan(normalized.bytes, normalized.mimeType);
      if (scan.status === "REJECTED") throw new FeedbackError("ATTACHMENT_REJECTED", "A screenshot did not pass security checks", 415);
      const staged = await input.store.stage(normalized.bytes);
      prepared.push({ ...normalized, staged, scanStatus: scan.status, id: newId() });
    }

    const feedbackId = newId();
    const correlationId = input.correlationId ?? newId();
    let result: FeedbackDetail | undefined;
    await sql.begin(async (tx) => {
      const [launch] = await tx<LaunchContextRow[]>`
        select ls.id as "launchSessionId", ls.source_app_id as "sourceAppId", sa.display_name as "sourceApp",
          ls.environment, ls.route, ls.screen, ls.app_version as "appVersion", ls.source_revision as "sourceRevision",
          ls.return_url as "returnUrl"
        from launch_sessions ls
        join source_apps sa on sa.id = ls.source_app_id
        where ls.id = ${input.launchSessionId} and ls.account_id = ${input.accountId}
          and ls.consumed_at is null and ls.expires_at > now() and sa.enabled and sa.paused_at is null
        for update of ls
      `;
      if (!launch) {
        const [status] = await tx<{ consumedAt: Date | null }[]>`
          select consumed_at as "consumedAt" from launch_sessions
          where id = ${input.launchSessionId} and account_id = ${input.accountId}
        `;
        if (status?.consumedAt) {
          throw new FeedbackError("LAUNCH_ALREADY_CONSUMED", "The verified launch has already been used", 409);
        }
        throw new FeedbackError("LAUNCH_UNAVAILABLE", "The verified launch is missing or expired", 409);
      }
      const [record] = await tx<{ submittedAt: Date }[]>`
        insert into feedback_records (
          id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen,
          app_version, source_revision, correlation_id
        ) values (
          ${feedbackId}, ${input.accountId}, ${launch.sourceAppId}, ${launch.launchSessionId}, ${launch.environment},
          ${launch.route}, ${launch.screen}, ${launch.appVersion}, ${launch.sourceRevision}, ${correlationId}
        ) returning submitted_at as "submittedAt"
      `;
      await tx`
        insert into feedback_payloads (feedback_record_id, feedback_text, policy_version, content_digest)
        values (${feedbackId}, ${feedback}, ${input.policyVersion}, ${createHash("sha256").update(feedback).digest("hex")})
      `;
      for (const [index, attachment] of prepared.entries()) {
        await tx`
          insert into attachments (
            id, feedback_record_id, ordinal, display_name, mime_type, byte_size, width, height,
            sha256, storage_key, decode_status, scan_status
          ) values (
            ${attachment.id}, ${feedbackId}, ${index + 1}, ${attachment.displayName}, ${attachment.mimeType},
            ${attachment.byteSize}, ${attachment.width}, ${attachment.height}, ${Buffer.from(attachment.sha256, "hex")},
            ${attachment.staged.key}, 'VALIDATED', ${attachment.scanStatus}
          )
        `;
      }
      for (const attachment of prepared) await attachment.staged.commit();
      await tx`update launch_sessions set consumed_at = now() where id = ${launch.launchSessionId}`;
      await appendAuditEventInTransaction(tx, {
        id: newId(),
        eventAt: new Date().toISOString(),
        actorType: "ACCOUNT",
        actorId: input.accountId,
        action: "feedback.submitted",
        targetType: "feedback",
        targetId: feedbackId,
        result: "SUCCESS",
        correlationId,
        safeMetadata: { attachmentCount: prepared.length, sourceApp: launch.sourceApp },
      });
      result = {
        id: feedbackId,
        state: "QUEUED",
        submittedAt: record.submittedAt,
        sourceApp: launch.sourceApp,
        environment: launch.environment,
        route: launch.route,
        screen: launch.screen,
        appVersion: launch.appVersion,
        sourceRevision: launch.sourceRevision,
        feedback,
        attachmentCount: prepared.length,
        rawDeleteAfter: null,
        attachments: prepared.map((attachment) => ({
          id: attachment.id,
          mediaType: attachment.mimeType,
          sizeBytes: attachment.byteSize,
          width: attachment.width,
          height: attachment.height,
        })),
        units: [],
      };
    });
    if (!result) throw new Error("Feedback transaction returned no result");
    return result;
  } catch (error) {
    await Promise.allSettled(prepared.flatMap((attachment) => [
      attachment.staged.abort(),
      input.store.delete(attachment.staged.key),
    ]));
    throw error;
  }
}

async function queryFeedback(
  sql: postgres.Sql,
  account: RequestAccount,
  feedbackId: string,
): Promise<FeedbackDetail & { submitterAccountId: string }> {
  validId(feedbackId, "Feedback");
  const [record] = await sql<(FeedbackDetail & { submitterAccountId: string })[]>`
    select fr.id, fr.submitter_account_id as "submitterAccountId", fr.state, fr.submitted_at as "submittedAt",
      sa.display_name as "sourceApp", fr.environment, fr.route, fr.screen, fr.app_version as "appVersion",
      fr.source_revision as "sourceRevision", fp.feedback_text as feedback,
      count(a.id)::int as "attachmentCount", fr.raw_delete_after as "rawDeleteAfter",
      '[]'::jsonb as attachments, '[]'::jsonb as units
    from feedback_records fr
    join source_apps sa on sa.id = fr.source_app_id
    left join feedback_payloads fp on fp.feedback_record_id = fr.id
    left join attachments a on a.feedback_record_id = fr.id and a.deleted_at is null
    where fr.id = ${feedbackId}
    group by fr.id, sa.display_name, fp.feedback_text
  `;
  if (!record || !canReadFeedback(account, record.submitterAccountId)) {
    throw new FeedbackError("FEEDBACK_NOT_FOUND", "Feedback was not found", 404);
  }
  return record;
}

export async function getFeedback(sql: postgres.Sql, input: RequestAccount & { feedbackId: string }): Promise<FeedbackDetail> {
  const record = await queryFeedback(sql, input, input.feedbackId);
  const attachments = await sql<FeedbackDetail["attachments"]>`
    select id, mime_type as "mediaType", byte_size as "sizeBytes", width, height
    from attachments where feedback_record_id = ${input.feedbackId} and deleted_at is null order by ordinal
  `;
  const units = await sql<FeedbackDetail["units"]>`
    select fu.id, fu.title, fu.state, td.disposition,
      case when go.github_issue_number is not null
        then 'https://github.com/' || sa.github_owner || '/' || sa.github_repo || '/issues/' || go.github_issue_number::text
        else null end as "githubUrl"
    from feedback_units fu
    join feedback_records fr on fr.id = fu.feedback_record_id
    join source_apps sa on sa.id = fr.source_app_id
    left join triage_decisions td on td.unit_id = fu.id and td.active
    left join lateral (
      select github_issue_number from github_operations
      where decision_id = td.id and github_issue_number is not null
      order by created_at desc limit 1
    ) go on true
    where fu.feedback_record_id = ${input.feedbackId}
    order by fu.ordinal
  `;
  return {
    id: record.id,
    state: record.state,
    submittedAt: record.submittedAt,
    sourceApp: record.sourceApp,
    environment: record.environment,
    route: record.route,
    screen: record.screen,
    appVersion: record.appVersion,
    sourceRevision: record.sourceRevision,
    feedback: record.feedback,
    attachmentCount: attachments.length,
    rawDeleteAfter: record.rawDeleteAfter,
    attachments,
    units,
  };
}

export async function authorizeAttachment(
  sql: postgres.Sql,
  input: RequestAccount & { feedbackId: string; attachmentId: string },
): Promise<{ storageKey: string; mimeType: string; displayName: string }> {
  validId(input.attachmentId, "Screenshot");
  await queryFeedback(sql, input, input.feedbackId);
  const [attachment] = await sql<{ storageKey: string; mimeType: string; displayName: string }[]>`
    update attachments
    set last_authorized_access_at = now()
    where id = ${input.attachmentId} and feedback_record_id = ${input.feedbackId} and deleted_at is null
    returning storage_key as "storageKey", mime_type as "mimeType", display_name as "displayName"
  `;
  if (!attachment) throw new FeedbackError("ATTACHMENT_NOT_FOUND", "Screenshot was not found", 404);
  return attachment;
}

export async function listFeedback(
  sql: postgres.Sql,
  input: RequestAccount & { limit: number; cursor?: string | null },
): Promise<{ items: FeedbackDetail[]; nextCursor: string | null }> {
  if (input.status !== "ACTIVE") throw new FeedbackError("ACCESS_DENIED", "Access denied", 403);
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit)));
  const cursor = input.cursor ? validId(input.cursor, "Cursor") : null;
  const operator = input.role === "ADMIN" || input.role === "OWNER";
  const rows = await sql<(FeedbackDetail & { submitterAccountId: string })[]>`
    select fr.id, fr.submitter_account_id as "submitterAccountId", fr.state, fr.submitted_at as "submittedAt",
      sa.display_name as "sourceApp", fr.environment, fr.route, fr.screen, fr.app_version as "appVersion",
      fr.source_revision as "sourceRevision", null::text as feedback, count(a.id)::int as "attachmentCount"
      , fr.raw_delete_after as "rawDeleteAfter", '[]'::jsonb as attachments, '[]'::jsonb as units
    from feedback_records fr
    join source_apps sa on sa.id = fr.source_app_id
    left join attachments a on a.feedback_record_id = fr.id and a.deleted_at is null
    where (${operator} or fr.submitter_account_id = ${input.accountId})
      and (${cursor}::uuid is null or fr.sequence < coalesce((select sequence from feedback_records where id = ${cursor}), 0))
    group by fr.id, sa.display_name
    order by fr.sequence desc
    limit ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    state: row.state,
    submittedAt: row.submittedAt,
    sourceApp: row.sourceApp,
    environment: row.environment,
    route: row.route,
    screen: row.screen,
    appVersion: row.appVersion,
    sourceRevision: row.sourceRevision,
    feedback: row.feedback,
    attachmentCount: row.attachmentCount,
    rawDeleteAfter: row.rawDeleteAfter,
    attachments: [],
    units: [],
  }));
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

export async function withdrawFeedback(
  sql: postgres.Sql,
  input: RequestAccount & {
    feedbackId: string;
    correlationId: string;
    store: Pick<AttachmentStore, "delete"> & { exists?(key: string): Promise<boolean> };
  },
): Promise<void> {
  if (input.status !== "ACTIVE") throw new FeedbackError("ACCESS_DENIED", "Access denied", 403);
  validId(input.feedbackId, "Feedback");
  await sql.begin(async (tx) => {
    const [record] = await tx<{ submitterAccountId: string; state: string }[]>`
      select submitter_account_id as "submitterAccountId", state
      from feedback_records where id = ${input.feedbackId} for update
    `;
    if (!record || record.submitterAccountId !== input.accountId) {
      throw new FeedbackError("FEEDBACK_NOT_FOUND", "Feedback was not found", 404);
    }
    if (record.state === "WITHDRAWN") return;
    if (record.state !== "QUEUED") {
      throw new FeedbackError("FEEDBACK_NOT_WITHDRAWABLE", "Only queued feedback can be withdrawn", 409);
    }
    const [lease] = await tx<{ id: string }[]>`
      select id from feedback_leases where feedback_record_id = ${input.feedbackId} and released_at is null
    `;
    if (lease) throw new FeedbackError("FEEDBACK_LEASED", "Feedback is currently being triaged", 409);
    const attachments = await tx<{ storageKey: string }[]>`
      select storage_key as "storageKey" from attachments
      where feedback_record_id = ${input.feedbackId} and deleted_at is null for update
    `;
    for (const attachment of attachments) {
      await input.store.delete(attachment.storageKey);
      if (input.store.exists && await input.store.exists(attachment.storageKey)) {
        throw new Error("Attachment deletion could not be verified");
      }
    }
    await tx`delete from feedback_payloads where feedback_record_id = ${input.feedbackId}`;
    await tx`update attachments set deleted_at = now() where feedback_record_id = ${input.feedbackId} and deleted_at is null`;
    await tx`
      update feedback_records
      set state = 'WITHDRAWN', withdrawn_at = now(), raw_deleted_at = now()
      where id = ${input.feedbackId}
    `;
    await appendAuditEventInTransaction(tx, {
      id: newId(),
      eventAt: new Date().toISOString(),
      actorType: "ACCOUNT",
      actorId: input.accountId,
      action: "feedback.withdrawn",
      targetType: "feedback",
      targetId: input.feedbackId,
      result: "SUCCESS",
      correlationId: input.correlationId,
      safeMetadata: { attachmentCount: attachments.length },
    });
  });
}

import os from "node:os";
import { randomUUID } from "node:crypto";

import { cliConfig, cliSql } from "@/cli/runtime";
import { readRuntimeProfile } from "@/server/config/settings";
import { GitHubAppClient } from "@/server/github/client";
import { GitHubMutationAdapter } from "@/server/github/mutation-port";
import { GitHubOutcomeApplier } from "@/server/github/outcome-applier";
import { RuntimeResearchProvider } from "@/server/research/runtime";
import { FileAttachmentStore } from "@/server/storage/file-store";
import { drainQueue } from "@/server/triage/batch";
import { providerName } from "@/server/providers/credentials";
import { loadProviderCredential, refreshProviderCredential } from "@/server/providers/repository";
import { SdkCodexRuntime } from "@/server/providers/codex/runtime";
import { CodexDecisionModel } from "@/server/triage/model/codex";
import { OllamaDecisionModel } from "@/server/triage/model/ollama";
import { DecisionOrchestrator } from "@/server/triage/orchestrator";
import { PostgresDrainQueue } from "@/server/triage/postgres-queue";
import { processRecord } from "@/server/triage/process-record";

async function main() {
  const config = cliConfig();
  if (!config.triageWritesEnabled) {
    process.stdout.write(`${JSON.stringify({ event: "triage.disabled", code: "TRIAGE_WRITES_DISABLED" })}\n`);
    return;
  }

  const sql = cliSql(config.databaseUrl);
  try {
  const profile = await readRuntimeProfile(sql);
  const provider = providerName.parse(profile.provider);
  const numberLimit = (name: string, fallback: number) => {
    const value = profile.retrievalLimits[name];
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  const credential = await loadProviderCredential(sql, provider, config.credentialEncryptionKey);
  const model = provider === "OLLAMA_CLOUD"
    ? new OllamaDecisionModel(fetch, {
      apiKey: credential, model: profile.modelIdentifier, timeoutMs: profile.timeoutMs,
      maxOutputTokens: profile.maxOutputTokens, reasoningEffort: profile.reasoningEffort,
      schema: profile.schemaDefinition, supportsImages: profile.supportsImages,
    })
    : new CodexDecisionModel(new SdkCodexRuntime(), {
      credential, model: profile.modelIdentifier, reasoningEffort: profile.reasoningEffort,
      timeoutMs: profile.timeoutMs, schema: profile.schemaDefinition, supportsImages: profile.supportsImages,
      onCredentialRefreshed: (nextCredential) => refreshProviderCredential(sql, {
        provider, credential: nextCredential, encryptionKey: config.credentialEncryptionKey, correlationId: randomUUID(),
      }),
    });
  const research = new RuntimeResearchProvider(sql, {
    appId: config.github.appId,
    privateKeyPem: config.github.privateKey,
    limits: {
      maxRankedIssues: numberLimit("maxRankedIssues", 10),
      maxFactCharacters: numberLimit("maxFactCharacters", 12_000),
      maxPacketBytes: numberLimit("maxEvidenceBytes", 131_072),
      maxRepositoryFiles: numberLimit("maxRepositoryFiles", 20),
    },
    attachmentStore: new FileAttachmentStore(config.attachmentRoot),
  });
  const outcomes = new GitHubOutcomeApplier(sql, {
    pointViewBaseUrl: config.baseUrl.href,
    portFor: (target) => new GitHubMutationAdapter(new GitHubAppClient({
      appId: config.github.appId,
      installationId: target.installationId,
      privateKeyPem: config.github.privateKey,
      allowedRepositories: new Set([`${target.owner}/${target.repo}`]),
    }), target.owner, target.repo, target.projectNodeId, target.projectNumber),
  });
  const orchestrator = new DecisionOrchestrator(model, model);
  const queue = new PostgresDrainQueue(sql, `${os.hostname()}:${process.pid}`, profile.settingsVersion);
  const result = await drainQueue(queue, (lease) => processRecord(sql, lease.recordId, {
    orchestrator,
    research,
    outcomes,
    modelProfile: {
      provider: profile.provider,
      modelIdentifier: profile.modelIdentifier,
      profileVersion: profile.profileVersion,
      promptVersion: profile.promptVersion,
      schemaVersion: profile.schemaVersion,
    },
    systemPolicy: profile.promptText,
  }));
  process.stdout.write(`${JSON.stringify({ event: "triage.completed", ...result })}\n`);
  if (!["QUEUE_EMPTY", "ALREADY_RUNNING", "OWNER_PAUSED"].includes(result.stopReason)) process.exitCode = 1;
  } catch {
    process.stderr.write(`${JSON.stringify({ event: "triage.failed", code: "TRIAGE_JOB_FAILED" })}\n`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();

"use client";

import { useState } from "react";

import type { SettingsRecord } from "@/server/config/settings";

export function SettingsAdmin({ initial, csrfToken }: { initial: SettingsRecord; csrfToken: string }) {
  const [settings, setSettings] = useState(initial);
  const [paused, setPaused] = useState(initial.triagePaused);
  const [message, setMessage] = useState("");

  async function submit(form: FormData) {
    setMessage("Saving versioned settings…");
    let retrievalLimits: unknown;
    try { retrievalLimits = JSON.parse(String(form.get("retrievalLimits"))); } catch { setMessage("Retrieval limits must be valid JSON."); return; }
    const body = {
      triagePaused: paused,
      triagePauseReason: paused ? String(form.get("triagePauseReason") || "") : null,
      rawRetentionDays: Number(form.get("rawRetentionDays")),
      riskReviewPolicyVersion: String(form.get("riskReviewPolicyVersion")),
      retrievalLimits,
      promptVersion: String(form.get("promptVersion")),
      promptText: String(form.get("promptText")),
      schemaVersion: String(form.get("schemaVersion")),
      schemaText: String(form.get("schemaText")),
      model: {
        provider: String(form.get("provider")), modelIdentifier: String(form.get("modelIdentifier")),
        reasoningEffort: String(form.get("reasoningEffort")), maxInputTokens: Number(form.get("maxInputTokens")),
        maxOutputTokens: Number(form.get("maxOutputTokens")), timeoutMs: Number(form.get("timeoutMs")),
        secretReference: String(form.get("secretReference")),
      },
    };
    const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "if-match": `"${settings.version}"` }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.title ?? "Settings update failed."); return; }
    setSettings(result);
    setMessage(`Settings version ${result.version} is active.`);
  }

  const model = settings.model;
  return <form className="settings-form" action={(form) => void submit(form)}>
    <p className="form-status" role="status" aria-live="polite">{message || `Current version ${settings.version}. Schedule is deployment-controlled: ${settings.observedSchedule}.`}</p>
    <fieldset><legend>Triage controls</legend>
      <label className="privacy-check"><input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} /> Pause new triage leases</label>
      <label>Pause reason<input name="triagePauseReason" disabled={!paused} defaultValue={settings.triagePauseReason ?? ""} /></label>
      <label>Raw retention days<input name="rawRetentionDays" type="number" min="180" max="3650" defaultValue={settings.rawRetentionDays} required /></label>
      <label>Risk policy version<input name="riskReviewPolicyVersion" defaultValue={settings.riskReviewPolicyVersion} required /></label>
      <label>Retrieval limits JSON<textarea name="retrievalLimits" defaultValue={JSON.stringify(settings.retrievalLimits, null, 2)} required /></label>
    </fieldset>
    <fieldset><legend>Model profile</legend>
      <label>Provider<input name="provider" defaultValue={model?.provider ?? "OPENAI"} required /></label>
      <label>Model identifier<input name="modelIdentifier" defaultValue={model?.modelIdentifier ?? ""} required /></label>
      <label>Reasoning effort<select name="reasoningEffort" defaultValue={model?.reasoningEffort ?? "medium"}><option>none</option><option>minimal</option><option>low</option><option>medium</option><option>high</option><option>xhigh</option></select></label>
      <label>Maximum input tokens<input name="maxInputTokens" type="number" defaultValue={model?.maxInputTokens ?? 100000} required /></label>
      <label>Maximum output tokens<input name="maxOutputTokens" type="number" defaultValue={model?.maxOutputTokens ?? 8000} required /></label>
      <label>Timeout milliseconds<input name="timeoutMs" type="number" defaultValue={model?.timeoutMs ?? 120000} required /></label>
      <label>External secret reference<input name="secretReference" defaultValue={model?.secretReference ?? "op://pointview/openai/api-key"} required /><small>Reference only. PointView never stores or displays the secret value.</small></label>
    </fieldset>
    <fieldset><legend>Prompt and schema versions</legend>
      <label>Prompt version<input name="promptVersion" defaultValue={settings.promptVersion} required /></label>
      <label>Prompt text<textarea name="promptText" required /></label>
      <label>Schema version<input name="schemaVersion" defaultValue={settings.schemaVersion} required /></label>
      <label>Schema text<textarea name="schemaText" required /></label>
    </fieldset>
    <button className="primary-button">Create new settings version</button>
  </form>;
}

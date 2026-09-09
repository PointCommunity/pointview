"use client";

import { useEffect, useMemo, useState } from "react";

import type { SettingsRecord } from "@/server/config/settings";
import type { ProviderConnectionSummary } from "@/server/providers/types";

type DeviceAuthorization = { sessionId: string; verificationUrl: string; userCode: string; expiresAt: string };
type Notice = { tone: "neutral" | "error" | "success"; text: string };

const providerLabels = { OLLAMA_CLOUD: "Ollama Cloud", OPENAI_CODEX: "ChatGPT / Codex" } as const;

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { title?: string } | null;
  return body?.title ?? fallback;
}

export function SettingsAdmin({ initial, initialConnections, csrfToken }: {
  initial: SettingsRecord;
  initialConnections: ProviderConnectionSummary[];
  csrfToken: string;
}) {
  const [settings, setSettings] = useState(initial);
  const [connections, setConnections] = useState(initialConnections);
  const [paused, setPaused] = useState(initial.triagePaused);
  const [notice, setNotice] = useState<Notice>({ tone: "neutral", text: "" });
  const [ollamaKey, setOllamaKey] = useState("");
  const [device, setDevice] = useState<DeviceAuthorization | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const connectedModels = useMemo(() => connections.flatMap((connection) => connection.status === "CONNECTED"
    ? connection.models.map((model) => ({ ...model, provider: connection.provider })) : []), [connections]);
  const initialModelValue = settings.model ? `${settings.model.provider}::${settings.model.modelIdentifier}` : connectedModels[0] ? `${connectedModels[0].provider}::${connectedModels[0].id}` : "";
  const [modelValue, setModelValue] = useState(initialModelValue);
  const selectedModel = connectedModels.find((model) => `${model.provider}::${model.id}` === modelValue);
  const [reasoningEffort, setReasoningEffort] = useState(settings.model?.reasoningEffort ?? "");
  const effectiveReasoningEffort = selectedModel?.reasoningEfforts.includes(reasoningEffort as never)
    ? reasoningEffort : selectedModel?.defaultReasoningEffort ?? selectedModel?.reasoningEfforts[0] ?? "";

  function replaceConnection(next: ProviderConnectionSummary) {
    setConnections((current) => current.map((connection) => connection.provider === next.provider ? next : connection));
  }

  useEffect(() => {
    if (!device) return;
    let stopped = false;
    const poll = async () => {
      const response = await fetch("/api/admin/providers/codex/status", {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ sessionId: device.sessionId }),
      });
      if (stopped) return;
      if (!response.ok) {
        setNotice({ tone: "error", text: await responseMessage(response, "Could not finish ChatGPT sign-in.") });
        setDevice(null); return;
      }
      const result = await response.json() as { state: string; connection?: ProviderConnectionSummary };
      if (result.state === "CONNECTED" && result.connection) {
        replaceConnection(result.connection); setDevice(null);
        setNotice({ tone: "success", text: "ChatGPT / Codex is connected. Choose a model below." }); return;
      }
      if (result.state === "FAILED" || result.state === "EXPIRED") {
        setDevice(null); setNotice({ tone: "error", text: result.state === "EXPIRED" ? "The sign-in code expired. Start again." : "ChatGPT sign-in was not completed." }); return;
      }
      window.setTimeout(() => void poll(), 2000);
    };
    const timer = window.setTimeout(() => void poll(), 1500);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [device, csrfToken]);

  async function connectOllama() {
    const current = connections.find((connection) => connection.provider === "OLLAMA_CLOUD");
    setBusy("ollama"); setNotice({ tone: "neutral", text: "Checking your Ollama Cloud account…" });
    try {
      const response = await fetch("/api/admin/providers/ollama", {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ apiKey: ollamaKey, expectedVersion: current?.version ?? 0 }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Ollama Cloud could not be connected."));
      replaceConnection(await response.json() as ProviderConnectionSummary);
      setOllamaKey(""); setNotice({ tone: "success", text: "Ollama Cloud is connected. Choose a model below." });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "Ollama Cloud could not be connected." }); }
    finally { setBusy(null); }
  }

  async function connectCodex() {
    const current = connections.find((connection) => connection.provider === "OPENAI_CODEX");
    setBusy("codex"); setNotice({ tone: "neutral", text: "Preparing secure ChatGPT sign-in…" });
    try {
      const response = await fetch("/api/admin/providers/codex/device", {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ expectedVersion: current?.version ?? 0 }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "ChatGPT sign-in could not start."));
      setDevice(await response.json() as DeviceAuthorization);
      setNotice({ tone: "neutral", text: "Open ChatGPT sign-in and enter the code shown below." });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "ChatGPT sign-in could not start." }); }
    finally { setBusy(null); }
  }

  async function disconnect(connection: ProviderConnectionSummary) {
    setBusy(connection.provider); setNotice({ tone: "neutral", text: `Disconnecting ${providerLabels[connection.provider]}…` });
    try {
      const response = await fetch(`/api/admin/providers/${connection.provider}`, {
        method: "DELETE", headers: { "x-csrf-token": csrfToken, "if-match": `"${connection.version}"` },
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The provider could not be disconnected."));
      const refreshed = await fetch("/api/admin/providers", { cache: "no-store" });
      setConnections(await refreshed.json() as ProviderConnectionSummary[]);
      if (modelValue.startsWith(`${connection.provider}::`)) setModelValue("");
      setNotice({ tone: "success", text: `${providerLabels[connection.provider]} is disconnected.` });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "The provider could not be disconnected." }); }
    finally { setBusy(null); }
  }

  async function refreshModels(connection: ProviderConnectionSummary) {
    setBusy(`refresh-${connection.provider}`); setNotice({ tone: "neutral", text: `Checking ${providerLabels[connection.provider]} for available models…` });
    try {
      const response = await fetch(`/api/admin/providers/${connection.provider}/refresh`, {
        method: "POST", headers: { "x-csrf-token": csrfToken, "if-match": `"${connection.version}"` },
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Available models could not be refreshed."));
      const next = await response.json() as ProviderConnectionSummary;
      replaceConnection(next); setNotice({ tone: "success", text: `${providerLabels[connection.provider]} models are up to date.` });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "Available models could not be refreshed." }); }
    finally { setBusy(null); }
  }

  async function save(form: FormData) {
    if (!selectedModel) { setNotice({ tone: "error", text: "Connect a provider and choose a model first." }); return; }
    setBusy("settings"); setNotice({ tone: "neutral", text: "Saving your triage preferences…" });
    const body = {
      triagePaused: paused,
      triagePauseReason: paused ? String(form.get("triagePauseReason") || "") : null,
      rawRetentionDays: Number(form.get("rawRetentionDays")),
      selectedModel: { provider: selectedModel.provider, modelIdentifier: selectedModel.id, reasoningEffort: effectiveReasoningEffort || null },
    };
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "if-match": `"${settings.version}"` },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Your triage preferences could not be saved."));
      const result = await response.json() as SettingsRecord;
      setSettings(result); setNotice({ tone: "success", text: "Your triage preferences are saved." });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "Your triage preferences could not be saved." }); }
    finally { setBusy(null); }
  }

  const ollama = connections.find((connection) => connection.provider === "OLLAMA_CLOUD")!;
  const codex = connections.find((connection) => connection.provider === "OPENAI_CODEX")!;
  return <div className="settings-form">
    <p className={`form-status ${notice.tone === "error" ? "error" : notice.tone === "success" ? "success" : ""}`} role="status" aria-live="polite">
      {notice.text || "PointView runs feedback triage once each day and continues until the queue is empty."}
    </p>

    <section className="provider-section" aria-labelledby="provider-heading">
      <div className="section-copy"><p className="eyebrow">Step 1</p><h2 id="provider-heading">Connect an AI service</h2><p>Connect either service—or both. Credentials are encrypted and are never shown again.</p></div>
      <div className="provider-grid">
        <article className="provider-card">
          <div><span className={`status-dot ${ollama.status === "CONNECTED" ? "connected" : ""}`} aria-hidden="true" /><strong>Ollama Cloud</strong></div>
          <p>{ollama.status === "CONNECTED" ? `Connected · ${ollama.models.length} models available` : "Use an Ollama Cloud API key."}</p>
          {ollama.status === "CONNECTED" ? <div className="provider-actions"><button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void refreshModels(ollama)}>{busy === `refresh-${ollama.provider}` ? "Refreshing…" : "Refresh models"}</button><button type="button" className="quiet-button" disabled={busy !== null} onClick={() => void disconnect(ollama)}>Disconnect</button></div> : <>
            <label>Ollama Cloud API key<input type="password" autoComplete="off" value={ollamaKey} onChange={(event) => setOllamaKey(event.target.value)} placeholder="Paste your key" /></label>
            <button type="button" className="secondary-button" disabled={!ollamaKey || busy !== null} onClick={() => void connectOllama()}>{busy === "ollama" ? "Connecting…" : "Connect Ollama Cloud"}</button>
          </>}
        </article>
        <article className="provider-card">
          <div><span className={`status-dot ${codex.status === "CONNECTED" ? "connected" : ""}`} aria-hidden="true" /><strong>ChatGPT / Codex</strong></div>
          <p>{codex.status === "CONNECTED" ? `Connected · ${codex.models.length} models available` : "Sign in with the ChatGPT account used for Codex."}</p>
          {codex.status === "CONNECTED" ? <div className="provider-actions"><button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void refreshModels(codex)}>{busy === `refresh-${codex.provider}` ? "Refreshing…" : "Refresh models"}</button><button type="button" className="quiet-button" disabled={busy !== null} onClick={() => void disconnect(codex)}>Disconnect</button></div>
            : <button type="button" className="secondary-button" disabled={busy !== null || device !== null} onClick={() => void connectCodex()}>{busy === "codex" ? "Preparing…" : "Sign in with ChatGPT"}</button>}
          {device && <div className="device-code" role="group" aria-label="ChatGPT device sign-in">
            <span>Your one-time code</span><strong>{device.userCode}</strong>
            <button type="button" className="quiet-button" onClick={() => void navigator.clipboard.writeText(device.userCode)}>Copy code</button>
            <a className="primary-button" href={device.verificationUrl} target="_blank" rel="noreferrer">Open ChatGPT sign-in</a>
            <small>This page will update automatically after you approve access.</small>
          </div>}
        </article>
      </div>
    </section>

    <form action={(form) => void save(form)}>
      <fieldset disabled={busy !== null}>
        <legend><span className="eyebrow">Step 2</span>Choose how triage runs</legend>
        <label>AI model<select value={modelValue} onChange={(event) => setModelValue(event.target.value)} required>
          <option value="" disabled>{connectedModels.length ? "Choose a model" : "Connect an AI service first"}</option>
          {connections.filter((connection) => connection.status === "CONNECTED").map((connection) => <optgroup key={connection.provider} label={providerLabels[connection.provider]}>
            {connection.models.map((model) => <option key={model.id} value={`${connection.provider}::${model.id}`}>{model.displayName}</option>)}
          </optgroup>)}
        </select><small>PointView will use this model for research, comparison, and Issue triage.</small>
        {selectedModel && <small>{selectedModel.inputModalities.includes("image")
          ? "This model can review attached screenshots."
          : "This model is text-only. PointView will use screenshot details but will not send image files to it."}</small>}</label>
        {selectedModel && selectedModel.reasoningEfforts.length > 0 && <label>Reasoning depth<select value={effectiveReasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)}>
          {selectedModel.reasoningEfforts.map((effort) => <option key={effort} value={effort}>{effort.charAt(0).toUpperCase() + effort.slice(1)}</option>)}
        </select><small>Higher levels may improve difficult decisions but can take longer.</small></label>}
        <label className="privacy-check"><input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} /> Pause automatic triage</label>
        {paused && <label>Why are you pausing triage?<input name="triagePauseReason" defaultValue={settings.triagePauseReason ?? ""} required /></label>}
        <label>Keep original feedback for<select name="rawRetentionDays" defaultValue={settings.rawRetentionDays}><option value="180">6 months</option><option value="365">1 year</option><option value="730">2 years</option><option value="1825">5 years</option><option value="3650">10 years</option></select><small>Minimized evidence and audit history remain after the original content is deleted.</small></label>
        <div className="schedule-note"><strong>Automatic schedule</strong><span>Daily at 3:00 AM Central; one item at a time until the queue is empty.</span></div>
      </fieldset>
      <button className="primary-button" disabled={busy !== null || !selectedModel}>{busy === "settings" ? "Saving…" : "Save triage preferences"}</button>
    </form>
  </div>;
}

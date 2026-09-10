"use client";

import { useState } from "react";

type Source = Record<string, unknown> & { id: string; slug: string; version: number; enabled: boolean; paused: boolean; validation: { status: string; checked_at: string | null; digest: string | null } };
type History = { id: string; sourceAppId: string; action: string; eventAt: string; metadata: unknown };

function editable(source: Source) {
  const input: Record<string, unknown> = { ...source };
  delete input.id;
  delete input.version;
  delete input.validation;
  return input;
}

export function SourceAdmin({ initialSources, history, csrfToken }: { initialSources: Source[]; history: History[]; csrfToken: string }) {
  const [sources, setSources] = useState(initialSources);
  const [message, setMessage] = useState("");

  async function update(source: Source, text: string) {
    let body: unknown;
    try { body = JSON.parse(text); } catch { setMessage(`${source.slug}: configuration must be valid JSON.`); return; }
    setMessage(`Validating and saving ${source.slug}…`);
    const response = await fetch(`/api/admin/source-apps/${source.id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "if-match": `"${source.version}"` }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.title ?? "Source update failed."); return; }
    setSources((current) => current.map((item) => item.id === result.id ? result : item));
    setMessage(`${result.slug} version ${result.version} saved with ${result.validation.status} validation.`);
  }

  async function create(text: string) {
    let body: unknown;
    try { body = JSON.parse(text); } catch { setMessage("New source configuration must be valid JSON."); return; }
    const response = await fetch("/api/admin/source-apps", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.title ?? "Source creation failed."); return; }
    setSources((current) => [...current, result]);
    setMessage(`${result.slug} created disabled. Validate and explicitly enable it when ready.`);
  }

  return <><p className="form-status" role="status" aria-live="polite">{message}</p>
    <section className="source-grid">{sources.map((source) => <SourceEditor key={source.id} source={source} events={history.filter((event) => event.sourceAppId === source.id)} onSave={update} />)}</section>
    <NewSource onCreate={create} />
  </>;
}

function SourceEditor({ source, events, onSave }: { source: Source; events: History[]; onSave: (source: Source, text: string) => Promise<void> }) {
  const [text, setText] = useState(JSON.stringify(editable(source), null, 2));
  return <article className="detail-card"><p className="eyebrow">{source.validation.status} · version {source.version}</p><h2>{source.slug}</h2>
    <label className="json-editor">Public integration configuration<textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} /></label>
    <button className="primary-button" onClick={() => void onSave(source, text)}>Validate and save</button>
    <details><summary>Version history ({events.length})</summary><ol className="compact-list">{events.map((event) => <li key={event.id}><strong>{event.action}</strong><span>{new Date(event.eventAt).toLocaleString()} · {JSON.stringify(event.metadata)}</span></li>)}</ol></details>
  </article>;
}

function NewSource({ onCreate }: { onCreate: (text: string) => Promise<void> }) {
  const [text, setText] = useState("{\n  \"slug\": \"\",\n  \"display_name\": \"\",\n  \"github_owner\": \"PointCommunity\",\n  \"github_repo\": \"\",\n  \"github_project_node_id\": \"PVT_\",\n  \"github_project_number\": 1,\n  \"github_installation_id\": 1,\n  \"allowed_origins\": [\"https://\"],\n  \"return_url_prefixes\": [\"https://\"],\n  \"governed_labels\": [\"type:bug\", \"type:feature\", \"type:maintenance\", \"type:security\", \"area:ui\"],\n  \"public_keys\": []\n}");
  return <section className="detail-card"><h2>Register source app</h2><p className="muted">Only public Ed25519 JWKs belong here. New sources are disabled until an explicit validated update enables them.</p><label className="json-editor">New source configuration<textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} /></label><button className="primary-button" onClick={() => void onCreate(text)}>Create disabled source</button></section>;
}

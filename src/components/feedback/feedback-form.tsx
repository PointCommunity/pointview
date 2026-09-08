"use client";

import { useState, type FormEvent } from "react";

type Context = {
  sourceApp: string;
  environment: string;
  route: string;
  screen: string;
  appVersion: string;
  sourceRevision: string;
};

export function FeedbackForm({ context, csrfToken }: { context: Context; csrfToken: string }) {
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage("Validating and securely storing your feedback…");
    const response = await fetch("/api/feedback", {
      method: "POST",
      body: new FormData(event.currentTarget),
      headers: { "x-csrf-token": csrfToken },
    }).catch(() => null);
    if (!response) {
      setStatus("error");
      setMessage("PointView could not be reached. Your form is still here; please try again.");
      return;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { title?: string; correlationId?: string };
      setStatus("error");
      setMessage(`${body.title ?? "The feedback could not be submitted."}${body.correlationId ? ` Reference: ${body.correlationId}` : ""}`);
      return;
    }
    const location = response.headers.get("location");
    window.location.assign(location ?? "/feedback");
  }

  return (
    <form className="feedback-form" onSubmit={submit}>
      <section className="context-card" aria-labelledby="verified-context-title">
        <div>
          <p className="eyebrow">Verified context</p>
          <h2 id="verified-context-title">{context.sourceApp}</h2>
          <p>{context.screen} · {context.route}</p>
        </div>
        <dl className="context-details">
          <div><dt>Environment</dt><dd>{context.environment}</dd></div>
          <div><dt>App version</dt><dd>{context.appVersion}</dd></div>
          <div><dt>Revision</dt><dd>{context.sourceRevision}</dd></div>
        </dl>
      </section>

      <div className="field-group">
        <label htmlFor="feedback">What should we know?</label>
        <p id="feedback-help">Describe what happened, what you expected, or an idea that would improve this screen.</p>
        <textarea id="feedback" name="feedback" minLength={1} maxLength={20000} required aria-describedby="feedback-help" rows={9} />
      </div>

      <div className="field-group">
        <label htmlFor="screenshots">Screenshots <span className="optional">optional</span></label>
        <p id="screenshots-help">Up to five PNG, JPEG, or WebP images, 10 MiB each. Only choose images you intend to share.</p>
        <input id="screenshots" name="screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-describedby="screenshots-help" />
      </div>

      <label className="privacy-check">
        <input type="checkbox" name="privacy_acknowledged" value="true" required />
        <span>I understand this feedback and its screenshots are private and raw content is deleted 180 days after triage finishes.</span>
      </label>

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Submit feedback"}
        </button>
      </div>
      <p className={status === "error" ? "form-status error" : "form-status"} role={status === "error" ? "alert" : "status"} aria-live="polite">
        {message}
      </p>
    </form>
  );
}

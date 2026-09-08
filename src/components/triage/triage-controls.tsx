"use client";

import { useState } from "react";

export function TriageControls({ feedbackId, state, csrfToken }: { feedbackId: string; state: string; csrfToken: string }) {
  const [message, setMessage] = useState("");
  async function annotate(form: FormData) {
    const response = await fetch(`/api/admin/feedback/${feedbackId}/annotations`, {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ kind: form.get("kind"), body: form.get("body") }),
    });
    const result = await response.json();
    setMessage(response.ok ? "Annotation added. Refresh to see the append-only history." : result.title ?? "Annotation failed.");
  }
  async function requeue(form: FormData) {
    const response = await fetch(`/api/admin/feedback/${feedbackId}/requeue`, {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ explanation: form.get("explanation") }),
    });
    const result = await response.json();
    setMessage(response.ok ? "Feedback requeued at its original sequence." : result.title ?? "Requeue failed.");
  }
  return <section className="detail-card"><h2>Operator actions</h2><p className="form-status" role="status" aria-live="polite">{message}</p>
    <form className="inline-form" action={(form) => void annotate(form)}><label>Annotation type<select name="kind"><option>CORRECTION</option><option>OPERATIONAL</option></select></label><label>Append-only note<textarea name="body" required maxLength={4000} /></label><button className="primary-button">Add annotation</button></form>
    {state === "NEEDS_ATTENTION" ? <form className="inline-form" action={(form) => void requeue(form)}><label>Corrective action before requeue<textarea name="explanation" required minLength={10} maxLength={4000} /></label><button className="primary-button">Requeue feedback</button></form> : null}
  </section>;
}

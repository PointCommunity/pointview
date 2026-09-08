"use client";

import { useState } from "react";

export function WithdrawButton({ feedbackId, csrfToken }: { feedbackId: string; csrfToken: string }) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  async function withdraw() {
    if (!window.confirm("Withdraw this queued feedback and permanently delete its raw text and screenshots?")) return;
    setState("working");
    const response = await fetch(`/api/feedback/${feedbackId}`, { method: "DELETE", headers: { "x-csrf-token": csrfToken } });
    if (response.ok) {
      window.location.reload();
      return;
    }
    const body = await response.json().catch(() => ({})) as { title?: string };
    setState("error");
    setMessage(body.title ?? "The feedback could not be withdrawn.");
  }
  return (
    <div>
      <button className="danger-button" type="button" onClick={withdraw} disabled={state === "working"}>
        {state === "working" ? "Withdrawing…" : "Withdraw feedback"}
      </button>
      <p className="form-status error" role="alert">{message}</p>
    </div>
  );
}

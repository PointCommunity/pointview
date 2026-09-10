"use client";

import { useState } from "react";

type Account = { id: string; email: string; displayName: string; role: "USER" | "ADMIN" | "OWNER"; status: "PENDING" | "ACTIVE" | "SUSPENDED"; version: number };

export function AccountAdmin({ initialAccounts, csrfToken, actorRole }: { initialAccounts: Account[]; csrfToken: string; actorRole: Account["role"] }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [message, setMessage] = useState("");

  async function save(account: Account, role: Account["role"], status: Account["status"]) {
    setMessage(`Saving ${account.displayName}…`);
    const response = await fetch(`/api/admin/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "if-match": `"${account.version}"` },
      body: JSON.stringify({ role, status }),
    });
    const result = await response.json();
    if (!response.ok) { setMessage(result.title ?? "Account update failed."); return; }
    setAccounts((current) => current.map((item) => item.id === result.id ? result : item));
    setMessage(`${result.displayName} updated.`);
  }

  return <>
    <p className="form-status" role="status" aria-live="polite">{message}</p>
    <div className="admin-table" role="list">
      {accounts.map((account) => <AccountRow key={account.id} account={account} actorRole={actorRole} onSave={save} />)}
    </div>
  </>;
}

function AccountRow({ account, actorRole, onSave }: { account: Account; actorRole: Account["role"]; onSave: (account: Account, role: Account["role"], status: Account["status"]) => Promise<void> }) {
  const [role, setRole] = useState(account.role);
  const [status, setStatus] = useState(account.status);
  const ownerLocked = actorRole !== "OWNER" && account.role === "OWNER";
  return <form className="admin-row" role="listitem" onSubmit={(event) => { event.preventDefault(); void onSave(account, role, status); }}>
    <div><strong>{account.displayName}</strong><small>{account.email}</small></div>
    <label>Role<select value={role} disabled={ownerLocked} onChange={(event) => setRole(event.target.value as Account["role"])}><option>USER</option><option>ADMIN</option>{actorRole === "OWNER" ? <option>OWNER</option> : null}</select></label>
    <label>Status<select value={status} disabled={ownerLocked} onChange={(event) => setStatus(event.target.value as Account["status"])}><option>PENDING</option><option>ACTIVE</option><option>SUSPENDED</option></select></label>
    <button className="primary-button" disabled={ownerLocked || (role === account.role && status === account.status)}>Save</button>
  </form>;
}

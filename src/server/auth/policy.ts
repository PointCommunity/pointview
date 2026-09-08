import type { AccountStatus, Role } from "./types";

type AccountTransition = {
  actorRole: Role;
  currentRole: Role;
  currentStatus: AccountStatus;
  nextRole: Role;
  nextStatus: AccountStatus;
  activeOwnerCount: number;
};

export function validateAccountTransition(input: AccountTransition): void {
  if (input.actorRole === "USER") throw new Error("Only Admins and Owners may manage accounts");
  const changesOwnerMembership = input.currentRole === "OWNER" || input.nextRole === "OWNER";
  if (changesOwnerMembership && input.actorRole !== "OWNER") {
    throw new Error("Only an Owner may change Owner membership");
  }
  const removesActiveOwner =
    input.currentRole === "OWNER" &&
    input.currentStatus === "ACTIVE" &&
    (input.nextRole !== "OWNER" || input.nextStatus !== "ACTIVE");
  if (removesActiveOwner && input.activeOwnerCount <= 1) {
    throw new Error("Cannot remove or suspend the final active Owner");
  }
}

export function canReadFeedback(
  account: { accountId: string; role: Role; status: AccountStatus },
  submitterAccountId: string,
): boolean {
  if (account.status !== "ACTIVE") return false;
  return account.role === "ADMIN" || account.role === "OWNER" || account.accountId === submitterAccountId;
}

export function requireRole(account: { role: Role; status: AccountStatus }, allowed: readonly Role[]): void {
  if (account.status !== "ACTIVE" || !allowed.includes(account.role)) throw new Error("Access denied");
}


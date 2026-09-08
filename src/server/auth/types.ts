export const roles = ["USER", "ADMIN", "OWNER"] as const;
export const accountStatuses = ["PENDING", "ACTIVE", "SUSPENDED"] as const;

export type Role = (typeof roles)[number];
export type AccountStatus = (typeof accountStatuses)[number];

export type AuthenticatedAccount = {
  accountId: string;
  role: Role;
  status: AccountStatus;
};


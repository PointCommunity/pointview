import { z } from "zod";

const httpsUrl = z
  .url()
  .transform((value) => new URL(value))
  .refine((value) => value.protocol === "https:", "must use HTTPS");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  POINTVIEW_BASE_URL: httpsUrl,
  POINTVIEW_AUDIENCE: z.string().min(1).max(128),
  DATABASE_URL: z.string().startsWith("postgres://").or(z.string().startsWith("postgresql://")),
  SESSION_SECRET: z.string().min(32),
  CF_ACCESS_TEAM_DOMAIN: httpsUrl,
  CF_ACCESS_AUD: z.string().min(1),
  ATTACHMENT_ROOT: z.string().startsWith("/"),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_INSTALLATION_ID: z.coerce.number().int().positive(),
  GITHUB_APP_PRIVATE_KEY: z.string().includes("PRIVATE KEY"),
  OPENAI_API_KEY: z.string().min(1),
  POINTVIEW_SOURCE_REVISION: z.string().min(1).max(128),
});

export type ServerConfig = {
  environment: "development" | "test" | "production";
  baseUrl: URL;
  audience: string;
  databaseUrl: string;
  sessionSecret: string;
  access: { teamDomain: URL; audience: string };
  attachmentRoot: string;
  github: { appId: number; installationId: number; privateKey: string };
  openAiApiKey: string;
  sourceRevision: string;
};

export function parseServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "configuration"))];
    throw new Error(`Invalid server configuration: ${fields.join(", ")}`);
  }
  const value = result.data;
  return {
    environment: value.NODE_ENV,
    baseUrl: value.POINTVIEW_BASE_URL,
    audience: value.POINTVIEW_AUDIENCE,
    databaseUrl: value.DATABASE_URL,
    sessionSecret: value.SESSION_SECRET,
    access: { teamDomain: value.CF_ACCESS_TEAM_DOMAIN, audience: value.CF_ACCESS_AUD },
    attachmentRoot: value.ATTACHMENT_ROOT,
    github: {
      appId: value.GITHUB_APP_ID,
      installationId: value.GITHUB_APP_INSTALLATION_ID,
      privateKey: value.GITHUB_APP_PRIVATE_KEY,
    },
    openAiApiKey: value.OPENAI_API_KEY,
    sourceRevision: value.POINTVIEW_SOURCE_REVISION,
  };
}


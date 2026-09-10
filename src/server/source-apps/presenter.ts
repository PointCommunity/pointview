import type { SourceAppRecord } from "./service";

export function sourceInputFromApi(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  return {
    slug: input.slug,
    displayName: input.display_name,
    githubOwner: input.github_owner,
    githubRepo: input.github_repo,
    githubProjectNodeId: input.github_project_node_id,
    githubProjectNumber: input.github_project_number,
    githubInstallationId: input.github_installation_id,
    allowedOrigins: input.allowed_origins,
    returnUrlPrefixes: input.return_url_prefixes,
    governedLabels: input.governed_labels,
    publicKeys: Array.isArray(input.public_keys) ? input.public_keys.map((key) => {
      if (!key || typeof key !== "object" || Array.isArray(key)) return key;
      const record = key as Record<string, unknown>;
      return { kid: record.kid, jwk: record.jwk, notBefore: record.not_before, notAfter: record.not_after };
    }) : input.public_keys,
    ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
    ...(typeof input.paused === "boolean" ? { paused: input.paused } : {}),
  };
}

export function presentSourceApp(source: SourceAppRecord) {
  return {
    id: source.id,
    slug: source.slug,
    display_name: source.displayName,
    github_owner: source.githubOwner,
    github_repo: source.githubRepo,
    github_project_node_id: source.githubProjectNodeId,
    github_project_number: source.githubProjectNumber,
    github_installation_id: source.githubInstallationId,
    allowed_origins: source.allowedOrigins,
    return_url_prefixes: source.returnUrlPrefixes,
    governed_labels: source.governedLabels,
    public_keys: source.publicKeys.map((key) => ({ kid: key.kid, jwk: key.jwk, not_before: key.notBefore, not_after: key.notAfter })),
    enabled: source.enabled,
    paused: source.paused,
    version: source.version,
    validation: {
      status: source.validation.status,
      checked_at: source.validation.checkedAt?.toISOString() ?? null,
      digest: source.validation.digest,
    },
  };
}

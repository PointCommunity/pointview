import { createPrivateKey } from "node:crypto";

import { SignJWT } from "jose";
import { z } from "zod";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type GitHubClientOptions = {
  appId: number;
  installationId: number;
  privateKeyPem: string;
  allowedRepositories: Set<string>;
  fetcher?: Fetcher;
  now?: () => Date;
};

const installationResponse = z.object({ token: z.string().min(1), expires_at: z.iso.datetime() });

export class GitHubRateLimitError extends Error {
  readonly name = "GitHubRateLimitError";
  constructor(readonly retryAfterSeconds: number, readonly requestId: string | null) {
    super(`GitHub rate limit requires a retry after ${retryAfterSeconds} seconds`);
  }
}

export class GitHubAppClient {
  readonly #options: GitHubClientOptions;
  readonly #fetch: Fetcher;
  readonly #now: () => Date;
  #cachedToken: { value: string; expiresAt: number } | undefined;

  constructor(options: GitHubClientOptions) {
    this.#options = options;
    this.#fetch = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async #appJwt(): Promise<string> {
    const key = createPrivateKey(this.#options.privateKeyPem);
    const now = Math.floor(this.#now().getTime() / 1_000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(String(this.#options.appId))
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .sign(key);
  }

  async #installationToken(): Promise<string> {
    const now = this.#now().getTime();
    if (this.#cachedToken && this.#cachedToken.expiresAt - 60_000 > now) return this.#cachedToken.value;
    const response = await this.#fetch(
      `https://api.github.com/app/installations/${this.#options.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${await this.#appJwt()}`,
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (!response.ok) throw new Error(`GitHub installation authentication failed with HTTP ${response.status}`);
    const parsed = installationResponse.parse(await response.json());
    this.#cachedToken = { value: parsed.token, expiresAt: new Date(parsed.expires_at).getTime() };
    return parsed.token;
  }

  #repositoryUrl(owner: string, repo: string, path: string): URL {
    const identity = `${owner}/${repo}`;
    if (!this.#options.allowedRepositories.has(identity)) throw new Error(`Repository ${identity} is outside the allowlist`);
    if (path.includes("://") || path.split(/[?#]/, 1)[0].split("/").includes("..")) throw new Error("Repository API path is invalid");
    const repository = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const repositoryPath = new URL(repository).pathname;
    const url = path ? new URL(path.replace(/^\//, ""), `${repository}/`) : new URL(repository);
    if (url.origin !== "https://api.github.com" || (url.pathname !== repositoryPath && !url.pathname.startsWith(`${repositoryPath}/`))) {
      throw new Error("Repository API path escapes its allowlisted repository");
    }
    return url;
  }

  async #authorizedFetch(url: URL, init: RequestInit = {}): Promise<Response> {
    const response = await this.#fetch(url, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${await this.#installationToken()}`,
        "x-github-api-version": "2022-11-28",
        ...init.headers,
      },
    });
    if (response.status === 429 || (response.status === 403 && (response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0"))) {
      const retryHeader = Number(response.headers.get("retry-after"));
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const seconds = Number.isFinite(retryHeader) && retryHeader > 0
        ? Math.ceil(retryHeader)
        : Math.max(1, Math.ceil(reset - this.#now().getTime() / 1_000));
      throw new GitHubRateLimitError(seconds, response.headers.get("x-github-request-id"));
    }
    if (!response.ok) throw new Error(`GitHub request failed with HTTP ${response.status}`);
    return response;
  }

  async repositoryJson<T = unknown>(owner: string, repo: string, path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#authorizedFetch(this.#repositoryUrl(owner, repo, path), init);
    return response.json() as Promise<T>;
  }

  async repositoryPages<T = unknown>(owner: string, repo: string, path: string): Promise<T[]> {
    const items: T[] = [];
    let url: URL | null = this.#repositoryUrl(owner, repo, path);
    const repositoryPrefix = `${this.#repositoryUrl(owner, repo, "").pathname}/`;
    while (url) {
      const response = await this.#authorizedFetch(url);
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error("GitHub paginated response is not an array");
      items.push(...(page as T[]));
      const link = response.headers.get("link") ?? "";
      const next = link.split(",").map((entry) => entry.trim()).find((entry) => /;\s*rel="next"$/.test(entry));
      const match = next?.match(/^<([^>]+)>/);
      url = match ? new URL(match[1]) : null;
      if (url && (url.origin !== "https://api.github.com" || !url.pathname.startsWith(repositoryPrefix))) {
        throw new Error("GitHub pagination escaped the allowlisted repository");
      }
    }
    return items;
  }

  async repositoryInstallationId(owner: string, repo: string): Promise<number> {
    const repositoryUrl = this.#repositoryUrl(owner, repo, "");
    const url = new URL(`${repositoryUrl.pathname}/installation`, repositoryUrl.origin);
    const response = await this.#fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${await this.#appJwt()}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub App installation lookup failed with HTTP ${response.status}`);
    const result = z.object({ id: z.number().int().positive() }).parse(await response.json());
    return result.id;
  }

  async withInstallationToken<T>(callback: (token: string) => Promise<T>): Promise<T> {
    return callback(await this.#installationToken());
  }

  async projectReadback(projectNodeId: string): Promise<unknown> {
    if (!/^PVT_[A-Za-z0-9_-]+$/.test(projectNodeId)) throw new Error("GitHub Project node ID is invalid");
    const response = await this.#authorizedFetch(new URL("https://api.github.com/graphql"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query PointViewSourceProject($id: ID!) {
          node(id: $id) {
            ... on ProjectV2 {
              id number public
              fields(first: 100) {
                pageInfo { hasNextPage }
                nodes {
                  ... on ProjectV2SingleSelectField { name options { name } }
                }
              }
            }
          }
        }`,
        variables: { id: projectNodeId },
      }),
    });
    return response.json();
  }

  async graphqlJson<T = unknown>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!query.startsWith("query PointView") && !query.startsWith("mutation PointView")) {
      throw new Error("GitHub GraphQL operation must use the PointView operation prefix");
    }
    const response = await this.#authorizedFetch(new URL("https://api.github.com/graphql"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    return response.json() as Promise<T>;
  }
}

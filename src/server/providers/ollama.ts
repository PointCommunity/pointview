import { z } from "zod";

import { normalizeWebSourceUrl, webSourceId } from "@/server/triage/model/web-sources";

import { readBoundedJson } from "./http";
import { providerCatalog, providerModel, type ProviderModel } from "./types";

const OLLAMA_CLOUD_BASE = "https://ollama.com/api";
const tagsResponse = z.object({
  models: z.array(z.object({ name: z.string().max(200).optional(), model: z.string().max(200).optional() }).passthrough()).max(250),
}).passthrough();
const showResponse = z.object({ capabilities: z.array(z.string()).max(30).optional().default([]) }).passthrough();
const webSearchResponse = z.object({
  results: z.array(z.object({
    title: z.string().trim().min(1).max(500),
    url: z.string().max(2_000),
    content: z.string().max(20_000),
  }).passthrough()).max(10),
}).passthrough();

export type OllamaWebResult = { id: string; title: string; url: string; content: string };

export class OllamaProviderError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = "OllamaProviderError"; }
}

export async function discoverOllamaModels(apiKey: string, fetcher: typeof fetch = fetch): Promise<ProviderModel[]> {
  if (!apiKey.trim() || apiKey.length > 5000) throw new OllamaProviderError("OLLAMA_CREDENTIAL_INVALID", "The Ollama Cloud API key is invalid", 400);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetcher(`${OLLAMA_CLOUD_BASE}/tags`, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) throw new OllamaProviderError("OLLAMA_CREDENTIAL_REJECTED", "The Ollama Cloud credentials were rejected", 400);
    if (!response.ok) throw new OllamaProviderError("OLLAMA_UNAVAILABLE", "Ollama Cloud could not be reached", 503);
    const parsed = tagsResponse.safeParse(await readBoundedJson(response, 2_000_000).catch(() => null));
    if (!parsed.success) throw new OllamaProviderError("OLLAMA_RESPONSE_INVALID", "Ollama Cloud returned an invalid model catalog", 502);
    const models = [...new Set(parsed.data.models.map((entry) => (entry.model ?? entry.name ?? "").trim()).filter(Boolean))];
    const details: ProviderModel[] = [];
    for (let offset = 0; offset < models.length; offset += 8) {
      const batch = await Promise.all(models.slice(offset, offset + 8).map(async (id) => {
        const detailResponse = await fetcher(`${OLLAMA_CLOUD_BASE}/show`, {
          method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: id, verbose: false }), signal: controller.signal, redirect: "error", cache: "no-store",
        });
        if (detailResponse.status === 401 || detailResponse.status === 403) throw new OllamaProviderError("OLLAMA_CREDENTIAL_REJECTED", "The Ollama Cloud credentials were rejected", 400);
        if (!detailResponse.ok) throw new OllamaProviderError("OLLAMA_MODEL_CATALOG_UNAVAILABLE", "Ollama Cloud model details could not be loaded", 503);
        const detail = showResponse.safeParse(await readBoundedJson(detailResponse, 256_000).catch(() => null));
        if (!detail.success) throw new OllamaProviderError("OLLAMA_MODEL_CATALOG_INVALID", "Ollama Cloud returned invalid model details", 502);
        const capabilities = new Set(detail.data.capabilities);
        return providerModel.parse({
          id,
          displayName: id,
          reasoningEfforts: capabilities.has("thinking") ? ["low", "medium", "high"] : [],
          defaultReasoningEffort: capabilities.has("thinking") ? "medium" : null,
          inputModalities: capabilities.has("vision") ? ["text", "image"] : ["text"],
        });
      }));
      details.push(...batch);
    }
    return providerCatalog.parse(details);
  } catch (error) {
    if (error instanceof OllamaProviderError) throw error;
    throw new OllamaProviderError("OLLAMA_UNAVAILABLE", "Ollama Cloud could not be reached", 503);
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchOllamaWeb(apiKey: string, query: string, fetcher: typeof fetch = fetch): Promise<OllamaWebResult[]> {
  const safeQuery = query.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1_000);
  if (!apiKey.trim() || !safeQuery) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetcher(`${OLLAMA_CLOUD_BASE}/web_search`, {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: safeQuery, max_results: 5 }), signal: controller.signal, redirect: "error", cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) throw new OllamaProviderError("OLLAMA_CREDENTIAL_REJECTED", "The Ollama Cloud credentials were rejected", 503);
    if (!response.ok) throw new OllamaProviderError("OLLAMA_WEB_SEARCH_UNAVAILABLE", "Ollama Cloud research is temporarily unavailable", 503);
    const parsed = webSearchResponse.safeParse(await readBoundedJson(response, 1_000_000).catch(() => null));
    if (!parsed.success) throw new OllamaProviderError("OLLAMA_WEB_SEARCH_INVALID", "Ollama Cloud returned invalid research results", 502);
    return parsed.data.results.flatMap((result) => {
      const url = normalizeWebSourceUrl(result.url);
      return url ? [{ id: webSourceId(url), title: result.title, url, content: result.content }] : [];
    });
  } catch (error) {
    if (error instanceof OllamaProviderError) throw error;
    throw new OllamaProviderError("OLLAMA_WEB_SEARCH_UNAVAILABLE", "Ollama Cloud research is temporarily unavailable", 503);
  } finally { clearTimeout(timeout); }
}

export const ollamaCloudApi = { baseUrl: OLLAMA_CLOUD_BASE } as const;

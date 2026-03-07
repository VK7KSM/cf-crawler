import { request } from "undici";
import type { ExecutorConfig } from "./types.js";

export interface SitemapResult {
    ok: boolean;
    urls: string[];
    count: number;
    is_index: boolean;
    error?: string;
    timings?: { total_ms: number };
}

export async function cfSitemap(
    cfg: ExecutorConfig,
    payload: { url: string; timeout_ms?: number },
): Promise<SitemapResult> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;

    const { statusCode, body: responseBody } = await request(`${cfg.endpoint}/v1/sitemap`, {
        method: "POST",
        body,
        headers,
        headersTimeout: cfg.timeoutMs,
        bodyTimeout: cfg.timeoutMs,
    });

    const text = await responseBody.text();
    if (!text || statusCode >= 400) {
        return { ok: false, urls: [], count: 0, is_index: false, error: `HTTP ${statusCode}` };
    }

    try {
        return JSON.parse(text) as SitemapResult;
    } catch {
        return { ok: false, urls: [], count: 0, is_index: false, error: "invalid json response" };
    }
}

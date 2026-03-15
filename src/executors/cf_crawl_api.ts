import type { ExecutorConfig, RemoteResponse } from "./types.js";

interface CrawlApiPayload {
    url: string;
    formats?: string[];
    render?: boolean;
    max_age?: number;
}

/**
 * Call Worker's /v1/crawl proxy endpoint.
 * Worker handles CF REST API job creation + polling internally,
 * returns a synchronous RemoteResponse.
 */
export async function cfCrawlApi(
    cfg: ExecutorConfig,
    payload: CrawlApiPayload,
): Promise<RemoteResponse> {
    const url = `${cfg.endpoint}/v1/crawl`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.token) {
        headers.authorization = `Bearer ${cfg.token}`;
    }

    const body = JSON.stringify({
        url: payload.url,
        formats: payload.formats ?? ["markdown", "html"],
        render: payload.render ?? true,
        max_age: payload.max_age,
        timeout_ms: cfg.timeoutMs,
    });

    try {
        const resp = await fetch(url, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(cfg.timeoutMs + 5_000), // extra grace for polling
        });

        if (!resp.ok) {
            return {
                ok: false,
                url: payload.url,
                status: resp.status,
                error: `crawl proxy returned ${resp.status}: ${await resp.text()}`,
            };
        }

        return (await resp.json()) as RemoteResponse;
    } catch (err) {
        return {
            ok: false,
            url: payload.url,
            status: 0,
            error: `crawl api error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

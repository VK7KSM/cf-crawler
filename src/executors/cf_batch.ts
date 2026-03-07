import { request } from "undici";
import type { ExecutorConfig, RemoteResponse } from "./types.js";

export interface BatchResult {
    ok: boolean;
    results: RemoteResponse[];
    timings: { total_ms: number; count: number };
}

export async function cfBatchFetch(
    cfg: ExecutorConfig,
    payload: {
        urls: string[];
        mode?: string;
        timeout_ms?: number;
        session_id?: string;
        device_type?: string;
    },
): Promise<BatchResult> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;

    const { statusCode, body: responseBody } = await request(`${cfg.endpoint}/v1/batch-fetch`, {
        method: "POST",
        body,
        headers,
        headersTimeout: cfg.timeoutMs,
        bodyTimeout: cfg.timeoutMs,
    });

    const text = await responseBody.text();
    if (!text || statusCode >= 400) {
        return { ok: false, results: [], timings: { total_ms: 0, count: 0 } };
    }

    try {
        return JSON.parse(text) as BatchResult;
    } catch {
        return { ok: false, results: [], timings: { total_ms: 0, count: 0 } };
    }
}

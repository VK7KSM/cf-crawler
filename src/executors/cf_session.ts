import { request } from "undici";
import type { ExecutorConfig } from "./types.js";

export interface SessionInfo {
    ok: boolean;
    session_id: string;
    domains?: Array<{
        domain: string;
        cookies_count: number;
        updated_at: number;
    }>;
    error?: string;
}

export async function cfSessionGet(cfg: ExecutorConfig, sessionId: string): Promise<SessionInfo> {
    const headers: Record<string, string> = {};
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;

    const { statusCode, body } = await request(
        `${cfg.endpoint}/v1/session/${encodeURIComponent(sessionId)}`,
        {
            method: "GET",
            headers,
            headersTimeout: cfg.timeoutMs,
            bodyTimeout: cfg.timeoutMs,
        },
    );

    const text = await body.text();
    if (!text || statusCode >= 400) {
        return { ok: false, session_id: sessionId, error: `HTTP ${statusCode}` };
    }

    try {
        return JSON.parse(text) as SessionInfo;
    } catch {
        return { ok: false, session_id: sessionId, error: "invalid json response" };
    }
}

export async function cfSessionDelete(cfg: ExecutorConfig, sessionId: string): Promise<{ ok: boolean; deleted?: boolean; error?: string }> {
    const headers: Record<string, string> = {};
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;

    const { statusCode, body } = await request(
        `${cfg.endpoint}/v1/session/${encodeURIComponent(sessionId)}`,
        {
            method: "DELETE",
            headers,
            headersTimeout: cfg.timeoutMs,
            bodyTimeout: cfg.timeoutMs,
        },
    );

    const text = await body.text();
    if (!text || statusCode >= 400) {
        return { ok: false, error: `HTTP ${statusCode}` };
    }

    try {
        return JSON.parse(text) as { ok: boolean; deleted?: boolean };
    } catch {
        return { ok: false, error: "invalid json response" };
    }
}

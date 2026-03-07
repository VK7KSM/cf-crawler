import { request } from "undici";
import type { ExecutorConfig } from "./types.js";

export interface LoginResult {
    ok: boolean;
    session_id: string;
    final_url?: string;
    cookies_count?: number;
    error?: string;
    timings?: { total_ms: number };
}

export async function cfLogin(
    cfg: ExecutorConfig,
    payload: {
        session_id: string;
        login_url: string;
        credentials: {
            username_field: string;
            username: string;
            password_field: string;
            password: string;
        };
        submit_selector?: string;
        success_url_contains?: string;
        device_type?: string;
    },
): Promise<LoginResult> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;

    const { statusCode, body: responseBody } = await request(`${cfg.endpoint}/v1/login`, {
        method: "POST",
        body,
        headers,
        headersTimeout: cfg.timeoutMs,
        bodyTimeout: cfg.timeoutMs,
    });

    const text = await responseBody.text();
    if (!text || statusCode >= 400) {
        return {
            ok: false,
            session_id: payload.session_id,
            error: `HTTP ${statusCode}`,
        };
    }

    try {
        return JSON.parse(text) as LoginResult;
    } catch {
        return {
            ok: false,
            session_id: payload.session_id,
            error: "invalid json response",
        };
    }
}

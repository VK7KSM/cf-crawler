import { request } from "undici";
import type { ExecutorConfig, RemoteResponse } from "./types.js";

export interface BypassResponse extends RemoteResponse {
    bypass_strategy_used?: string;
}

export async function cfBypass(
    cfg: ExecutorConfig,
    payload: {
        url: string;
        goal?: string;
        mode?: string;
        timeout_ms?: number;
        session_id?: string;
    },
): Promise<BypassResponse> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;

    const { statusCode, body: responseBody } = await request(`${cfg.endpoint}/v1/bypass`, {
        method: "POST",
        body,
        headers,
        headersTimeout: cfg.timeoutMs,
        bodyTimeout: cfg.timeoutMs,
    });

    const text = await responseBody.text();
    if (!text) {
        return {
            ok: false,
            url: payload.url,
            status: statusCode,
            body: "",
            error: "empty response",
        };
    }

    try {
        const parsed = JSON.parse(text) as BypassResponse;
        parsed.status = parsed.status ?? statusCode;
        return parsed;
    } catch {
        return {
            ok: false,
            url: payload.url,
            status: statusCode,
            body: text,
            error: "invalid json response",
        };
    }
}

import { request } from "undici";
import type { ExecutorConfig, RemoteResponse } from "./types.js";

function parseRemoteResponse(text: string, statusCode: number): RemoteResponse {
    if (!text) {
        return {
            ok: statusCode >= 200 && statusCode < 300,
            url: "",
            status: statusCode,
            body: "",
        };
    }

    try {
        const parsed = JSON.parse(text) as RemoteResponse;
        parsed.status = parsed.status ?? statusCode;
        return parsed;
    } catch {
        return {
            ok: statusCode >= 200 && statusCode < 300,
            url: "",
            status: statusCode,
            body: text,
            error: "upstream returned non-json payload",
        };
    }
}

export async function cfFetch(
    cfg: ExecutorConfig,
    payload: Record<string, unknown>,
): Promise<RemoteResponse> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
        "content-type": "application/json",
    };
    if (cfg.token) {
        headers.authorization = `Bearer ${cfg.token}`;
    }

    const { statusCode, body: responseBody } = await request(`${cfg.endpoint}/v1/fetch`, {
        method: "POST",
        body,
        headers,
        headersTimeout: cfg.timeoutMs,
        bodyTimeout: cfg.timeoutMs,
    });

    const text = await responseBody.text();
    const parsed = parseRemoteResponse(text, statusCode);
    if (!parsed.url && typeof payload.url === "string") {
        parsed.url = payload.url;
    }
    return parsed;
}

import { request } from "undici";

export interface CfHealthResult {
    ok: boolean;
    statusCode: number;
    body: Record<string, unknown>;
    totalMs: number;
}

export async function cfHealth(endpoint: string, token?: string, timeoutMs = 8000): Promise<CfHealthResult> {
    const headers: Record<string, string> = {};
    if (token) {
        headers.authorization = `Bearer ${token}`;
    }

    const started = Date.now();
    const { statusCode, body } = await request(`${endpoint}/v1/health`, {
        method: "GET",
        headers,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
    });

    const text = await body.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : { ok: false };

    return {
        ok: statusCode >= 200 && statusCode < 300 && parsed.ok === true,
        statusCode,
        body: parsed,
        totalMs: Date.now() - started,
    };
}

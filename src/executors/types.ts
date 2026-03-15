export interface ExecutorConfig {
    endpoint: string;
    token?: string;
    timeoutMs: number;
}

export interface RemoteResponse {
    ok: boolean;
    url: string;
    final_url?: string;
    status: number;
    title?: string;
    content_type?: string;
    body?: string;
    html?: string;
    markdown?: string;
    screenshot_base64?: string;
    anti_bot_signals?: string[];
    timings?: Record<string, number>;
    error?: string;
}

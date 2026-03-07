import type pino from "pino";
import { z } from "zod";
import { cfLogin, type LoginResult } from "../../executors/cf_login.js";
import { loadRuntimeConfig } from "../../runtime_config.js";

const schema = z.object({
    session_id: z.string().min(1),
    login_url: z.string().url(),
    credentials: z.object({
        username_field: z.string().min(1),
        username: z.string().min(1),
        password_field: z.string().min(1),
        password: z.string().min(1),
    }),
    submit_selector: z.string().optional(),
    success_url_contains: z.string().optional(),
    device_type: z.enum(["desktop", "mobile", "auto"]).optional(),
});

export async function runLogin(raw: unknown, logger: pino.Logger): Promise<LoginResult> {
    const input = schema.parse(raw);
    const config = loadRuntimeConfig();

    logger.info({ login_url: input.login_url, session_id: input.session_id }, "login starting");

    const result = await cfLogin(
        { endpoint: config.endpoint, token: config.token, timeoutMs: config.timeoutMs },
        {
            session_id: input.session_id,
            login_url: input.login_url,
            credentials: input.credentials,
            submit_selector: input.submit_selector,
            success_url_contains: input.success_url_contains,
            device_type: input.device_type,
        },
    );

    logger.info(
        { session_id: input.session_id, ok: result.ok, cookies: result.cookies_count },
        "login completed",
    );

    return result;
}

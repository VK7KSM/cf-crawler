import type pino from "pino";
import { ensureAgentReach } from "../../agent_reach/bridge.js";
import type { AgentReachEnsureResult } from "../../agent_reach/bridge.js";
import { loadRuntimeConfig } from "../../runtime_config.js";

export async function runAgentReachEnsure(logger: pino.Logger): Promise<AgentReachEnsureResult> {
    const config = loadRuntimeConfig();
    const result = await ensureAgentReach(config);
    logger.info(
        {
            success: result.success,
            command: result.command,
            installed: result.installed,
            updated: result.updated,
        },
        "agent-reach ensure completed",
    );
    return result;
}

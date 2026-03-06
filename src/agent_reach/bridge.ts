import { spawn } from "node:child_process";
import { request } from "undici";
import type { RuntimeConfig } from "../runtime_config.js";

const DEFAULT_COMMANDS = ["xreach", "agent-reach"];
const AGENT_REACH_PYPI = "https://pypi.org/pypi/agent-reach/json";
const AGENT_REACH_GIT = "git+https://github.com/Panniantong/Agent-Reach.git";

interface CommandResult {
    ok: boolean;
    code: number | null;
    output: string;
}

interface ExecSpec {
    label: string;
    executable: string;
    baseArgs: string[];
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            output += chunk.toString();
        });

        const timer = setTimeout(() => {
            child.kill();
            resolve({
                ok: false,
                code: null,
                output: `${output}\nTimed out after ${timeoutMs}ms.`,
            });
        }, timeoutMs);

        child.on("exit", (code) => {
            clearTimeout(timer);
            resolve({
                ok: code === 0,
                code,
                output: output.trim(),
            });
        });

        child.on("error", (error) => {
            clearTimeout(timer);
            resolve({
                ok: false,
                code: null,
                output: `${output}\n${String(error)}`.trim(),
            });
        });
    });
}

async function resolveCommandPath(command: string, timeoutMs: number): Promise<string | undefined> {
    const result = await runCommand("where.exe", [command], timeoutMs);
    if (!result.ok) {
        return undefined;
    }

    return result.output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
}

function parseVersion(text: string): string | undefined {
    const matched = text.match(/(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?/);
    return matched?.[0];
}

function compareSemver(left: string, right: string): number {
    const leftParts = left.split("-")[0].split(".").map((value) => Number(value));
    const rightParts = right.split("-")[0].split(".").map((value) => Number(value));

    const maxLen = Math.max(leftParts.length, rightParts.length);
    for (let i = 0; i < maxLen; i += 1) {
        const a = leftParts[i] ?? 0;
        const b = rightParts[i] ?? 0;
        if (a > b) {
            return 1;
        }
        if (a < b) {
            return -1;
        }
    }
    return 0;
}

async function buildCandidateSpecs(config: RuntimeConfig): Promise<ExecSpec[]> {
    const specs: ExecSpec[] = [];
    const seen = new Set<string>();

    const directCandidates = config.agentReachCommand
        ? [config.agentReachCommand, ...DEFAULT_COMMANDS.filter((item) => item !== config.agentReachCommand)]
        : DEFAULT_COMMANDS;

    for (const label of directCandidates) {
        const path = await resolveCommandPath(label, 4_000);
        if (!path || seen.has(path.toLowerCase())) {
            continue;
        }
        seen.add(path.toLowerCase());
        specs.push({
            label,
            executable: path,
            baseArgs: [],
        });
    }

    const pythonPath = await resolveCommandPath("python", 4_000);
    if (pythonPath) {
        specs.push({
            label: "python -m agent_reach.cli",
            executable: pythonPath,
            baseArgs: ["-m", "agent_reach.cli"],
        });
        specs.push({
            label: "python -m agent_reach",
            executable: pythonPath,
            baseArgs: ["-m", "agent_reach"],
        });
    }

    return specs;
}

async function probeSpec(spec: ExecSpec, timeoutMs: number): Promise<boolean> {
    const versionTry = await runCommand(spec.executable, [...spec.baseArgs, "--version"], timeoutMs);
    if (versionTry.ok || parseVersion(versionTry.output)) {
        return true;
    }

    const helpTry = await runCommand(spec.executable, [...spec.baseArgs, "--help"], timeoutMs);
    if (helpTry.ok) {
        return true;
    }

    return /usage|commands?|agent-reach|xreach/i.test(helpTry.output);
}

async function detectCommand(config: RuntimeConfig): Promise<ExecSpec | undefined> {
    const specs = await buildCandidateSpecs(config);
    for (const spec of specs) {
        if (await probeSpec(spec, 4_000)) {
            return spec;
        }
    }
    return undefined;
}

async function readInstalledVersion(spec: ExecSpec, timeoutMs: number): Promise<string | undefined> {
    const result = await runCommand(spec.executable, [...spec.baseArgs, "--version"], timeoutMs);
    if (!result.ok) {
        return undefined;
    }
    return parseVersion(result.output);
}

async function readLatestVersion(timeoutMs: number): Promise<string | undefined> {
    try {
        const { statusCode, body } = await request(AGENT_REACH_PYPI, {
            method: "GET",
            headersTimeout: timeoutMs,
            bodyTimeout: timeoutMs,
        });

        if (statusCode < 200 || statusCode >= 300) {
            return undefined;
        }

        const text = await body.text();
        const parsed = JSON.parse(text) as { info?: { version?: string } };
        return parsed.info?.version;
    } catch {
        return undefined;
    }
}

async function installOrUpgrade(config: RuntimeConfig): Promise<CommandResult> {
    const installTimeout = config.agentReachTimeoutMs;

    const uvPath = await resolveCommandPath("uv", 4_000);
    if (uvPath) {
        const uvInstall = await runCommand(uvPath, ["tool", "install", "--upgrade", "agent-reach"], installTimeout);
        if (uvInstall.ok) {
            return uvInstall;
        }
    }

    const pythonPath = (await resolveCommandPath("python", 4_000)) ?? "python";
    const pipInstall = await runCommand(pythonPath, ["-m", "pip", "install", "--upgrade", "agent-reach"], installTimeout);
    if (pipInstall.ok) {
        return pipInstall;
    }

    return runCommand(pythonPath, ["-m", "pip", "install", "--upgrade", AGENT_REACH_GIT], installTimeout);
}

export interface AgentReachDoctorResult {
    ok: boolean;
    output: string;
}

export interface AgentReachEnsureResult {
    success: boolean;
    installed: boolean;
    updated: boolean;
    command?: string;
    current_version?: string;
    latest_version?: string;
    actions: string[];
    doctor?: AgentReachDoctorResult;
    details: string[];
}

async function runDoctor(spec: ExecSpec, timeoutMs: number): Promise<AgentReachDoctorResult> {
    const result = await runCommand(spec.executable, [...spec.baseArgs, "doctor"], timeoutMs);
    return {
        ok: result.ok,
        output: result.output,
    };
}

export async function ensureAgentReach(config: RuntimeConfig): Promise<AgentReachEnsureResult> {
    const actions: string[] = [];
    const details: string[] = [];

    let detected = await detectCommand(config);
    let installed = false;
    let updated = false;

    if (!detected) {
        actions.push("install");
        const installResult = await installOrUpgrade(config);
        details.push(installResult.output);
        if (!installResult.ok) {
            return {
                success: false,
                installed: false,
                updated: false,
                actions,
                details,
            };
        }
        installed = true;
        detected = await detectCommand(config);
    }

    if (!detected) {
        return {
            success: false,
            installed,
            updated,
            actions,
            details: [...details, "Agent-Reach command was not found after install/upgrade."],
        };
    }

    let currentVersion = await readInstalledVersion(detected, 6_000);
    const latestVersion = config.agentReachAutoUpdate ? await readLatestVersion(6_000) : undefined;

    let shouldUpdate = false;
    if (config.agentReachMinVersion && currentVersion) {
        if (compareSemver(currentVersion, config.agentReachMinVersion) < 0) {
            shouldUpdate = true;
        }
    }
    if (config.agentReachAutoUpdate && latestVersion && currentVersion) {
        if (compareSemver(currentVersion, latestVersion) < 0) {
            shouldUpdate = true;
        }
    }
    if (!currentVersion && config.agentReachAutoUpdate) {
        shouldUpdate = true;
    }

    if (shouldUpdate) {
        actions.push("update");
        const updateResult = await installOrUpgrade(config);
        details.push(updateResult.output);
        if (updateResult.ok) {
            updated = true;
            currentVersion = await readInstalledVersion(detected, 6_000);
        }
    }

    const doctor = await runDoctor(detected, config.agentReachTimeoutMs);

    return {
        success: doctor.ok,
        installed,
        updated,
        command: detected.label,
        current_version: currentVersion,
        latest_version: latestVersion,
        actions,
        doctor,
        details,
    };
}

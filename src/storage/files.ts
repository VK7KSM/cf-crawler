import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function persistJson(path: string, payload: unknown): Promise<void> {
    const finalPath = resolve(path);
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, JSON.stringify(payload, null, 2), "utf8");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
    operation: () => Promise<T>,
    retries = 2,
    baseBackoffMs = 400,
): Promise<{ value: T; retries: number }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const value = await operation();
            return { value, retries: attempt };
        } catch (error) {
            lastErr = error;
            if (attempt < retries) {
                await sleep(baseBackoffMs * (attempt + 1));
            }
        }
    }

    throw lastErr;
}

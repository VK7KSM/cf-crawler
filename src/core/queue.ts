export interface QueueNode {
    url: string;
    depth: number;
}

export class UrlQueue {
    private readonly values: QueueNode[] = [];

    enqueue(value: QueueNode): void {
        this.values.push(value);
    }

    dequeue(): QueueNode | undefined {
        return this.values.shift();
    }

    get size(): number {
        return this.values.length;
    }
}

export interface SignalConnection {
    object: any;
    id: number;
}

export function connectSignal(
    connections: SignalConnection[],
    object: any,
    signal: string,
    callback: (...args: any[]) => void,
): void {
    connections.push({object, id: object.connect(signal, callback)});
}

export function disconnectSignals(connections: SignalConnection[]): void {
    for (const connection of connections)
        connection.object.disconnect(connection.id);
    connections.length = 0;
}

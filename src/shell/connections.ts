import type GObject from 'gi://GObject';

export interface SignalConnection {
    object: Pick<GObject.Object, 'disconnect'>;
    id: number;
}

export function disconnectSignals(connections: SignalConnection[]): void {
    for (const connection of connections)
        connection.object.disconnect(connection.id);
    connections.length = 0;
}

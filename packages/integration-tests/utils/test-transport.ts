import {
  ConnectionStatus,
  SyncTransport,
  TransportConnectParams,
} from '@triplit/client';
import { logger } from '@triplit/logger';
import {
  Server as TriplitServer,
  SyncConnection,
  ClientSyncMessage,
  CloseReason,
} from '@triplit/server-core';

logger.registerHandler({
  log: (record) => {
    if (record.level === 'ERROR') {
      console.dir(record, { depth: 12 });
    }
    // console.dir(record, { depth: 12 });
  },
  startSpan: () => {},
  endSpan: () => {},
  recordMetric: () => {},
});

export class TestTransport implements SyncTransport {
  private connection: SyncConnection | null = null;
  onMessageCallback: ((evt: any) => any) | null = null;
  onOpenCallback: ((evt: any) => any) | null = null;
  onCloseCallback: ((evt: any) => any) | null = null;
  onErrorCallback: ((evt: any) => any) | null = null;
  onConnectionChangeCallback: ((state: ConnectionStatus) => void) | null = null;
  connectionStatus: ConnectionStatus = 'UNINITIALIZED';

  private removeConnectionListener: (() => void) | undefined;

  constructor(
    public server: TriplitServer,
    public latency: number = 0
  ) {}
  get isOpen() {
    return this.connectionStatus === 'OPEN';
  }
  async connect(params: TransportConnectParams) {
    // simulate network connection, allow sync engine listeners to mount
    simulateNetwork(() => {
      const { syncSchema, token, schema } = params;
      const parsedToken = parseJWT(token);
      this.connection = this.server.openConnection(parsedToken, {
        clientSchemaHash: schema,
        syncSchema,
      });
      this.removeConnectionListener = this.connection.addListener(
        (messageType, payload) => {
          // @ts-expect-error type is {}
          const error = payload.error;
          if (error) logger.error(error);
          this.onMessageCallback &&
            this.onMessageCallback({
              data: JSON.stringify({ type: messageType, payload }),
            });
        }
      );
      // NOTE: this is async
      // Will perform messaging handshake and start syncing
      // TODO: should probably do this after `this.setIsOpen(true);`
      this.setIsOpen(true);
      this.connection.start();
    }, this.latency);
  }

  /**
   * Sets the state of the websocket connection (not any syncing state)
   */
  private setIsOpen(open: boolean, event?: any) {
    this.connectionStatus = open ? 'OPEN' : 'CLOSED';
    if (this.connectionStatus === 'OPEN') {
      this.onOpenCallback && this.onOpenCallback(event);
    }
    if (this.connectionStatus === 'CLOSED') {
      this.onCloseCallback && this.onCloseCallback(event);
    }
    this.onConnectionChangeCallback &&
      this.onConnectionChangeCallback(this.connectionStatus);
  }

  onOpen(callback: (ev: any) => void): void {
    this.onOpenCallback = callback;
  }

  sendMessage(message: ClientSyncMessage): boolean {
    if (!this.isOpen) {
      return false;
    }
    if (!this.connection) {
      return false;
    }
    simulateNetwork(
      () => this.connection!.dispatchCommand(message),
      this.latency
    );
    return true;
  }

  onMessage(callback: (message: any) => void): void {
    this.onMessageCallback = callback;
  }

  onError(callback: (ev: any) => void): void {
    this.onErrorCallback = callback;
  }

  onClose(callback: (ev: any) => void): void {
    this.onCloseCallback = callback;
  }

  onConnectionChange(callback: (state: ConnectionStatus) => void): void {
    this.onConnectionChangeCallback = callback;
  }

  close(reason?: CloseReason) {
    if (!this.connection) return;
    this.removeConnectionListener?.();
    this.server.closeConnection(this.connection);
    this.setIsOpen(false, {
      reason: JSON.stringify(reason),
    });
  }
}

function parseJWT(token: string | undefined) {
  if (!token) throw new Error('No token provided');
  let base64Url = token.split('.')[1];
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  let jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join('')
  );
  return JSON.parse(jsonPayload);
}

function simulateNetwork(callback: () => void, latency: number) {
  setTimeout(callback, latency);
}

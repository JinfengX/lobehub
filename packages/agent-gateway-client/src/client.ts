import type {
  AgentEventMessage,
  AgentGatewayClientEvents,
  ClientMessage,
  ConnectionStatus,
  ErrorMessage,
  InputRequestMessage,
  ServerMessage,
  SessionCompleteMessage,
  StatusChangeMessage,
  ToolConfirmationRequestMessage,
} from './types';

// ─── Constants ───

const HEARTBEAT_INTERVAL = 30_000; // 30s
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30_000; // 30s

// ─── Minimal EventEmitter for Browser ───

type Listener = (...args: any[]) => void;

class BrowserEventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: any[]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        listener(...args);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

// ─── Client Options ───

export interface AgentGatewayClientOptions {
  /** Auto-reconnect on disconnection (default: true) */
  autoReconnect?: boolean;
  /** Gateway base URL (e.g. https://agent-gateway.lobehub.com) */
  gatewayUrl: string;
  /** JWT token for authentication */
  token: string;
}

// ─── Agent Gateway Client ───

export class AgentGatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private status: ConnectionStatus = 'disconnected';
  private intentionalDisconnect = false;

  private chatKey = '';
  private lastEventId: string | undefined;

  private gatewayUrl: string;
  private token: string;
  private autoReconnect: boolean;

  private emitter = new BrowserEventEmitter();

  constructor(options: AgentGatewayClientOptions) {
    this.gatewayUrl = options.gatewayUrl;
    this.token = options.token;
    this.autoReconnect = options.autoReconnect ?? true;
  }

  // ─── Public API ───

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  on<K extends keyof AgentGatewayClientEvents>(
    event: K,
    listener: AgentGatewayClientEvents[K],
  ): void {
    this.emitter.on(event, listener as Listener);
  }

  off<K extends keyof AgentGatewayClientEvents>(
    event: K,
    listener: AgentGatewayClientEvents[K],
  ): void {
    this.emitter.off(event, listener as Listener);
  }

  /**
   * Connect to a specific agent session.
   */
  connect(chatKey: string): void {
    if (this.status === 'connected' || this.status === 'connecting') return;

    this.chatKey = chatKey;
    this.intentionalDisconnect = false;
    this.doConnect();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cleanup();
    this.setStatus('disconnected');
  }

  /**
   * Update the auth token (e.g. after refresh).
   */
  updateToken(token: string): void {
    this.token = token;
  }

  // ─── Client → Server Commands ───

  sendInterrupt(): void {
    this.send({ type: 'interrupt' });
  }

  sendToolConfirmation(toolCallId: string, approved: boolean): void {
    this.send({ approved, toolCallId, type: 'tool_confirmation' });
  }

  sendUserInput(requestId: string, content: string): void {
    this.send({ content, requestId, type: 'user_input' });
  }

  // ─── Connection Logic ───

  private doConnect(): void {
    this.clearReconnectTimer();
    this.setStatus('connecting');

    try {
      const wsUrl = this.buildWsUrl();
      const ws = new WebSocket(wsUrl);

      ws.addEventListener('open', this.handleOpen);
      ws.addEventListener('message', this.handleMessage);
      ws.addEventListener('close', this.handleClose);
      ws.addEventListener('error', this.handleError);

      this.ws = ws;
    } catch {
      this.setStatus('disconnected');
      if (this.autoReconnect) {
        this.scheduleReconnect();
      } else {
        this.emitter.emit('disconnected');
      }
    }
  }

  private buildWsUrl(): string {
    const wsProtocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.gatewayUrl.replace(/^https?:\/\//, '');
    const params = new URLSearchParams({ chatKey: this.chatKey });
    return `${wsProtocol}://${host}/ws?${params.toString()}`;
  }

  // ─── WebSocket Event Handlers ───

  private handleOpen = (): void => {
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.setStatus('authenticating');

    // Authenticate
    this.send({ token: this.token, type: 'auth' });
  };

  private handleMessage = (ev: MessageEvent): void => {
    try {
      const message = JSON.parse(ev.data as string) as ServerMessage;

      switch (message.type) {
        case 'auth_success': {
          this.setStatus('connected');
          this.startHeartbeat();
          this.emitter.emit('connected');

          // Resume from last event if reconnecting
          if (this.lastEventId) {
            this.send({ lastEventId: this.lastEventId, type: 'resume' });
          }
          break;
        }

        case 'auth_failed': {
          this.emitter.emit('auth_failed', message.reason);
          this.disconnect();
          break;
        }

        case 'heartbeat_ack': {
          break;
        }

        case 'agent_event': {
          this.lastEventId = message.id;
          this.emitter.emit('agent_event', message as AgentEventMessage);
          break;
        }

        case 'status_change': {
          this.lastEventId = message.id;
          this.emitter.emit('status_update', message as StatusChangeMessage);
          break;
        }

        case 'tool_confirmation_request': {
          this.lastEventId = message.id;
          this.emitter.emit('tool_confirmation_request', message as ToolConfirmationRequestMessage);
          break;
        }

        case 'input_request': {
          this.lastEventId = message.id;
          this.emitter.emit('input_request', message as InputRequestMessage);
          break;
        }

        case 'session_complete': {
          this.lastEventId = message.id;
          this.emitter.emit('session_complete', message as SessionCompleteMessage);
          break;
        }

        case 'error': {
          this.lastEventId = (message as ErrorMessage).id;
          this.emitter.emit('error', new Error((message as ErrorMessage).message));
          break;
        }
      }
    } catch {
      // Ignore malformed messages
    }
  };

  private handleClose = (): void => {
    this.stopHeartbeat();
    this.ws = null;

    if (!this.intentionalDisconnect && this.autoReconnect) {
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    } else {
      this.setStatus('disconnected');
      this.emitter.emit('disconnected');
    }
  };

  private handleError = (ev: Event): void => {
    this.emitter.emit('error', ev);
  };

  // ─── Heartbeat ───

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Reconnection (exponential backoff) ───

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = this.reconnectDelay;
    this.emitter.emit('reconnecting', delay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);

    // Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Status ───

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emitter.emit('status_changed', status);
  }

  // ─── Helpers ───

  private send(data: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.removeEventListener('open', this.handleOpen);
      this.ws.removeEventListener('message', this.handleMessage);
      this.ws.removeEventListener('close', this.handleClose);
      this.ws.removeEventListener('error', this.handleError);

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }

    this.emitter.removeAllListeners();
  }
}

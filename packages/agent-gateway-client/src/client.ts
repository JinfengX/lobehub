import type {
  AgentEventMessage,
  AgentGatewayClientEvents,
  ClientMessage,
  ConnectionStatus,
  ErrorMessage,
  IAgentGatewayClient,
  InputRequestMessage,
  ServerMessage,
  SessionCompleteMessage,
  StatusChangeMessage,
  ToolConfirmationRequestMessage,
} from './types';

// ─── Constants ───

const HEARTBEAT_INTERVAL = 30_000; // 30s
const HEARTBEAT_TIMEOUT = 10_000; // 10s — if no ack within this window, consider dead
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30_000; // 30s
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

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
  /** Max reconnect attempts before giving up (default: 10, 0 = unlimited) */
  maxReconnectAttempts?: number;
  /** JWT token for authentication */
  token: string;
}

// ─── Agent Gateway Client ───

export class AgentGatewayClient implements IAgentGatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAckTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectAttempts = 0;
  private status: ConnectionStatus = 'disconnected';
  private intentionalDisconnect = false;

  private chatKey = '';
  private lastEventId: string | undefined;

  private gatewayUrl: string;
  private token: string;
  private autoReconnect: boolean;
  private maxReconnectAttempts: number;

  private emitter = new BrowserEventEmitter();

  constructor(options: AgentGatewayClientOptions) {
    this.gatewayUrl = options.gatewayUrl;
    this.token = options.token;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
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
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cleanupConnection();
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
    this.reconnectAttempts = 0;
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
          this.clearHeartbeatAckTimer();
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
    } catch (error) {
      console.warn('[AgentGatewayClient] Failed to parse message:', error);
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
      this.startHeartbeatAckTimer();
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatAckTimer();
  }

  private startHeartbeatAckTimer(): void {
    this.clearHeartbeatAckTimer();
    this.heartbeatAckTimer = setTimeout(() => {
      // No ack received — connection is likely dead
      console.warn('[AgentGatewayClient] Heartbeat ack timeout, closing connection');
      this.ws?.close(4000, 'Heartbeat timeout');
    }, HEARTBEAT_TIMEOUT);
  }

  private clearHeartbeatAckTimer(): void {
    if (this.heartbeatAckTimer) {
      clearTimeout(this.heartbeatAckTimer);
      this.heartbeatAckTimer = null;
    }
  }

  // ─── Reconnection (exponential backoff) ───

  private scheduleReconnect(): void {
    // Check max attempts (0 = unlimited)
    if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        `[AgentGatewayClient] Max reconnect attempts (${this.maxReconnectAttempts}) reached`,
      );
      this.setStatus('disconnected');
      this.emitter.emit('disconnected');
      this.emitter.emit('error', new Error('Max reconnect attempts reached'));
      return;
    }

    this.clearReconnectTimer();
    this.reconnectAttempts++;

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

  /**
   * Send a message to the gateway. Returns false if the socket is not open.
   */
  private send(data: ClientMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /**
   * Clean up WebSocket connection and timers, but preserve emitter listeners.
   * Emitter listeners are registered by the consumer and should survive reconnects.
   */
  private cleanupConnection(): void {
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
  }

  /**
   * Full cleanup including emitter listeners. Call only when the client is being disposed.
   */
  dispose(): void {
    this.disconnect();
    this.emitter.removeAllListeners();
  }
}

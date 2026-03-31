import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentGatewayClient } from '../client';
import type { ServerMessage } from '../types';

// ─── WebSocket Mock ───

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  private eventListeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(url: string) {
    this.url = url;
    // Simulate async open via microtask (not affected by fake timers)
    Promise.resolve().then(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.dispatchEvent('open');
      }
    });
  }

  addEventListener(event: string, listener: (...args: any[]) => void): void {
    let set = this.eventListeners.get(event);
    if (!set) {
      set = new Set();
      this.eventListeners.set(event, set);
    }
    set.add(listener);
  }

  removeEventListener(event: string, listener: (...args: any[]) => void): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  send = vi.fn();

  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent('close', { code, reason });
  });

  // Test helpers
  dispatchEvent(event: string, data?: any): void {
    const set = this.eventListeners.get(event);
    if (set) {
      for (const listener of set) {
        listener(data || {});
      }
    }
  }

  simulateMessage(message: ServerMessage): void {
    this.dispatchEvent('message', { data: JSON.stringify(message) });
  }
}

let mockWsInstances: MockWebSocket[] = [];

beforeEach(() => {
  mockWsInstances = [];
  vi.stubGlobal(
    'WebSocket',
    Object.assign(
      class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          mockWsInstances.push(this);
        }
      },
      {
        CONNECTING: MockWebSocket.CONNECTING,
        OPEN: MockWebSocket.OPEN,
        CLOSING: MockWebSocket.CLOSING,
        CLOSED: MockWebSocket.CLOSED,
      },
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const createClient = (overrides?: Partial<ConstructorParameters<typeof AgentGatewayClient>[0]>) =>
  new AgentGatewayClient({
    gatewayUrl: 'https://gateway.example.com',
    token: 'test-token',
    ...overrides,
  });

const getLastWs = () => mockWsInstances.at(-1)!;

describe('AgentGatewayClient', () => {
  describe('constructor', () => {
    it('should initialize with disconnected status', () => {
      const client = createClient();
      expect(client.connectionStatus).toBe('disconnected');
    });
  });

  describe('connect', () => {
    it('should create WebSocket with correct URL', () => {
      const client = createClient();
      client.connect('test-chat-key');

      const ws = getLastWs();
      expect(ws.url).toBe('wss://gateway.example.com/ws?chatKey=test-chat-key');
    });

    it('should use ws:// for http:// gateway URLs', () => {
      const client = createClient({ gatewayUrl: 'http://localhost:8080' });
      client.connect('key');

      const ws = getLastWs();
      expect(ws.url).toBe('ws://localhost:8080/ws?chatKey=key');
    });

    it('should set status to connecting', () => {
      const client = createClient();
      client.connect('key');
      expect(client.connectionStatus).toBe('connecting');
    });

    it('should not create multiple connections', () => {
      const client = createClient();
      client.connect('key');
      client.connect('key'); // second call should be no-op

      expect(mockWsInstances).toHaveLength(1);
    });

    it('should send auth message on open', async () => {
      const client = createClient();
      client.connect('key');

      // Wait for async open
      await vi.waitFor(() => {
        expect(getLastWs().send).toHaveBeenCalledWith(
          JSON.stringify({ token: 'test-token', type: 'auth' }),
        );
      });
    });

    it('should set status to authenticating on open', async () => {
      const client = createClient();
      client.connect('key');

      await vi.waitFor(() => {
        expect(client.connectionStatus).toBe('authenticating');
      });
    });
  });

  describe('authentication', () => {
    it('should emit connected and set status on auth_success', async () => {
      const client = createClient();
      const connectedHandler = vi.fn();
      client.on('connected', connectedHandler);
      client.connect('key');

      await vi.waitFor(() => {
        expect(client.connectionStatus).toBe('authenticating');
      });

      getLastWs().simulateMessage({ type: 'auth_success' });

      expect(client.connectionStatus).toBe('connected');
      expect(connectedHandler).toHaveBeenCalledOnce();
    });

    it('should emit auth_failed and disconnect on auth_failed', async () => {
      const client = createClient();
      const authFailedHandler = vi.fn();
      client.on('auth_failed', authFailedHandler);
      client.connect('key');

      await vi.waitFor(() => {
        expect(client.connectionStatus).toBe('authenticating');
      });

      getLastWs().simulateMessage({ type: 'auth_failed', reason: 'Invalid token' });

      expect(authFailedHandler).toHaveBeenCalledWith('Invalid token');
      expect(client.connectionStatus).toBe('disconnected');
    });
  });

  describe('disconnect', () => {
    it('should close WebSocket and set status to disconnected', async () => {
      const client = createClient();
      client.connect('key');

      await vi.waitFor(() => {
        expect(client.connectionStatus).toBe('authenticating');
      });

      client.disconnect();

      expect(client.connectionStatus).toBe('disconnected');
      expect(getLastWs().close).toHaveBeenCalledWith(1000, 'Client disconnect');
    });

    it('should preserve event listeners after disconnect', async () => {
      const client = createClient();
      const handler = vi.fn();
      client.on('connected', handler);

      client.connect('key');
      await vi.waitFor(() => expect(client.connectionStatus).toBe('authenticating'));

      client.disconnect();

      // Re-connect and verify handler still works
      client.connect('key2');
      await vi.waitFor(() => expect(client.connectionStatus).toBe('authenticating'));

      getLastWs().simulateMessage({ type: 'auth_success' });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('dispose', () => {
    it('should disconnect and remove all listeners', async () => {
      const client = createClient();
      const handler = vi.fn();
      client.on('connected', handler);

      client.connect('key');
      await vi.waitFor(() => expect(client.connectionStatus).toBe('authenticating'));

      client.dispose();
      expect(client.connectionStatus).toBe('disconnected');
    });
  });

  describe('event handling', () => {
    const setupConnectedClient = async () => {
      const client = createClient();
      client.connect('key');
      await vi.waitFor(() => expect(client.connectionStatus).toBe('authenticating'));
      getLastWs().simulateMessage({ type: 'auth_success' });
      expect(client.connectionStatus).toBe('connected');
      return client;
    };

    it('should emit agent_event', async () => {
      const client = await setupConnectedClient();
      const handler = vi.fn();
      client.on('agent_event', handler);

      const msg = {
        type: 'agent_event' as const,
        id: 'evt-1',
        event: { kind: 'text_delta' as const, content: 'hello' },
      };
      getLastWs().simulateMessage(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should emit tool_confirmation_request', async () => {
      const client = await setupConnectedClient();
      const handler = vi.fn();
      client.on('tool_confirmation_request', handler);

      const msg = {
        type: 'tool_confirmation_request' as const,
        id: 'evt-2',
        toolCallId: 'tc-1',
        tool: { apiName: 'test', arguments: '{}', identifier: 'test', name: 'test' },
      };
      getLastWs().simulateMessage(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should emit input_request', async () => {
      const client = await setupConnectedClient();
      const handler = vi.fn();
      client.on('input_request', handler);

      const msg = {
        type: 'input_request' as const,
        id: 'evt-3',
        requestId: 'req-1',
        prompt: 'Enter value',
      };
      getLastWs().simulateMessage(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should emit session_complete', async () => {
      const client = await setupConnectedClient();
      const handler = vi.fn();
      client.on('session_complete', handler);

      const msg = {
        type: 'session_complete' as const,
        id: 'evt-4',
        summary: 'Done',
      };
      getLastWs().simulateMessage(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should emit error for error messages', async () => {
      const client = await setupConnectedClient();
      const handler = vi.fn();
      client.on('error', handler);

      getLastWs().simulateMessage({
        type: 'error',
        id: 'evt-5',
        code: 'ERR',
        message: 'Something failed',
      });

      expect(handler).toHaveBeenCalledWith(expect.any(Error));
      expect((handler.mock.calls[0][0] as Error).message).toBe('Something failed');
    });

    it('should warn on malformed messages instead of silently ignoring', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = await setupConnectedClient();

      getLastWs().dispatchEvent('message', { data: 'not json' });

      expect(warnSpy).toHaveBeenCalledWith(
        '[AgentGatewayClient] Failed to parse message:',
        expect.any(Error),
      );
    });
  });

  describe('client commands', () => {
    it('should send interrupt message', async () => {
      const client = createClient();
      client.connect('key');
      await vi.waitFor(() => expect(client.connectionStatus).toBe('authenticating'));

      // Make ws OPEN
      const ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.send.mockClear();

      client.sendInterrupt();
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'interrupt' }));
    });

    it('should send tool confirmation', async () => {
      const client = createClient();
      client.connect('key');
      const ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.send.mockClear();

      client.sendToolConfirmation('tc-1', true);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ approved: true, toolCallId: 'tc-1', type: 'tool_confirmation' }),
      );
    });

    it('should send user input', async () => {
      const client = createClient();
      client.connect('key');
      const ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.send.mockClear();

      client.sendUserInput('req-1', 'user response');
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ content: 'user response', requestId: 'req-1', type: 'user_input' }),
      );
    });

    it('should not throw when sending on closed socket', () => {
      // Don't connect — socket is null
      expect(() => createClient().sendInterrupt()).not.toThrow();
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat after auth_success', async () => {
      vi.useFakeTimers();
      const client = createClient();
      client.connect('key');

      const ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');
      ws.simulateMessage({ type: 'auth_success' });

      ws.send.mockClear();

      // Advance past heartbeat interval
      vi.advanceTimersByTime(30_000);

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'heartbeat' }));
    });

    it('should close connection on heartbeat ack timeout', async () => {
      vi.useFakeTimers();
      const client = createClient();
      client.connect('key');

      const ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');
      ws.simulateMessage({ type: 'auth_success' });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Send heartbeat
      vi.advanceTimersByTime(30_000);
      // Don't send ack — wait for timeout
      vi.advanceTimersByTime(10_000);

      expect(ws.close).toHaveBeenCalledWith(4000, 'Heartbeat timeout');
      warnSpy.mockRestore();
    });

    it('should clear ack timer on heartbeat_ack', async () => {
      vi.useFakeTimers();
      const client = createClient();
      client.connect('key');

      const ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');
      ws.simulateMessage({ type: 'auth_success' });

      // Send heartbeat
      vi.advanceTimersByTime(30_000);
      // Ack received
      ws.simulateMessage({ type: 'heartbeat_ack' });
      // Advance past timeout — should NOT close
      vi.advanceTimersByTime(10_000);

      // close should not have been called (only from our test, not from timeout)
      expect(ws.close).not.toHaveBeenCalled();
    });
  });

  describe('reconnection', () => {
    it('should reconnect on unexpected close', async () => {
      vi.useFakeTimers();
      const client = createClient();
      const reconnectHandler = vi.fn();
      client.on('reconnecting', reconnectHandler);

      client.connect('key');
      const ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');
      ws.simulateMessage({ type: 'auth_success' });

      // Simulate unexpected close
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');

      expect(client.connectionStatus).toBe('reconnecting');
      expect(reconnectHandler).toHaveBeenCalledWith(1000); // initial delay

      // Advance to trigger reconnect
      vi.advanceTimersByTime(1000);
      expect(mockWsInstances).toHaveLength(2);
    });

    it('should use exponential backoff', async () => {
      vi.useFakeTimers();
      const client = createClient({ maxReconnectAttempts: 0 }); // unlimited
      const delays: number[] = [];
      client.on('reconnecting', (delay: number) => delays.push(delay));

      client.connect('key');

      // First WS opens, auth succeeds, then closes unexpectedly
      let ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');
      ws.simulateMessage({ type: 'auth_success' });

      // Close triggers reconnect with delay[0]
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');
      vi.advanceTimersByTime(delays.at(-1)!);

      // Second WS - close again
      ws = getLastWs();
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');
      vi.advanceTimersByTime(delays.at(-1)!);

      // Third WS - close again
      ws = getLastWs();
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');
      vi.advanceTimersByTime(delays.at(-1)!);

      // Fourth WS - close again
      ws = getLastWs();
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');

      expect(delays).toEqual([1000, 2000, 4000, 8000]);
    });

    it('should stop after max reconnect attempts', async () => {
      vi.useFakeTimers();
      const client = createClient({ maxReconnectAttempts: 2 });
      const disconnectedHandler = vi.fn();
      const errorHandler = vi.fn();
      client.on('disconnected', disconnectedHandler);
      client.on('error', errorHandler);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      client.connect('key');

      // First WS opens and then closes
      let ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');
      ws.simulateMessage({ type: 'auth_success' });

      // Close -> reconnect attempt 1
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');
      vi.advanceTimersByTime(1000);

      // Second WS close -> reconnect attempt 2
      ws = getLastWs();
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');
      vi.advanceTimersByTime(2000);

      // Third WS close -> attempt 3, exceeds max (2)
      ws = getLastWs();
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');

      // Should stop reconnecting
      expect(client.connectionStatus).toBe('disconnected');
      expect(disconnectedHandler).toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Max reconnect attempts reached' }),
      );

      warnSpy.mockRestore();
    });

    it('should not reconnect on intentional disconnect', async () => {
      vi.useFakeTimers();
      const client = createClient();

      client.connect('key');
      const ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;

      client.disconnect();

      // Should not create new connections
      vi.advanceTimersByTime(60_000);
      expect(mockWsInstances).toHaveLength(1);
    });

    it('should not reconnect when autoReconnect is false', async () => {
      const client = createClient({ autoReconnect: false });
      const disconnectedHandler = vi.fn();
      client.on('disconnected', disconnectedHandler);

      client.connect('key');
      const ws = getLastWs();
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');

      expect(client.connectionStatus).toBe('disconnected');
      expect(disconnectedHandler).toHaveBeenCalled();
      expect(mockWsInstances).toHaveLength(1);
    });
  });

  describe('resume', () => {
    it('should send resume with lastEventId on reconnect', async () => {
      vi.useFakeTimers();
      const client = createClient();
      client.connect('key');

      let ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');
      ws.simulateMessage({ type: 'auth_success' });

      // Receive an event to set lastEventId
      ws.simulateMessage({
        type: 'agent_event',
        id: 'evt-99',
        event: { kind: 'text_delta', content: 'hi' },
      });

      // Simulate disconnect and reconnect
      ws.readyState = MockWebSocket.CLOSED;
      ws.dispatchEvent('close');
      vi.advanceTimersByTime(1000);

      ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');
      ws.simulateMessage({ type: 'auth_success' });

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ lastEventId: 'evt-99', type: 'resume' }),
      );
    });
  });

  describe('updateToken', () => {
    it('should use updated token on next auth', async () => {
      vi.useFakeTimers();
      const client = createClient({ token: 'old-token' });
      client.connect('key');

      let ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');

      // First auth uses old token
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ token: 'old-token', type: 'auth' }));

      // Update token and reconnect
      client.updateToken('new-token');
      ws.simulateMessage({ type: 'auth_failed', reason: 'expired' });

      // Reconnect with new token
      client.connect('key');
      ws = getLastWs();
      ws.readyState = MockWebSocket.OPEN;
      ws.dispatchEvent('open');

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ token: 'new-token', type: 'auth' }));
    });
  });
});

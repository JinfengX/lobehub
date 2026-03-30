// ─── Session State ───

export type SessionStatus =
  | 'completed'
  | 'error'
  | 'interrupted'
  | 'running'
  | 'waiting_confirmation'
  | 'waiting_input';

// ─── Agent Stream Events (pushed from backend via Gateway) ───

export type AgentStreamEvent =
  | { content: string; kind: 'text_delta' }
  | { content: string; kind: 'thinking' }
  | { kind: 'message_complete'; messageId: string }
  | { kind: 'step_complete'; stepIndex: number }
  | { arguments: string; kind: 'tool_call_delta'; toolCallId: string }
  | { kind: 'tool_call_end'; toolCallId: string }
  | { arguments: string; kind: 'tool_call_start'; name: string; toolCallId: string }
  | { kind: 'tool_result'; result: string; toolCallId: string };

export interface ToolCallInfo {
  apiName: string;
  arguments: string;
  identifier: string;
  name: string;
}

// ─── Client → Server Messages (Browser → Gateway) ───

export interface AuthMessage {
  token: string;
  type: 'auth';
}

export interface HeartbeatMessage {
  type: 'heartbeat';
}

export interface InterruptMessage {
  type: 'interrupt';
}

export interface ToolConfirmationMessage {
  approved: boolean;
  toolCallId: string;
  type: 'tool_confirmation';
}

export interface UserInputMessage {
  content: string;
  requestId: string;
  type: 'user_input';
}

export interface ResumeMessage {
  lastEventId: string;
  type: 'resume';
}

export type ClientMessage =
  | AuthMessage
  | HeartbeatMessage
  | InterruptMessage
  | ResumeMessage
  | ToolConfirmationMessage
  | UserInputMessage;

// ─── Server → Client Messages (Gateway → Browser) ───

export interface AuthSuccessMessage {
  type: 'auth_success';
}

export interface AuthFailedMessage {
  reason: string;
  type: 'auth_failed';
}

export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
}

export interface AgentEventMessage {
  event: AgentStreamEvent;
  id: string;
  type: 'agent_event';
}

export interface StatusChangeMessage {
  id: string;
  status: SessionStatus;
  type: 'status_change';
}

export interface ToolConfirmationRequestMessage {
  id: string;
  tool: ToolCallInfo;
  toolCallId: string;
  type: 'tool_confirmation_request';
}

export interface InputRequestMessage {
  id: string;
  prompt: string;
  requestId: string;
  type: 'input_request';
}

export interface SessionCompleteMessage {
  id: string;
  summary?: string;
  type: 'session_complete';
}

export interface ErrorMessage {
  code: string;
  id: string;
  message: string;
  type: 'error';
}

export type ServerMessage =
  | AgentEventMessage
  | AuthFailedMessage
  | AuthSuccessMessage
  | ErrorMessage
  | HeartbeatAckMessage
  | InputRequestMessage
  | SessionCompleteMessage
  | StatusChangeMessage
  | ToolConfirmationRequestMessage;

// ─── Client Types ───

export type ConnectionStatus =
  | 'authenticating'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting';

export interface AgentGatewayClientEvents {
  agent_event: (message: AgentEventMessage) => void;
  auth_failed: (reason: string) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Event | Error) => void;
  input_request: (message: InputRequestMessage) => void;
  reconnecting: (delay: number) => void;
  session_complete: (message: SessionCompleteMessage) => void;
  status_changed: (status: ConnectionStatus) => void;
  status_update: (message: StatusChangeMessage) => void;
  tool_confirmation_request: (message: ToolConfirmationRequestMessage) => void;
}

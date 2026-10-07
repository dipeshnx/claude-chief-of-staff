export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'complete';
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: number;
  due_date?: string;
  goal_alignment?: string;
  created?: string;
  notes?: string;
  [extra: string]: unknown;
}
export interface TasksFile { tasks: Task[]; [extra: string]: unknown }

export type GoalStatus = 'on_track' | 'at_risk' | 'behind' | 'complete';
export interface Objective {
  name: string;
  target?: string;
  priority?: number;
  key_results?: string[];
  progress?: number;
  status?: GoalStatus;
  notes?: string;
  [extra: string]: unknown;
}
export interface GoalsFile { quarter?: string; last_updated?: string; objectives: Objective[]; [extra: string]: unknown }

export interface Schedule { name: string; skill: string; frequency?: string; enabled?: boolean; notes?: string; [extra: string]: unknown }
export interface SchedulesFile { schedules: Schedule[]; [extra: string]: unknown }

export interface Versioned<T> { data: T; hash: string }

export type SectionKind = 'table' | 'fields' | 'raw';
export interface ContactSection { heading: string; kind: SectionKind; body: string; fields: [string, string][] }
export interface Contact { slug: string; title: string; preamble: string; sections: ContactSection[] }
export interface ContactSummary {
  slug: string;
  name: string;
  role: string | null;
  tier: number | null;
  lastInteraction: string | null;
  daysSince: number | null;
  stale: boolean;
}

export interface ChatRecord { id: string; sessionId: string | null; title: string; createdAt: string; lastUsedAt: string }

export interface ApprovalRequest {
  id: string;
  chatId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId?: string;
  createdAt: number;
}
export type ApprovalDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export type ChatEvent =
  | { type: 'user'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'turn_result'; sessionId: string | null; costUsd: number | null; durationMs: number | null; isError: boolean }
  | { type: 'status'; state: 'running' | 'idle' }
  | { type: 'error'; message: string; stderr: string[] };

export type FileKind = 'tasks' | 'goals' | 'schedules' | 'contacts';

export interface Health {
  claude: { found: boolean; version: string | null; error: string | null };
  files: Record<FileKind, boolean>;
}

export type ClientMsg =
  | { type: 'chat.send'; chatId?: string; text: string; clientRef?: string }
  | { type: 'chat.stop'; chatId: string }
  | { type: 'chat.open'; chatId: string }
  | { type: 'approval.decide'; id: string; allow: boolean; message?: string };

export type ServerMsg =
  | { type: 'chat.created'; chatId: string; clientRef?: string }
  | { type: 'chat.event'; chatId: string; event: ChatEvent }
  | { type: 'chat.history'; chatId: string; events: ChatEvent[]; running: boolean; resumed: boolean }
  | { type: 'approval.snapshot'; requests: ApprovalRequest[] }
  | { type: 'approval.request'; request: ApprovalRequest }
  | { type: 'approval.resolved'; id: string }
  | { type: 'file.changed'; kind: FileKind; name?: string }
  | { type: 'chats.changed' }
  | { type: 'error'; message: string };

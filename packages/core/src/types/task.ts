/**
 * A Task (Conduit extension): a named, time-boxed bundle of capability grants for an agent.
 *
 * Tasks implement least-privilege-by-default — an agent holds zero standing access; a task activates a
 * set of grants that auto-revoke on completion or when the task TTL elapses. Every execute/audit event is
 * labeled with the task, enabling attribution and replay.
 */
export type TaskStatus = 'active' | 'completed' | 'expired';

export interface Task {
  id: string;
  agentId: string;
  hostId: string;
  name: string;
  purpose: string | null;
  status: TaskStatus;
  expiresAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

/** urgent = Urgente, high = Importante (o banco só aceita essas duas) */
export type Priority = "urgent" | "high";
export type StatusType = "open" | "active" | "done" | "closed";
export type Role = "owner" | "admin" | "member" | "guest";
export type Recurrence = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export const RECURRENCES: { value: Recurrence; label: string; short: string }[] = [
  { value: "daily", label: "Todo dia", short: "diária" },
  { value: "weekdays", label: "Dias úteis (seg a sex)", short: "dias úteis" },
  { value: "weekly", label: "Toda semana", short: "semanal" },
  { value: "monthly", label: "Todo mês", short: "mensal" },
  { value: "yearly", label: "Todo ano", short: "anual" },
];

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
}

export interface Space {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  position: number;
  archived_at: string | null;
}

export interface List {
  id: string;
  workspace_id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
  position: number;
  archived_at: string | null;
}

export interface Status {
  id: string;
  list_id: string;
  name: string;
  color: string;
  type: StatusType;
  position: number;
}

export interface Task {
  id: string;
  list_id: string;
  parent_task_id: string | null;
  status_id: string | null;
  title: string;
  description: string | null;
  priority: Priority | null;
  start_date: string | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  /** Ao concluir, o banco cria a próxima com o prazo seguinte */
  recurrence: Recurrence | null;
  /** user_ids dos responsáveis (vem de task_assignees) */
  assignees: string[];
}

export interface Member {
  user_id: string;
  role: Role;
  email: string | null;
  full_name: string | null;
}

export function memberName(m: Pick<Member, "email" | "full_name"> | undefined): string {
  if (!m) return "Usuário";
  return m.full_name?.trim() || m.email?.split("@")[0] || "Usuário";
}

/** Linha do banco com o join task_assignees(user_id) -> Task */
export function toTask(row: Omit<Task, "assignees"> & { task_assignees?: { user_id: string }[] }): Task {
  const { task_assignees, ...rest } = row;
  return { ...rest, assignees: (task_assignees ?? []).map((a) => a.user_id) };
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  profiles: { email: string | null; full_name: string | null } | null;
}

export const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: "urgent", label: "Urgente", color: "#ef4444" },
  { value: "high", label: "Importante", color: "#f59e0b" },
];

/** Posição entre dois vizinhos (ordenação fracionária). */
export function positionBetween(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next! - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}

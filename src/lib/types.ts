export type Priority = "urgent" | "high" | "normal" | "low";
export type StatusType = "open" | "active" | "done" | "closed";

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
}

export interface List {
  id: string;
  workspace_id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
  position: number;
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
  { value: "high", label: "Alta", color: "#f59e0b" },
  { value: "normal", label: "Normal", color: "#3b82f6" },
  { value: "low", label: "Baixa", color: "#94a3b8" },
];

/** Posição entre dois vizinhos (ordenação fracionária). */
export function positionBetween(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next! - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}

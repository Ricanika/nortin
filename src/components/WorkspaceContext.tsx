"use client";

import { createContext, useContext } from "react";
import type { Member, Role, Workspace } from "@/lib/types";

interface WorkspaceCtx {
  workspace: Workspace;
  members: Member[];
  me: string;
  role: Role;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace fora do WorkspaceProvider");
  return ctx;
}

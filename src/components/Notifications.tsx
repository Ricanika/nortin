"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyDate } from "@/lib/dates";
import { memberName } from "@/lib/types";
import { useToast } from "./Toast";
import { useWorkspace } from "./WorkspaceContext";

const ASK_KEY = "hyak:notify-asked";

/**
 * Avisos do Windows (como no Teams): tarefa nova marcada para mim e mensagem nova no chat
 * de tarefa em que sou responsável. Funciona com o app aberto, mesmo minimizado ou em outra aba.
 * Com a aba em foco, vira um aviso dentro do app em vez do pop-up do Windows.
 */
export default function Notifications() {
  const { workspace, members, me } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const supabase = useMemo(() => createClient(), []);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [askHidden, setAskHidden] = useState(true);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return setPermission("unsupported");
    setPermission(Notification.permission);
    let asked = false;
    try {
      asked = localStorage.getItem(ASK_KEY) === "1";
    } catch {}
    setAskHidden(asked || Notification.permission !== "default");
  }, []);

  const notify = useCallback(
    (key: string, title: string, body: string, href: string) => {
      if (seen.current.has(key)) return;
      seen.current.add(key);
      const focused = document.visibilityState === "visible" && document.hasFocus();
      if (!focused && "Notification" in window && Notification.permission === "granted") {
        // tag igual: com o app aberto em várias abas, o Windows mostra um aviso só
        const n = new Notification(title, { body, tag: key, icon: "/icon-256.png", badge: "/badge-64.png" });
        n.onclick = () => {
          window.focus();
          router.push(href);
          n.close();
        };
      } else {
        toast(`${title}: ${body}`);
      }
    },
    [router, toast],
  );

  useEffect(() => {
    const nameOf = (id: string | null) => memberName(members.find((m) => m.user_id === id));

    const channel = supabase
      .channel(`notify:${workspace.id}:${me}`)
      // Tarefa marcada para mim
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_assignees", filter: `user_id=eq.${me}` }, async (payload) => {
        const taskId = (payload.new as { task_id: string }).task_id;
        const { data: t } = await supabase
          .from("tasks")
          .select("id, title, due_date, priority, list_id, created_by, created_at, requester_name, lists(name)")
          .eq("id", taskId)
          .maybeSingle();
        if (!t) return;
        // Eu mesmo criei e me marquei agora: não precisa avisar
        if (t.created_by === me && Date.now() - new Date(t.created_at).getTime() < 60_000) return;
        const who = t.requester_name ? `${t.requester_name} (briefing)` : t.created_by && t.created_by !== me ? nameOf(t.created_by) : null;
        const parts = [
          t.priority === "urgent" ? "🔴 URGENTE" : t.priority === "high" ? "🟠 Importante" : null,
          t.due_date ? `prazo ${friendlyDate(t.due_date)}` : null,
          (t.lists as unknown as { name: string } | null)?.name ?? null,
          who ? `de ${who}` : null,
        ].filter(Boolean);
        notify(`task:${t.id}`, `📋 Nova tarefa: ${t.title}`, parts.join(" · "), `/w/${workspace.id}/l/${t.list_id}?t=${t.id}`);
      })
      // Mensagem no chat de tarefa em que sou responsável
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments", filter: `workspace_id=eq.${workspace.id}` }, async (payload) => {
        const c = payload.new as { id: string; task_id: string; author_id: string; body: string };
        if (c.author_id === me) return;
        const { data: mine } = await supabase.from("task_assignees").select("task_id").eq("task_id", c.task_id).eq("user_id", me).maybeSingle();
        if (!mine) return;
        const { data: t } = await supabase.from("tasks").select("title, list_id").eq("id", c.task_id).maybeSingle();
        if (!t) return;
        const text = c.body.length > 140 ? `${c.body.slice(0, 137)}…` : c.body;
        notify(`chat:${c.id}`, `💬 ${nameOf(c.author_id)} em "${t.title}"`, text, `/w/${workspace.id}/l/${t.list_id}?t=${c.task_id}`);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, workspace.id, me, members, notify]);

  async function enable() {
    try {
      localStorage.setItem(ASK_KEY, "1");
    } catch {}
    const result = await Notification.requestPermission();
    setPermission(result);
    setAskHidden(true);
    if (result === "granted") {
      new Notification("🔔 Avisos ativados", { body: "Você vai ver aqui quando marcarem você numa tarefa.", icon: "/icon-256.png" });
    } else {
      toast("Avisos bloqueados. Para ativar depois: cadeado ao lado do endereço do site → Notificações → Permitir.");
    }
  }

  if (askHidden || permission !== "default") return null;
  return (
    <div
      className="fixed z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-white p-4 shadow-xl"
      style={{ left: "max(1rem, env(safe-area-inset-left))", bottom: "max(1rem, env(safe-area-inset-bottom))" }}
      role="dialog"
      aria-label="Ativar avisos"
    >
      <p className="text-sm font-semibold text-slate-800">🔔 Receber avisos no Windows?</p>
      <p className="mt-1 text-xs text-slate-500">
        Quando marcarem você numa tarefa ou mandarem mensagem no chat dela, aparece um aviso no canto da tela, como no Teams.
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => void enable()} className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700">
          Ativar avisos
        </button>
        <button
          onClick={() => {
            try {
              localStorage.setItem(ASK_KEY, "1");
            } catch {}
            setAskHidden(true);
          }}
          className="px-2 text-sm text-slate-500 hover:text-slate-800"
        >
          Agora não
        </button>
      </div>
    </div>
  );
}

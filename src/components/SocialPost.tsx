"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { contentTotals, DEFAULT_NETWORKS, fmtNum, interactions, networkOf, type MediaItem, type SocialChannel } from "@/lib/social";
import { EngagementValue, ImpressionsInput } from "./ContentMetrics";
import NetworkBadge from "./NetworkBadge";
import type { Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";
import { useWorkspace } from "./WorkspaceContext";

interface Account {
  id: string;
  name: string;
  platform: string;
  avatar: string | null;
  connected: boolean;
}

const POST_TYPES: { value: Task["post_type"]; label: string }[] = [
  { value: "post", label: "Post" },
  { value: "reel", label: "Reels / vídeo curto" },
  { value: "story", label: "Stories" },
];

const STATUS: Record<SocialChannel["status"], { label: string; cls: string }> = {
  scheduled: { label: "⏳ Agendado", cls: "bg-cyan-50 text-cyan-700" },
  published: { label: "✅ Publicado", cls: "bg-emerald-50 text-emerald-700" },
  failed: { label: "❌ Erro", cls: "bg-red-50 text-red-700" },
};


const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** datetime-local no fuso do navegador */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Seção "Publicação" do post numa lista de conteúdo: compõe, envia ao GHL e acompanha cada rede. */
export default function SocialPost({
  task,
  channels,
  actions,
}: {
  task: Task;
  channels: SocialChannel[];
  actions: TaskActions;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { workspace } = useWorkspace();
  const sent = channels.length > 0;

  const [caption, setCaption] = useState(task.description ?? "");
  const [cta, setCta] = useState(task.cta_url ?? "");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<"schedule" | "now">("schedule");
  const [publishAt, setPublishAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    d.setHours(10, 0, 0, 0);
    return localInput(d);
  });
  const [uploading, setUploading] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cancelMode, setCancelMode] = useState<null | "cancel" | "edit">(null);
  const [cancelling, setCancelling] = useState(false);
  // Ao "Alterar", o formulário volta com as mesmas redes que estavam agendadas
  const keepAccounts = useRef<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Redes conectadas no GHL da marca; por padrão marca as 5 do fluxo que estiverem conectadas
  useEffect(() => {
    if (sent) return;
    fetch(`/api/social/accounts?listId=${task.list_id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setAccountsError(j.error);
        const rank = (p: string) => (DEFAULT_NETWORKS.includes(p) ? DEFAULT_NETWORKS.indexOf(p) : 99);
        const list = (j.accounts as Account[]).sort((a, b) => rank(a.platform) - rank(b.platform));
        setAccounts(list);
        const keep = keepAccounts.current;
        setSelected(
          new Set(
            list
              .filter((a) => a.connected && (keep ? keep.includes(a.id) : DEFAULT_NETWORKS.includes(a.platform)))
              .map((a) => a.id),
          ),
        );
        keepAccounts.current = null;
      })
      .catch(() => setAccountsError("Não deu para buscar as redes no GHL."));
  }, [task.list_id, sent]);

  const media = task.media ?? [];
  const hasVideo = media.some((m) => m.type.startsWith("video/"));

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const added: MediaItem[] = [];
    setUploading(files.length);
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
        setError(`"${file.name}" não é imagem nem vídeo.`);
        continue;
      }
      const safe = file.name.normalize("NFD").replace(/[^\w.-]+/g, "-").toLowerCase();
      const path = `${workspace.id}/${task.id}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("social-media").upload(path, file, { contentType: file.type });
      setUploading((n) => n - 1);
      if (upErr) {
        setError(`Não deu para enviar "${file.name}": ${upErr.message}`);
        continue;
      }
      const { data } = supabase.storage.from("social-media").getPublicUrl(path);
      added.push({ url: data.publicUrl, type: file.type, name: file.name });
    }
    setUploading(0);
    if (added.length) await actions.update(task.id, { media: [...media, ...added] });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removeMedia(item: MediaItem) {
    await actions.update(task.id, { media: media.filter((m) => m.url !== item.url) });
    const path = item.url.split("/social-media/")[1];
    if (path) await supabase.storage.from("social-media").remove([decodeURIComponent(path)]);
  }

  const chosen = (accounts ?? []).filter((a) => selected.has(a.id));
  const problems: string[] = [];
  if (!caption.trim() && !media.length) problems.push("Escreva o texto ou adicione mídia.");
  if (!chosen.length) problems.push("Escolha pelo menos uma rede.");
  if (chosen.some((a) => a.platform === "instagram") && !media.length) problems.push("O Instagram precisa de imagem ou vídeo.");
  const isStory = task.post_type === "story";
  if (isStory && chosen.some((a) => !["instagram", "facebook"].includes(a.platform)))
    problems.push("Stories só no Instagram e no Facebook: desmarque as outras redes ou mude o tipo para Post.");
  if (cta.trim() && !/^https?:\/\/\S+$/i.test(cta.trim())) problems.push("O link de CTA precisa começar com https://");
  const needVideo = chosen.filter((a) => a.platform === "youtube" || a.platform === "tiktok").map((a) => networkOf(a.platform).label);
  if (needVideo.length && !hasVideo) problems.push(`${needVideo.join(" e ")} precisa(m) de vídeo.`);
  if (when === "schedule" && new Date(publishAt).getTime() < Date.now() + 60 * 1000) problems.push("Escolha um horário no futuro.");

  async function send() {
    setBusy(true);
    setError(null);
    if (caption !== (task.description ?? "")) await actions.update(task.id, { description: caption });
    if (cta.trim() !== (task.cta_url ?? "")) await actions.update(task.id, { cta_url: cta.trim() || null });
    const res = await fetch("/api/social/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        accountIds: [...selected],
        when,
        publishAt: when === "schedule" ? new Date(publishAt).toISOString() : undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirming(false);
    if (!res.ok) return setError(json.error ?? "Não deu para enviar ao GHL.");
  }

  /** Cancela no GHL; em "edit", o formulário volta preenchido para reagendar. */
  async function cancelSchedule(mode: "cancel" | "edit") {
    setCancelling(true);
    setError(null);
    if (mode === "edit") {
      keepAccounts.current = channels.map((c) => c.ghl_account_id);
      if (task.publish_at) {
        setPublishAt(localInput(new Date(task.publish_at)));
        setWhen("schedule");
      }
    }
    const res = await fetch("/api/social/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    const json = await res.json().catch(() => ({}));
    setCancelling(false);
    setCancelMode(null);
    if (!res.ok) {
      keepAccounts.current = null;
      return setError(json.error ?? "Não deu para cancelar no GHL.");
    }
    if (json.published?.length) {
      setError(`Já publicado em ${json.published.map((p: string) => networkOf(p).label).join(", ")}: para tirar do ar, apague na própria rede.`);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    const res = await fetch("/api/social/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    const json = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) setError(json.error ?? "Não deu para atualizar.");
  }

  // ----- Depois de enviado: acompanhamento por rede -----
  if (sent) {
    const totals = contentTotals(channels);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Enviado ao GHL{task.publish_at ? ` · publicação ${fmtDateTime(task.publish_at)}` : ""} · 👁 {fmtNum(totals.impressions)} · ❤{" "}
            {totals.likes} · 💬 {totals.comments} · ↗ {totals.shares} · engaj. <EngagementValue value={totals.engagement} />
          </span>
          <button onClick={syncNow} disabled={syncing} className="rounded border px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {syncing ? "Atualizando…" : "🔄 Atualizar agora"}
          </button>
        </div>
        <ul className="divide-y rounded-lg border">
          {channels.map((c) => (
            <li key={c.platform} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <NetworkBadge platform={c.platform} />
              <span className="min-w-0 flex-1 truncate font-medium">{c.account_name ?? networkOf(c.platform).label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
              {c.link && (
                <a href={c.link} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-sky-700 hover:underline">
                  Abrir post ↗
                </a>
              )}
              {c.status === "published" && (
                <span className="flex w-full items-center gap-2 pl-8 text-xs tabular-nums text-slate-500">
                  <span className="flex items-center gap-1">
                    👁 <span className="w-20"><ImpressionsInput channel={c} /></span>
                  </span>
                  ❤ {c.likes} · 💬 {c.comments} · ↗ {c.shares} · engaj.{" "}
                  <EngagementValue value={c.impressions > 0 ? interactions(c) / c.impressions : null} />
                </span>
              )}
              {c.status === "failed" && c.error && <span className="w-full pl-8 text-xs text-red-600">{c.error}</span>}
            </li>
          ))}
        </ul>
        {channels.some((c) => c.status !== "published") &&
          (cancelMode ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="flex-1">
                {cancelMode === "edit"
                  ? "Para alterar, o agendamento atual é cancelado no GHL e o formulário volta preenchido para você reagendar. Continuar?"
                  : "Cancelar o agendamento em todas as redes ainda não publicadas? O post volta para Aprovação."}
              </span>
              <button
                onClick={() => void cancelSchedule(cancelMode)}
                disabled={cancelling}
                className="rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {cancelling ? "Cancelando…" : "Sim"}
              </button>
              <button onClick={() => setCancelMode(null)} className="px-2 text-amber-800">
                Não
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setCancelMode("edit")} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
                ✏️ Alterar
              </button>
              <button
                onClick={() => setCancelMode("cancel")}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                🚫 Cancelar agendamento
              </button>
            </div>
          ))}
        <p className="text-[11px] text-slate-400">
          Métricas do GHL (curtidas, comentários, compartilhamentos), atualizadas todo dia na 1ª semana, toda semana até 1 mês e depois
          1 vez por mês. Post já publicado sai do ar só apagando na própria rede.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  // ----- Antes de enviar: compor o post -----
  return (
    <div className="space-y-3 text-sm">
      <div>
        <label htmlFor={`caption-${task.id}`} className="mb-1 block text-xs font-medium text-slate-500">
          Texto do post
        </label>
        <textarea
          id={`caption-${task.id}`}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== (task.description ?? "") && actions.update(task.id, { description: caption })}
          rows={4}
          placeholder="Legenda, hashtags e chamada…"
          className="w-full rounded-lg border px-3 py-2 outline-none focus:border-violet-500"
        />
        <div className="text-right text-[11px] text-slate-400">{caption.length} caracteres</div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
          <span>Imagem ou vídeo</span>
          <select
            value={task.post_type}
            onChange={(e) => actions.update(task.id, { post_type: e.target.value as Task["post_type"] })}
            className="rounded border px-1.5 py-0.5 text-xs"
            aria-label="Tipo de post"
          >
            {POST_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {media.map((m) => (
            <div key={m.url} className="group relative h-20 w-20 overflow-hidden rounded-lg border bg-slate-100">
              {m.type.startsWith("video/") ? (
                <video src={m.url} className="h-full w-full object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.name ?? "mídia"} className="h-full w-full object-cover" />
              )}
              {m.type.startsWith("video/") && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">▶ vídeo</span>}
              <button
                onClick={() => void removeMedia(m)}
                aria-label="Remover"
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white group-hover:flex"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading > 0}
            className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed text-xs text-slate-500 hover:border-violet-400 hover:text-violet-700 disabled:opacity-50"
          >
            {uploading > 0 ? (
              "Enviando…"
            ) : (
              <>
                <span className="text-xl">＋</span>adicionar
              </>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
        </div>
      </div>

      {isStory && media.length > 1 && (
        <p className="rounded-md bg-violet-50 px-3 py-1.5 text-xs text-violet-800">
          📚 {media.length} stories em sequência, na ordem das imagens, com 1 minuto de diferença entre eles.
        </p>
      )}

      <div>
        <label htmlFor={`cta-${task.id}`} className="mb-1 block text-xs font-medium text-slate-500">
          🔗 Link (CTA) <span className="font-normal text-slate-400">· opcional</span>
        </label>
        <input
          id={`cta-${task.id}`}
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          onBlur={() => cta.trim() !== (task.cta_url ?? "") && actions.update(task.id, { cta_url: cta.trim() || null })}
          placeholder="https://www.nitron.com.br/promocao"
          inputMode="url"
          className="w-full rounded-lg border px-3 py-2 outline-none focus:border-violet-500"
        />
        {cta.trim() && (
          <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-slate-500">
            {isStory ? (
              <li>
                ⚠️ <b>Stories:</b> o adesivo de link só pode ser colocado pelo app do Instagram/Facebook no celular. Nenhuma integração
                consegue. O link fica salvo aqui para quem for colocar o adesivo.
              </li>
            ) : (
              <>
                <li>✅ Facebook, LinkedIn e YouTube: link no fim do texto, clicável.</li>
                <li>✅ Instagram: link no 1º comentário (a legenda avisa &quot;Link no primeiro comentário&quot;).</li>
                <li>➖ TikTok: link no texto, mas o TikTok não deixa clicar.</li>
              </>
            )}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-slate-500">Redes</div>
        {accountsError && <p className="text-xs text-red-600">{accountsError}</p>}
        {!accounts && !accountsError && <p className="text-xs text-slate-400">Buscando redes conectadas no GHL…</p>}
        <div className="flex flex-wrap gap-1.5">
          {accounts?.map((a) => {
            const on = selected.has(a.id);
            return (
              <button
                key={a.id}
                disabled={!a.connected}
                onClick={() =>
                  setSelected((prev) => {
                    const n = new Set(prev);
                    if (n.has(a.id)) n.delete(a.id);
                    else n.add(a.id);
                    return n;
                  })
                }
                title={a.connected ? a.name : "Desconectada no GHL: reconecte no Social Planner"}
                className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs ${
                  !a.connected ? "cursor-not-allowed opacity-40" : on ? "border-violet-500 bg-violet-50 font-semibold text-violet-700" : "hover:bg-slate-50"
                }`}
              >
                <NetworkBadge platform={a.platform} dim={!on} />
                {networkOf(a.platform).label}
                {!a.connected && " (desconectada)"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <input type="radio" name={`when-${task.id}`} checked={when === "schedule"} onChange={() => setWhen("schedule")} />
          Agendar para
        </label>
        <input
          type="datetime-local"
          value={publishAt}
          onChange={(e) => {
            setPublishAt(e.target.value);
            setWhen("schedule");
          }}
          className="rounded border px-2 py-1"
          aria-label="Data e hora da publicação"
        />
        <label className="flex items-center gap-1.5">
          <input type="radio" name={`when-${task.id}`} checked={when === "now"} onChange={() => setWhen("now")} />
          Publicar agora
        </label>
      </div>

      {problems.length > 0 && <p className="text-xs text-amber-700">{problems[0]}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-3 py-2">
          <span className="flex-1 text-violet-800">
            {when === "now" ? "Publicar agora (sai em uns 5 minutos)" : `Agendar para ${fmtDateTime(new Date(publishAt).toISOString())}`} em{" "}
            {chosen.map((a) => networkOf(a.platform).label).join(", ")}?
          </span>
          <button onClick={() => void send()} disabled={busy} className="rounded-md bg-violet-600 px-3 py-1.5 font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {busy ? "Enviando…" : "Confirmar"}
          </button>
          <button onClick={() => setConfirming(false)} className="px-2 text-slate-500">
            Voltar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          disabled={problems.length > 0 || uploading > 0}
          className="w-full rounded-lg bg-violet-600 py-2 font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
        >
          {when === "now" ? "🚀 Publicar agora" : "📅 Agendar publicação"}
        </button>
      )}
    </div>
  );
}

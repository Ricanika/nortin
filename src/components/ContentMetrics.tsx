"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { contentTotals, fmtNum, fmtPct, interactions, networkOf, type SocialChannel } from "@/lib/social";
import NetworkBadge from "./NetworkBadge";

const STATUS_LABEL: Record<SocialChannel["status"], { label: string; cls: string }> = {
  scheduled: { label: "Agendado", cls: "bg-cyan-50 text-cyan-700" },
  published: { label: "Publicado", cls: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Erro", cls: "bg-red-50 text-red-700" },
};

/** Engajamento colorido: verde acima de 5%, âmbar de 2% a 5%, cinza abaixo. */
export function EngagementValue({ value }: { value: number | null }) {
  const cls = value === null ? "text-slate-300" : value >= 0.05 ? "text-emerald-600" : value >= 0.02 ? "text-amber-600" : "text-slate-500";
  return <span className={`font-medium tabular-nums ${cls}`}>{fmtPct(value)}</span>;
}

/**
 * 4 células da linha do post (Redes, Impressões, Curtidas, Engajamento) com a soma dos canais.
 * Clicar nas redes abre/fecha as linhas por canal.
 */
export function ContentCells({
  channels,
  expanded,
  onToggle,
}: {
  channels: SocialChannel[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!channels.length) {
    return (
      <>
        <span className="text-xs text-slate-300">não enviado</span>
        <span />
        <span />
        <span />
      </>
    );
  }
  const t = contentTotals(channels);
  const published = channels.some((c) => c.status === "published");
  return (
    <>
      <button onClick={onToggle} className="flex items-center gap-1 text-left" title={expanded ? "Fechar canais" : "Ver resultado por canal"}>
        <span className="w-3 text-xs text-slate-400">{expanded ? "▾" : "▸"}</span>
        {channels.map((c) => (
          <span
            key={c.platform}
            className={`rounded ${c.status === "failed" ? "ring-2 ring-red-500" : c.status === "scheduled" ? "opacity-40" : ""}`}
          >
            <NetworkBadge platform={c.platform} />
          </span>
        ))}
      </button>
      <span className="pr-2 text-right text-xs tabular-nums">{published && t.impressions > 0 ? fmtNum(t.impressions) : "—"}</span>
      <span className="pr-2 text-right text-xs tabular-nums">{published ? fmtNum(t.likes) : "—"}</span>
      <span className="pr-2 text-right text-xs">{published ? <EngagementValue value={t.engagement} /> : "—"}</span>
    </>
  );
}

/** Impressões digitadas por canal; salva ao sair do campo. */
export function ImpressionsInput({ channel }: { channel: SocialChannel }) {
  const [value, setValue] = useState(channel.impressions ? String(channel.impressions) : "");
  const [error, setError] = useState(false);
  async function save() {
    const n = Number(value.replace(/\D/g, "") || 0);
    if (n === channel.impressions) return;
    const { error } = await createClient()
      .from("social_channels")
      .update({ impressions: n })
      .eq("task_id", channel.task_id)
      .eq("platform", channel.platform);
    setError(Boolean(error));
  }
  return (
    <input
      inputMode="numeric"
      value={value}
      placeholder="digitar"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      aria-label={`Impressões no ${networkOf(channel.platform).label}`}
      title="O GHL não entrega impressões: digite o número da rede"
      className={`w-full rounded border px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:border-violet-500 ${
        error ? "border-red-400" : "border-slate-200"
      }`}
    />
  );
}

/**
 * Linhas por canal abaixo do post ("subtarefas" de cada rede): status, link, impressões (digitadas),
 * curtidas e engajamento do canal. Ocupam a mesma grade da lista.
 */
export function ChannelRows({ channels, cols }: { channels: SocialChannel[]; cols: string }) {
  return (
    <>
      {channels.map((c) => {
        const s = STATUS_LABEL[c.status];
        const eng = c.impressions > 0 ? interactions(c) / c.impressions : null;
        return (
          <div key={c.platform} className={`grid ${cols} items-center border-b bg-slate-50/70 px-2 py-1 text-xs`}>
            <div className="col-span-5 flex min-w-0 items-center gap-2 pl-8">
              <span className="text-slate-300">└</span>
              <NetworkBadge platform={c.platform} />
              <span className="truncate font-medium text-slate-700">{networkOf(c.platform).label}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
              {c.link && (
                <a href={c.link} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sky-700 hover:underline">
                  abrir ↗
                </a>
              )}
              {c.status === "published" && (
                <span className="shrink-0 tabular-nums text-slate-400">
                  💬 {c.comments} · ↗ {c.shares}
                </span>
              )}
              {c.status === "failed" && c.error && <span className="truncate text-red-600">{c.error}</span>}
            </div>
            <span />
            <span className="pr-2">{c.status === "published" ? <ImpressionsInput channel={c} /> : <span className="block text-right">—</span>}</span>
            <span className="pr-2 text-right tabular-nums">{c.status === "published" ? fmtNum(c.likes) : "—"}</span>
            <span className="pr-2 text-right">{c.status === "published" ? <EngagementValue value={eng} /> : "—"}</span>
            <span />
          </div>
        );
      })}
    </>
  );
}

/** Análise rápida no topo da lista: geral e por rede, só com o que já foi publicado. */
export function ContentSummary({ channels }: { channels: SocialChannel[] }) {
  const published = channels.filter((c) => c.status === "published");
  const posts = new Set(published.map((c) => c.task_id)).size;
  const total = contentTotals(published);
  const byNetwork = [...new Set(published.map((c) => c.platform))]
    .map((p) => ({ platform: p, t: contentTotals(published.filter((c) => c.platform === p)), n: published.filter((c) => c.platform === p).length }))
    .sort((a, b) => (b.t.engagement ?? -1) - (a.t.engagement ?? -1));
  const missingImp = published.filter((c) => !c.impressions).length;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Posts publicados", fmtNum(posts)],
          ["Impressões", fmtNum(total.impressions)],
          ["Curtidas", fmtNum(total.likes)],
          ["Engajamento", fmtPct(total.engagement)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
            <div className="text-lg font-bold tabular-nums text-slate-800">{value}</div>
          </div>
        ))}
      </div>
      {byNetwork.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {byNetwork.map(({ platform, t, n }, i) => (
            <div key={platform} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${i === 0 && t.engagement !== null ? "border-emerald-300 bg-emerald-50/50" : ""}`}>
              <NetworkBadge platform={platform} />
              <span className="tabular-nums text-slate-600">
                {n} {n === 1 ? "post" : "posts"} · {fmtNum(t.impressions)} imp. · ❤ {fmtNum(t.likes)} ·{" "}
              </span>
              <EngagementValue value={t.engagement} />
              {i === 0 && t.engagement !== null && byNetwork.length > 1 && <span className="font-medium text-emerald-700">melhor</span>}
            </div>
          ))}
        </div>
      )}
      {missingImp > 0 && (
        <p className="text-[11px] text-amber-700">
          {missingImp} {missingImp === 1 ? "canal publicado está" : "canais publicados estão"} sem impressões: abra o ▸ do post e digite, para o
          engajamento ficar certo.
        </p>
      )}
    </div>
  );
}

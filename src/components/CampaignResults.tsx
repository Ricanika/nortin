"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  cpc,
  fmtCompact,
  fmtInt,
  fmtMoney,
  parseNumberBR,
  PLATFORMS,
  sumMetrics,
  toResult,
  type CampaignResult,
  type Metrics,
  type Platform,
} from "@/lib/campaign";
import Popover from "./Popover";

const FIELDS: { key: keyof Metrics; label: string; money?: boolean }[] = [
  { key: "impressions", label: "Impressões" },
  { key: "clicks", label: "Cliques" },
  { key: "spend", label: "Valor gasto", money: true },
];

const EMPTY: Metrics = { impressions: 0, clicks: 0, spend: 0 };

export function PlatformBadge({ platform, dim = false }: { platform: Platform; dim?: boolean }) {
  const p = PLATFORMS.find((x) => x.value === platform)!;
  return (
    <span
      title={p.label}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold text-white ${dim ? "opacity-25" : ""}`}
      style={{ background: p.color }}
    >
      {p.short}
    </span>
  );
}

/** Quadro Google × Meta × Total: digita impressões, cliques e gasto; o CPC sai sozinho. Salva ao sair do campo. */
export function CampaignResultsEditor({
  taskId,
  results,
  onSaved,
}: {
  taskId: string;
  results: CampaignResult[];
  onSaved: (r: CampaignResult) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const byPlatform = (p: Platform) => results.find((r) => r.platform === p) ?? { ...EMPTY };
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const keyOf = (p: Platform, f: keyof Metrics) => `${p}.${f}`;
  const shown = (p: Platform, f: (typeof FIELDS)[number]) => {
    const k = keyOf(p, f.key);
    if (k in drafts) return drafts[k];
    const v = byPlatform(p)[f.key];
    if (!v) return "";
    return f.money ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtInt(v);
  };

  async function save(p: Platform, f: (typeof FIELDS)[number]) {
    const k = keyOf(p, f.key);
    if (!(k in drafts)) return;
    const value = parseNumberBR(drafts[k]);
    if (Number.isNaN(value)) return setError(`"${drafts[k]}" não é um número válido.`);
    const current = byPlatform(p);
    const next = { ...current, [f.key]: f.money ? Math.round(value * 100) / 100 : Math.round(value) };
    setError(null);
    setSavingKey(k);
    const { data, error } = await supabase
      .from("campaign_results")
      .upsert(
        { task_id: taskId, platform: p, impressions: next.impressions, clicks: next.clicks, spend: next.spend },
        { onConflict: "task_id,platform" },
      )
      .select("task_id, platform, impressions, clicks, spend")
      .single();
    setSavingKey(null);
    if (error) return setError("Não deu para salvar. Tente de novo.");
    setDrafts((prev) => {
      const n = { ...prev };
      delete n[k];
      return n;
    });
    onSaved(toResult(data));
  }

  const total = sumMetrics(PLATFORMS.map((p) => byPlatform(p.value)));
  const totalCpc = cpc(total);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="py-1 pr-2 font-medium">Plataforma</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="px-1 py-1 text-right font-medium">
                  {f.label}
                </th>
              ))}
              <th className="py-1 pl-2 text-right font-medium">CPC</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map((p) => {
              const m = byPlatform(p.value);
              const c = cpc(m);
              return (
                <tr key={p.value} className="border-t">
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      <PlatformBadge platform={p.value} /> {p.label}
                    </span>
                  </td>
                  {FIELDS.map((f) => {
                    const k = keyOf(p.value, f.key);
                    return (
                      <td key={f.key} className="px-1 py-1.5">
                        <input
                          inputMode="decimal"
                          value={shown(p.value, f)}
                          placeholder={f.money ? "R$ 0,00" : "0"}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                          onBlur={() => void save(p.value, f)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          aria-label={`${f.label} ${p.label}`}
                          className={`w-full min-w-[84px] rounded border px-2 py-1 text-right tabular-nums outline-none focus:border-violet-500 ${
                            savingKey === k ? "opacity-50" : ""
                          }`}
                        />
                      </td>
                    );
                  })}
                  <td className="py-1.5 pl-2 text-right tabular-nums text-slate-600">{c === null ? "—" : fmtMoney(c)}</td>
                </tr>
              );
            })}
            <tr className="border-t bg-slate-50 font-semibold">
              <td className="py-1.5 pr-2">Total</td>
              <td className="px-1 py-1.5 text-right tabular-nums">{fmtInt(total.impressions)}</td>
              <td className="px-1 py-1.5 text-right tabular-nums">{fmtInt(total.clicks)}</td>
              <td className="px-1 py-1.5 text-right tabular-nums">{fmtMoney(total.spend)}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{totalCpc === null ? "—" : fmtMoney(totalCpc)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-slate-400">Salva ao sair do campo. O CPC é calculado: valor gasto ÷ cliques.</p>
    </div>
  );
}

/** Resumo da lista inteira: Google, Meta e Total lado a lado. */
export function CampaignSummary({ results }: { results: CampaignResult[] }) {
  const cards: { label: string; platform?: Platform; m: Metrics }[] = [
    ...PLATFORMS.map((p) => ({ label: p.label, platform: p.value, m: sumMetrics(results.filter((r) => r.platform === p.value)) })),
    { label: "Total", m: sumMetrics(results) },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {cards.map((c) => {
        const c2 = cpc(c.m);
        return (
          <div key={c.label} className={`rounded-lg border px-3 py-2 ${c.platform ? "" : "bg-slate-50"}`}>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              {c.platform && <PlatformBadge platform={c.platform} />}
              {c.label}
            </div>
            <dl className="grid grid-cols-4 gap-2 text-xs">
              {[
                ["Impressões", fmtCompact(c.m.impressions)],
                ["Cliques", fmtCompact(c.m.clicks)],
                ["CPC", c2 === null ? "—" : fmtMoney(c2)],
                ["Gasto", fmtMoney(c.m.spend)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className="truncate font-semibold tabular-nums text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Plataformas + 4 colunas na linha da tarefa (ocupa 5 colunas da grade da lista: 52/84/72/78/96 px);
 * clicar abre o quadro para preencher.
 */
export function CampaignCells({
  taskId,
  title,
  results,
  onSaved,
}: {
  taskId: string;
  title: string;
  results: CampaignResult[];
  onSaved: (r: CampaignResult) => void;
}) {
  const total = sumMetrics(results);
  const c = cpc(total);
  const has = (p: Platform) => results.some((r) => r.platform === p && (r.impressions || r.clicks || r.spend));
  const empty = !PLATFORMS.some((p) => has(p.value));
  return (
    <Popover
      label={`Resultados de ${title}`}
      width={580}
      triggerClassName="col-span-5 grid h-full w-full grid-cols-[52px_84px_72px_78px_96px] items-center rounded text-right text-xs tabular-nums hover:bg-violet-50"
      trigger={
        <span className="contents">
          <span className="flex justify-start gap-0.5 pl-1">
            {PLATFORMS.map((p) => (
              <PlatformBadge key={p.value} platform={p.value} dim={!has(p.value)} />
            ))}
          </span>
          {empty ? (
            <span className="col-span-4 pr-2 text-slate-300">+ resultados</span>
          ) : (
            <>
              <span className="pr-2">{fmtCompact(total.impressions)}</span>
              <span className="pr-2">{fmtCompact(total.clicks)}</span>
              <span className="pr-2">{c === null ? "—" : fmtMoney(c)}</span>
              <span className="pr-2 font-medium">{fmtMoney(total.spend)}</span>
            </>
          )}
        </span>
      }
    >
      {() => (
        <div className="px-3 py-2.5">
          <p className="mb-2 truncate text-sm font-semibold">📈 {title}</p>
          <CampaignResultsEditor taskId={taskId} results={results} onSaved={onSaved} />
        </div>
      )}
    </Popover>
  );
}

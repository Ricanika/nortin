"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  brl,
  CHECKLIST,
  computeImpact,
  fullAddress,
  mapsUrl,
  pctLabel,
  ppLabel,
  visitDate,
  type Impact,
  type PdvBaseMonth,
  type PdvCurveItem,
  type PdvData,
  type PdvMonth,
  type PdvPartner,
} from "@/lib/pdv";
import type { Status, Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";
import { useWorkspace } from "./WorkspaceContext";

export interface PdvBundle {
  partners: Record<number, PdvPartner>;
  sales: PdvMonth[];
  base: PdvBaseMonth[];
  reload: () => void;
}

/** Dados do Sankhya (copiados) das lojas desta lista: cadastro, vendas por mês e base. */
export function usePdvBundle(enabled: boolean, tasks: Task[]): PdvBundle {
  const supabase = useMemo(() => createClient(), []);
  const codes = useMemo(
    () => [...new Set(tasks.map((t) => t.pdv_codparc).filter((c): c is number => Boolean(c)))].sort((a, b) => a - b),
    [tasks],
  );
  const key = codes.join(",");
  const [state, setState] = useState<Omit<PdvBundle, "reload">>({ partners: {}, sales: [], base: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const list = key ? key.split(",").map(Number) : [];
    Promise.all([
      list.length ? supabase.from("pdv_partners").select("*").in("codparc", list) : Promise.resolve({ data: [] }),
      list.length ? supabase.from("pdv_sales_monthly").select("*").in("codparc", list) : Promise.resolve({ data: [] }),
      supabase.from("pdv_base_monthly").select("*"),
    ]).then(([p, s, b]) =>
      setState({
        partners: Object.fromEntries(((p.data ?? []) as PdvPartner[]).map((x) => [x.codparc, x])),
        sales: (s.data ?? []) as PdvMonth[],
        base: (b.data ?? []) as PdvBaseMonth[],
      }),
    );
  }, [enabled, key, supabase, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export const taskImpact = (t: Task, b: PdvBundle): Impact | null =>
  t.pdv_codparc ? computeImpact(visitDate(t), b.sales.filter((s) => s.codparc === t.pdv_codparc), b.base) : null;

const tone = (v: number | null | undefined) => (v === null || v === undefined ? "text-slate-400" : v > 0 ? "text-emerald-600" : v < 0 ? "text-red-600" : "text-slate-600");

/** 5 células da linha (computador): cliente, média antes, média depois, vendas %, frequência %. */
export function PdvCells({ task, bundle }: { task: Task; bundle: PdvBundle }) {
  const imp = taskImpact(task, bundle);
  return (
    <>
      <span className="truncate pr-2 text-xs tabular-nums text-slate-500" title={task.pdv_codparc ? bundle.partners[task.pdv_codparc]?.nome : undefined}>
        {task.pdv_codparc ?? <span className="text-slate-300">sem código</span>}
      </span>
      <span className="pr-2 text-right text-xs tabular-nums">{imp ? brl(imp.antes.media) : "—"}</span>
      <span className="pr-2 text-right text-xs tabular-nums">{imp?.depois ? brl(imp.depois.media) : <span className="text-slate-300">aguardando</span>}</span>
      <span className={`pr-2 text-right text-xs font-semibold tabular-nums ${tone(imp?.vendas)}`}>{pctLabel(imp?.vendas)}</span>
      <span className={`pr-2 text-right text-xs font-semibold tabular-nums ${tone(imp?.frequencia)}`}>{pctLabel(imp?.frequencia)}</span>
    </>
  );
}

/** Linha extra do cartão no celular. */
export function PdvMobileLine({ task, bundle }: { task: Task; bundle: PdvBundle }) {
  if (!task.pdv_codparc) return <div className="mt-1 text-xs text-slate-400">Sem código do parceiro</div>;
  const imp = taskImpact(task, bundle);
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 text-xs tabular-nums text-slate-500">
      <span>cód. {task.pdv_codparc}</span>
      {imp && <span>antes {brl(imp.antes.media)}/mês</span>}
      {imp?.depois ? (
        <>
          <span className={`font-semibold ${tone(imp.vendas)}`}>vendas {pctLabel(imp.vendas)}</span>
          <span className={`font-semibold ${tone(imp.frequencia)}`}>freq. {pctLabel(imp.frequencia)}</span>
        </>
      ) : (
        imp && <span className="text-slate-400">depois: aguardando 1º mês</span>
      )}
    </div>
  );
}

/** Resumo no topo da lista de PDV. */
export function PdvSummary({ tasks, bundle }: { tasks: Task[]; bundle: PdvBundle }) {
  const rows = tasks.map((t) => ({ t, imp: taskImpact(t, bundle) })).filter((r) => r.imp?.depois);
  const avg = (f: (i: Impact) => number | null) => {
    const v = rows.map((r) => f(r.imp!)).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const visited = tasks.filter((t) => t.pdv?.visited_at).length;
  const top = [...rows].sort((a, b) => (b.imp!.vendas ?? -9) - (a.imp!.vendas ?? -9)).slice(0, 3);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["PDVs visitados", String(visited), ""],
          ["Crescimento de vendas", pctLabel(avg((i) => i.vendas)), tone(avg((i) => i.vendas))],
          ["Frequência de compra", pctLabel(avg((i) => i.frequencia)), tone(avg((i) => i.frequencia))],
          ["Acima da base", ppLabel(avg((i) => i.acimaBase)), tone(avg((i) => i.acimaBase))],
        ].map(([label, value, cls]) => (
          <div key={label} className="rounded-lg border px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
            <div className={`text-lg font-bold tabular-nums ${cls || "text-slate-800"}`}>{value}</div>
          </div>
        ))}
      </div>
      {top.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {top.map(({ t, imp }, i) => (
            <span key={t.id} className={`rounded-lg border px-2.5 py-1.5 ${i === 0 ? "border-emerald-300 bg-emerald-50/50" : ""}`}>
              {["🥇", "🥈", "🥉"][i]} {t.title} · <b className={tone(imp!.vendas)}>{pctLabel(imp!.vendas)}</b>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          O resultado de cada PDV aparece quando fecha o 1º mês depois da visita (compara com a média dos 6 meses anteriores).
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel da visita (dentro dos detalhes da tarefa)
// ---------------------------------------------------------------------------

export function PdvPanel({
  task,
  statuses,
  actions,
  bundle,
}: {
  task: Task;
  statuses: Status[];
  actions: TaskActions;
  bundle: PdvBundle;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { workspace } = useWorkspace();
  const [code, setCode] = useState(task.pdv_codparc ? String(task.pdv_codparc) : /^\d+$/.test(task.title.trim()) ? task.title.trim() : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const partner = task.pdv_codparc ? bundle.partners[task.pdv_codparc] : undefined;
  const imp = taskImpact(task, bundle);
  const pdv: PdvData = task.pdv ?? {};
  const savePdv = (patch: Partial<PdvData>) => actions.update(task.id, { pdv: { ...pdv, ...patch } });

  async function lookup() {
    const c = code.replace(/\D/g, "");
    if (!c) return setMsg({ text: "Digite o código do parceiro.", error: true });
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/pdv/partner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, codparc: Number(c) }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; warning?: string; partner?: PdvPartner };
    setBusy(false);
    if (!res.ok) return setMsg({ text: json.error ?? "Não deu para buscar.", error: true });
    if (json.warning) setMsg({ text: json.warning, error: !json.partner });
    else setMsg({ text: `✅ ${json.partner?.nome} carregado do Sankhya` });
    bundle.reload();
  }

  async function checkIn() {
    const visitada = statuses.find((s) => s.name.toLowerCase().startsWith("visitad"));
    await savePdv({ visited_at: new Date().toISOString() });
    if (visitada && task.status_id !== visitada.id) await actions.update(task.id, { status_id: visitada.id });
  }

  return (
    <div className="space-y-4 border-b px-4 py-4 sm:px-5">
      <h3 className="text-sm font-semibold text-slate-800">🏪 Visita ao PDV</h3>

      {/* Código do parceiro */}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor={`codparc-${task.id}`}>
          Código do parceiro (Sankhya)
        </label>
        <div className="flex gap-2">
          <input
            id={`codparc-${task.id}`}
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
            placeholder="Ex.: 53"
            className="w-32 rounded-md border px-3 py-1.5 text-sm tabular-nums outline-none focus:border-violet-500"
          />
          <button
            onClick={() => void lookup()}
            disabled={busy}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? "Buscando…" : task.pdv_codparc ? "🔄 Atualizar" : "Buscar"}
          </button>
        </div>
        {msg && <p className={`mt-1 text-xs ${msg.error ? "text-amber-700" : "text-emerald-700"}`}>{msg.text}</p>}
      </div>

      {partner && (
        <div className="rounded-lg border bg-slate-50 px-3 py-2 text-sm">
          <div className="font-semibold text-slate-800">{partner.nome}</div>
          {partner.razao && partner.razao !== partner.nome && <div className="text-xs text-slate-500">{partner.razao}</div>}
          <div className="mt-1 text-xs text-slate-600">{fullAddress(partner) || "Sem endereço no cadastro"}</div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {fullAddress(partner) && (
              <a href={mapsUrl(fullAddress(partner))} target="_blank" rel="noopener noreferrer" className="font-medium text-sky-700">
                🗺️ Abrir no mapa
              </a>
            )}
            {partner.telefone && (
              <a href={`tel:${partner.telefone.replace(/\D/g, "")}`} className="font-medium text-sky-700">
                📞 {partner.telefone}
              </a>
            )}
            {partner.vendedor && <span className="text-slate-500">Vendedor: {partner.vendedor}</span>}
            {partner.key_account && <span className="text-slate-500">Key account: {partner.key_account}</span>}
          </div>
        </div>
      )}

      {/* Check-in */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {pdv.visited_at ? (
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
            ✅ Visitada em {new Date(pdv.visited_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          </span>
        ) : (
          <button onClick={() => void checkIn()} className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700">
            📍 Registrar visita agora
          </button>
        )}
        {pdv.visited_at && (
          <button onClick={() => void savePdv({ visited_at: undefined })} className="text-xs text-slate-400 hover:text-red-600">
            desfazer
          </button>
        )}
      </div>

      {imp && <ImpactCard imp={imp} sales={bundle.sales.filter((s) => s.codparc === task.pdv_codparc)} />}

      <Checklist value={pdv.checklist ?? {}} onChange={(checklist) => void savePdv({ checklist })} />

      <BeforeAfterPhotos
        photos={pdv.photos ?? {}}
        upload={async (file) => {
          const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
          const path = `${workspace.id}/${task.id}/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from("pdv").upload(path, file, { contentType: file.type });
          if (error) throw error;
          return supabase.storage.from("pdv").getPublicUrl(path).data.publicUrl;
        }}
        onChange={(photos) => void savePdv({ photos })}
      />

      {task.pdv_codparc && <CurveList taskId={task.id} codparc={task.pdv_codparc} />}
    </div>
  );
}

function ImpactCard({ imp, sales }: { imp: Impact; sales: PdvMonth[] }) {
  const rows: [string, string, string, number | null][] = [
    ["Venda média/mês", brl(imp.antes.media), imp.depois ? brl(imp.depois.media) : "—", imp.vendas],
    [
      "Compras/mês",
      imp.antes.freq.toFixed(1).replace(".", ","),
      imp.depois ? imp.depois.freq.toFixed(1).replace(".", ",") : "—",
      imp.frequencia,
    ],
    ["Ticket médio", brl(imp.antes.ticket), imp.depois ? brl(imp.depois.ticket) : "—", null],
  ];
  // últimos 12 meses, com o mês da visita marcado
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    return { key, label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), valor: Number(sales.find((s) => s.mes === key)?.valor ?? 0) };
  });
  const max = Math.max(1, ...months.map((m) => m.valor));
  const visitKey = imp.visita.slice(0, 7) + "-01";
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="mb-1 text-xs font-semibold text-slate-700">📈 Resultado de vendas</div>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-slate-400">
            <th className="py-0.5 text-left font-normal" />
            <th className="py-0.5 text-right font-normal">Antes (6 meses)</th>
            <th className="py-0.5 text-right font-normal">Depois{imp.depois ? ` (${imp.depois.meses} ${imp.depois.meses === 1 ? "mês" : "meses"})` : ""}</th>
            <th className="py-0.5 text-right font-normal">Var.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, d, v]) => (
            <tr key={label} className="border-t">
              <td className="py-1 text-slate-600">{label}</td>
              <td className="py-1 text-right">{a}</td>
              <td className="py-1 text-right">{d}</td>
              <td className={`py-1 text-right font-semibold ${tone(v)}`}>{v === null ? "" : pctLabel(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {imp.depois ? (
        imp.acimaBase !== null && (
          <p className="mt-1 text-[11px] text-slate-500">
            A base de lojas variou {pctLabel(imp.base)} no mesmo período: esta loja ficou <b className={tone(imp.acimaBase)}>{ppLabel(imp.acimaBase)}</b> acima da base.
          </p>
        )
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">O &quot;depois&quot; aparece quando fechar o 1º mês após o mês da visita.</p>
      )}
      <div className="mt-2 flex h-16 items-end gap-0.5" aria-label="Vendas dos últimos 12 meses">
        {months.map((m) => (
          <div key={m.key} className="flex flex-1 flex-col items-center gap-0.5" title={`${m.label}: ${brl(m.valor)}`}>
            <div
              className={`w-full rounded-t ${m.key === visitKey ? "bg-amber-400" : m.key > visitKey ? "bg-emerald-400" : "bg-slate-300"}`}
              style={{ height: `${Math.max(2, (m.valor / max) * 48)}px` }}
            />
            <span className="text-[8px] text-slate-400">{m.label}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400">cinza: antes · amarelo: mês da visita · verde: depois</p>
    </div>
  );
}

function Checklist({ value, onChange }: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  const done = CHECKLIST.filter((c) => value[c.key]).length;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-700">
        ✅ Checklist de merchandising <span className="font-normal text-slate-400">{done}/{CHECKLIST.length}</span>
      </div>
      <div className="space-y-0.5">
        {CHECKLIST.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-slate-50">
            <input type="checkbox" checked={Boolean(value[c.key])} onChange={(e) => onChange({ ...value, [c.key]: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
            <span className={value[c.key] ? "text-slate-500" : "text-slate-700"}>{c.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function BeforeAfterPhotos({
  photos,
  upload,
  onChange,
}: {
  photos: NonNullable<PdvData["photos"]>;
  upload: (f: File) => Promise<string>;
  onChange: (p: NonNullable<PdvData["photos"]>) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function add(kind: "antes" | "depois", files: FileList | null) {
    if (!files?.length) return;
    setBusy(kind);
    setErr(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) urls.push(await upload(f));
      onChange({ ...photos, [kind]: [...(photos[kind] ?? []), ...urls] });
    } catch (e) {
      setErr(`Não deu para enviar: ${(e as Error).message}`);
    }
    setBusy(null);
  }
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-700">📸 Fotos da gôndola</div>
      <div className="grid grid-cols-2 gap-3">
        {(["antes", "depois"] as const).map((kind) => (
          <div key={kind}>
            <div className="mb-1 text-[11px] font-medium uppercase text-slate-400">{kind}</div>
            <div className="flex flex-wrap gap-1.5">
              {(photos[kind] ?? []).map((url) => (
                <div key={url} className="group relative h-16 w-16 overflow-hidden rounded-md border bg-slate-100">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`foto ${kind}`} className="h-full w-full object-cover" />
                  </a>
                  <button
                    onClick={() => onChange({ ...photos, [kind]: (photos[kind] ?? []).filter((u) => u !== url) })}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white"
                    aria-label="Remover foto"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed text-[10px] text-slate-500 hover:border-violet-400">
                {busy === kind ? "…" : (
                  <>
                    <span className="text-lg">📷</span>foto
                  </>
                )}
                <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void add(kind, e.target.files)} />
              </label>
            </div>
          </div>
        ))}
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

/** Curva A da loja (12 meses): foto, produto, participação e contagem de estoque na gôndola. */
function CurveList({ taskId, codparc }: { taskId: string; codparc: number }) {
  const supabase = useMemo(() => createClient(), []);
  const { workspace } = useWorkspace();
  const [items, setItems] = useState<PdvCurveItem[] | null>(null);
  const [photos, setPhotos] = useState<Record<number, string>>({});
  const [stock, setStock] = useState<Record<number, number | null>>({});
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    supabase
      .from("pdv_curve")
      .select("*")
      .eq("codparc", codparc)
      .order("rank")
      .then(async ({ data }) => {
        const list = (data ?? []) as PdvCurveItem[];
        setItems(list);
        const codes = list.slice(0, 60).map((i) => i.codprod);
        if (codes.length) {
          const { data: ph } = await supabase.from("pdv_product_photos").select("codprod, url").in("codprod", codes);
          setPhotos(Object.fromEntries((ph ?? []).map((p) => [p.codprod, p.url])));
        }
      });
    supabase
      .from("pdv_stock")
      .select("codprod, qty")
      .eq("task_id", taskId)
      .then(({ data }) => setStock(Object.fromEntries((data ?? []).map((s) => [s.codprod, s.qty]))));
  }, [supabase, codparc, taskId]);

  async function saveStock(codprod: number, raw: string) {
    const qty = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (qty !== null && Number.isNaN(qty)) return;
    setStock((s) => ({ ...s, [codprod]: qty }));
    await supabase.from("pdv_stock").upsert({ task_id: taskId, codprod, qty });
  }

  async function uploadPhoto(codprod: number, file: File | undefined) {
    if (!file) return;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${workspace.id}/produtos/${codprod}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("pdv").upload(path, file, { contentType: file.type });
    if (error) return;
    const url = supabase.storage.from("pdv").getPublicUrl(path).data.publicUrl;
    await supabase.from("pdv_product_photos").upsert({ codprod, url, origem: "app", updated_at: new Date().toISOString() });
    setPhotos((p) => ({ ...p, [codprod]: url }));
  }

  if (!items) return <p className="text-xs text-slate-400">Carregando produtos…</p>;
  if (!items.length)
    return <p className="text-xs text-slate-500">🧺 A curva de produtos aparece depois de buscar o cliente no Sankhya.</p>;
  const curveA = items.filter((i) => i.curva === "A");
  const shown = showAll ? items : curveA;
  const counted = curveA.filter((i) => stock[i.codprod] !== undefined && stock[i.codprod] !== null).length;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-700">
          🧺 Curva A da loja <span className="font-normal text-slate-400">({curveA.length} produtos = 80% das compras em 12 meses)</span>
        </span>
        <span className="text-slate-400">contados {counted}/{curveA.length}</span>
      </div>
      <div className="divide-y rounded-lg border">
        {shown.map((i) => (
          <div key={i.codprod} className="flex items-center gap-2.5 px-2 py-2">
            <label className="relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-md border bg-slate-50" title="Trocar foto do produto">
              {photos[i.codprod] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photos[i.codprod]} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center text-[9px] text-slate-400">
                  <span className="text-base">📷</span>foto
                </span>
              )}
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void uploadPhoto(i.codprod, e.target.files?.[0])} />
            </label>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm leading-snug text-slate-800">{i.descricao}</div>
              <div className="text-[11px] tabular-nums text-slate-400">
                <span className={`mr-1 rounded px-1 font-semibold ${i.curva === "A" ? "bg-emerald-100 text-emerald-700" : i.curva === "B" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                  {i.curva}
                </span>
                #{i.rank} · {i.referencia ?? i.codprod} · {(i.share * 100).toFixed(1).replace(".", ",")}% · {brl(i.valor)} · {Number(i.qtd).toLocaleString("pt-BR")} un.
              </div>
            </div>
            <input
              inputMode="decimal"
              defaultValue={stock[i.codprod] ?? ""}
              key={`${i.codprod}-${stock[i.codprod] ?? ""}`}
              onBlur={(e) => void saveStock(i.codprod, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder="estoque"
              aria-label={`Estoque na loja de ${i.descricao}`}
              className="w-20 shrink-0 rounded-md border px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-violet-500"
            />
          </div>
        ))}
      </div>
      {items.length > curveA.length && (
        <button onClick={() => setShowAll(!showAll)} className="mt-1 text-xs font-medium text-violet-700 hover:underline">
          {showAll ? "Mostrar só a curva A" : `Ver todos os ${items.length} produtos (curvas B e C)`}
        </button>
      )}
    </div>
  );
}

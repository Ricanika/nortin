"use client";

import { useState } from "react";
import {
  AREAS,
  cadastroFor,
  GATE_AFTER,
  GATES,
  gateOwner,
  PHASES,
  phaseHint,
  phaseOfStatus,
  phasesFor,
  PORTAO0,
  reviews,
  TRILHAS,
  type Gate,
  type GateDecision,
  type LaunchData,
  type Phase,
  type Trilha,
} from "@/lib/launch";
import { memberName, type Status, type Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";
import { useWorkspace } from "./WorkspaceContext";

/** Quadradinho colorido com a letra da trilha (A–F). */
export function TrilhaBadge({ t, size = 18 }: { t?: Trilha; size?: number }) {
  if (!t) return null;
  return (
    <span
      title={`Trilha ${t} · ${TRILHAS[t].nome}`}
      className="inline-flex shrink-0 items-center justify-center rounded font-bold text-white"
      style={{ background: TRILHAS[t].cor, width: size, height: size, fontSize: size * 0.6 }}
    >
      {t}
    </span>
  );
}

const phaseName = (p: Phase) => (p === "ENCERRADO" ? "Encerrado" : PHASES.find((x) => x.key === p)?.nome ?? p);

export function LaunchPanel({ task, statuses, actions }: { task: Task; statuses: Status[]; actions: TaskActions }) {
  const { me, members } = useWorkspace();
  const d: LaunchData = task.launch ?? {};
  const save = (patch: Partial<LaunchData>) => actions.update(task.id, { launch: { ...d, ...patch } });
  const status = statuses.find((s) => s.id === task.status_id);
  const phase = phaseOfStatus(status?.name);
  const statusOf = (p: Phase) => statuses.find((s) => phaseOfStatus(s.name) === p);
  const flow = phasesFor(d);

  const move = async (p: Phase, extra: Partial<LaunchData> = {}) => {
    const target = statusOf(p);
    await actions.update(task.id, { launch: { ...d, ...extra }, ...(target ? { status_id: target.id } : {}) });
  };
  const nextPhase = (): Phase | null => {
    if (!phase) return null;
    const i = flow.indexOf(phase);
    return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
  };

  return (
    <div className="space-y-4 border-b px-4 py-4 sm:px-5">
      <h3 className="text-sm font-semibold text-slate-800">🚀 Lançamento de produto</h3>

      <TrilhaSection d={d} save={save} />

      {d.trilha && (
        <>
          {/* Caminho da trilha */}
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-700">Caminho da trilha {d.trilha}</div>
            <div className="flex flex-wrap gap-1">
              {flow.map((p) => {
                const cur = p === phase;
                const done = phase && phase !== "ENCERRADO" && flow.indexOf(p) < flow.indexOf(phase);
                const hint = phaseHint(p, d.trilha);
                return (
                  <span
                    key={p}
                    title={hint ?? undefined}
                    className={`rounded-md px-2 py-1 text-[11px] ${
                      cur ? "bg-violet-600 font-semibold text-white" : done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {done ? "✓ " : ""}
                    {p === "MANTIDO" ? "Mantido" : `${p} ${phaseName(p).split(" ")[0]}`}
                    {hint && cur ? ` · ${hint}` : ""}
                  </span>
                );
              })}
            </div>
            {phase === "F3" && !flow.includes("F3") && (
              <p className="mt-1 text-xs text-amber-700">A trilha {d.trilha} não passa pela ferramentaria: avance para o F4.</p>
            )}
          </div>

          {phase === "ENCERRADO" ? (
            <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
              ⛔ <b>Encerrado</b>
              {d.encerrado_motivo ? ` · ${d.encerrado_motivo}` : ""}
              <span className="ml-1 text-xs text-slate-500">({d.lancado_em ? "chegou a ser lançado" : "não chegou a ser lançado"})</span>
            </div>
          ) : (
            phase &&
            phase !== "MANTIDO" && (
              <GateCard
                key={`${phase}-${GATE_AFTER[phase] ?? ""}`}
                phase={phase}
                d={d}
                next={nextPhase()}
                onAdvance={(gate, rec, to) => {
                  const gates = { ...(d.gates ?? {}), ...(gate ? { [gate]: rec } : {}) };
                  const extra: Partial<LaunchData> = { gates, ...(gate === "G4" ? { lancado_em: new Date().toISOString() } : {}) };
                  if (to) return void move(to, extra);
                  void save(extra);
                }}
                onClose={(gate, rec) => {
                  const motivo = gate === "G5" ? "Descontinuado no G5" : `Barrado no ${gate}`;
                  void move("ENCERRADO", { gates: { ...(d.gates ?? {}), [gate]: rec }, encerrado_motivo: rec.note ? `${motivo}: ${rec.note}` : motivo });
                }}
                me={me}
              />
            )
          )}

          <Dossie d={d} save={save} />

          <Cadastro d={d} save={save} highlight={phase === "F4"} />

          {d.lancado_em && (
            <div className="rounded-lg border px-3 py-2 text-xs">
              <div className="mb-1 font-semibold text-slate-700">📅 Acompanhamento (G5)</div>
              <div className="flex flex-wrap gap-2">
                {reviews(d.lancado_em).map((r) => (
                  <span key={r.dias} className={`rounded-md px-2 py-1 ${r.data < new Date() ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>
                    {r.dias} dias: {r.data.toLocaleDateString("pt-BR")}
                    {r.data < new Date() ? " · revisar" : ""}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-slate-500">Compare faturamento, clientes, margem, devolução, ruptura e efeito no SKU irmão com a meta do G1.</p>
            </div>
          )}

          <Areas t={d.trilha} />

          <GateHistory d={d} members={members} />
        </>
      )}
    </div>
  );
}

function TrilhaSection({ d, save }: { d: LaunchData; save: (p: Partial<LaunchData>) => void }) {
  const [step, setStep] = useState(0);
  const [picking, setPicking] = useState(!d.trilha);
  if (d.trilha && !picking) {
    const t = TRILHAS[d.trilha];
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <TrilhaBadge t={d.trilha} size={24} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-800">
            Trilha {d.trilha} · {t.nome}
          </div>
          <div className="text-xs text-slate-500">
            {t.desc}
            {t.projetos ? "" : " · não passa por Projetos"}
          </div>
        </div>
        {d.trilha === "F" && (
          <select value={d.rota ?? ""} onChange={(e) => save({ rota: (e.target.value || undefined) as LaunchData["rota"] })} className="rounded border px-2 py-1 text-xs">
            <option value="">Rota: a definir</option>
            <option value="A">Fabricar: molde novo (A)</option>
            <option value="B">Fabricar: alterar molde (B)</option>
            <option value="revenda">Revenda</option>
          </select>
        )}
        <button
          onClick={() => {
            setPicking(true);
            setStep(0);
          }}
          className="text-xs text-violet-700 hover:underline"
        >
          trocar
        </button>
      </div>
    );
  }
  const q = PORTAO0[step];
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-3">
      <div className="mb-1 text-xs font-semibold text-violet-800">
        Portão 0 · Qual trilha? <span className="font-normal text-violet-600">pergunta {step + 1} de {PORTAO0.length}</span>
      </div>
      {q ? (
        <>
          <p className="text-sm text-slate-800">{q.q}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                save({ trilha: q.t });
                setPicking(false);
              }}
              className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white"
            >
              Sim
            </button>
            <button onClick={() => setStep(step + 1)} className="rounded-md border bg-white px-4 py-1.5 text-sm">
              Não
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-600">Nenhuma trilha se aplica: este projeto não gera SKU novo e não precisa deste processo.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
        ou escolha direto:
        {(Object.keys(TRILHAS) as Trilha[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              save({ trilha: t });
              setPicking(false);
            }}
            className="flex items-center gap-1 rounded border bg-white px-1.5 py-0.5 hover:border-violet-400"
          >
            <TrilhaBadge t={t} size={14} /> {TRILHAS[t].nome}
          </button>
        ))}
      </div>
    </div>
  );
}

function GateCard({
  phase,
  d,
  next,
  onAdvance,
  onClose,
  me,
}: {
  phase: Phase;
  d: LaunchData;
  next: Phase | null;
  onAdvance: (gate: Gate | null, rec: NonNullable<LaunchData["gates"]>[Gate], to: Phase | null) => void;
  onClose: (gate: Gate, rec: NonNullable<LaunchData["gates"]>[Gate] & object) => void;
  me: string;
}) {
  const gate = GATE_AFTER[phase] ?? null;
  const rec = gate ? d.gates?.[gate] ?? {} : {};
  const [criteria, setCriteria] = useState<Record<string, boolean>>(rec.criteria ?? {});
  const [note, setNote] = useState(rec.note ?? "");
  const list = gate ? GATES[gate].criterios(d.trilha) : [];
  const allOk = list.every((c) => criteria[c]);
  const record = (decision: GateDecision) => ({ decision, by: me, at: new Date().toISOString(), note: note.trim() || undefined, criteria });

  if (!gate) {
    return (
      <div className="rounded-lg border px-3 py-2">
        <div className="text-sm text-slate-700">
          <b>{phase}</b> · {phaseName(phase)} {phaseHint(phase, d.trilha) ? `(${phaseHint(phase, d.trilha)})` : ""}
        </div>
        {next && (
          <button onClick={() => onAdvance(null, undefined, next)} className="mt-2 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white">
            Concluir fase e ir para {next === "MANTIDO" ? "Mantido" : `${next} · ${phaseName(next)}`} →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-violet-200 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <div className="text-sm font-semibold text-slate-800">
          🚦 Portão {gate} · {GATES[gate].pergunta}
        </div>
        <div className="text-[11px] text-slate-500">decide: {gateOwner(gate, d.trilha)}</div>
      </div>
      {rec.decision === "ajustar" && <p className="mt-1 text-xs text-amber-700">🔁 Pedido de ajuste{rec.note ? `: ${rec.note}` : ""}</p>}
      <div className="mt-2 space-y-0.5">
        {list.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
            <input type="checkbox" checked={Boolean(criteria[c])} onChange={(e) => setCriteria({ ...criteria, [c]: e.target.checked })} className="h-4 w-4 accent-violet-600" />
            <span className={criteria[c] ? "text-slate-500" : "text-slate-700"}>{c}</span>
          </label>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Observação da decisão (opcional)"
        className="mt-2 w-full resize-none rounded-md border px-2 py-1.5 text-sm outline-none focus:border-violet-500"
      />
      {!allOk && <p className="text-[11px] text-amber-700">⚠️ Ainda há critérios sem marcar.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => {
            if (!allOk && !confirm("Há critérios sem marcar. Aprovar mesmo assim?")) return;
            onAdvance(gate, record("aprovado"), next);
          }}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          ✅ {gate === "G5" ? "Manter" : `Aprovar${next ? ` e ir para ${next === "MANTIDO" ? "Mantido" : next}` : ""}`}
        </button>
        <button onClick={() => onAdvance(gate, record("ajustar"), null)} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
          🔁 Ajustar
        </button>
        <button
          onClick={() => {
            if (!confirm(gate === "G5" ? "Descontinuar este SKU?" : `Reprovar no ${gate} e encerrar o projeto?`)) return;
            onClose(gate, record("reprovado"));
          }}
          className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700"
        >
          ⛔ {gate === "G5" ? "Descontinuar" : "Reprovar"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onSave, area, placeholder }: { label: string; value?: string; onSave: (v: string) => void; area?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value ?? "");
  const props = {
    value: v,
    placeholder,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: () => v !== (value ?? "") && onSave(v),
    className: "w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-violet-500",
  };
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-medium text-slate-500">{label}</span>
      {area ? <textarea rows={2} {...props} className={`${props.className} resize-y`} /> : <input {...props} />}
    </label>
  );
}

function Dossie({ d, save }: { d: LaunchData; save: (p: Partial<LaunchData>) => void }) {
  const [open, setOpen] = useState(true);
  const cde = d.trilha === "C" || d.trilha === "D" || d.trilha === "E";
  return (
    <div className="rounded-lg border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700">
        📁 Dossiê do produto <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">G0 · triagem</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Busca no catálogo (3 palavras)" value={d.busca} onSave={(busca) => save({ busca })} placeholder="ex.: pote, hermético, retangular" />
            <Field label="Resultado da busca" value={d.busca_resultado} onSave={(busca_resultado) => save({ busca_resultado })} placeholder="nada parecido / similar: código…" />
          </div>
          {cde && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-medium text-slate-500">Troca ou soma um SKU?</span>
                <select value={d.troca_soma ?? ""} onChange={(e) => save({ troca_soma: (e.target.value || undefined) as LaunchData["troca_soma"] })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                  <option value="">—</option>
                  <option value="troca">Troca (substitui um SKU)</option>
                  <option value="soma">Soma (SKU a mais: justificar demanda)</option>
                </select>
              </label>
              <Field label="SKU que sai" value={d.sku_sai} onSave={(sku_sai) => save({ sku_sai })} placeholder="código ou nome" />
            </div>
          )}
          <Field label="Hipótese de demanda" value={d.hipotese} onSave={(hipotese) => save({ hipotese })} area />
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Público" value={d.publico} onSave={(publico) => save({ publico })} />
            <Field label="Faixa de litragem" value={d.litragem} onSave={(litragem) => save({ litragem })} />
            <Field label="Clientes por SKU da linha" value={d.clientes_sku} onSave={(clientes_sku) => save({ clientes_sku })} />
          </div>

          <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">G1 · business case</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Preço-alvo" value={d.preco_alvo} onSave={(preco_alvo) => save({ preco_alvo })} placeholder="R$" />
            <Field label="Margem-alvo" value={d.margem_alvo} onSave={(margem_alvo) => save({ margem_alvo })} placeholder="%" />
            <Field label="Volume em 12 meses" value={d.volume_12m} onSave={(volume_12m) => save({ volume_12m })} placeholder="unidades" />
            <Field label="Investimento" value={d.investimento} onSave={(investimento) => save({ investimento })} placeholder="R$" />
            <Field label="Payback" value={d.payback} onSave={(payback) => save({ payback })} placeholder="meses" />
            <Field label="Meta de 12 meses" value={d.meta_12m} onSave={(meta_12m) => save({ meta_12m })} placeholder="R$ faturamento" />
            <Field label="Meta de clientes" value={d.meta_clientes} onSave={(meta_clientes) => save({ meta_clientes })} />
            <div className="sm:col-span-2">
              <Field label="Critério de corte (abaixo disso o SKU sai)" value={d.criterio_corte} onSave={(criterio_corte) => save({ criterio_corte })} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Cadastro({ d, save, highlight }: { d: LaunchData; save: (p: Partial<LaunchData>) => void; highlight: boolean }) {
  const [open, setOpen] = useState(highlight);
  const items = cadastroFor(d.trilha);
  const done = items.filter((i) => d.cadastro?.[i.key]).length;
  return (
    <div className={`rounded-lg border ${highlight ? "border-amber-300" : ""}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700">
        <span>
          🗂️ Cadastro no ERP (F4){" "}
          <span className={`font-normal ${done === items.length ? "text-emerald-600" : "text-slate-400"}`}>
            {done}/{items.length}
          </span>
        </span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-3">
          <div className="w-40">
            <Field label="CODPROD no Sankhya" value={d.codprod} onSave={(codprod) => save({ codprod })} />
          </div>
          <p className="text-[11px] text-slate-500">Produto criado bloqueado para venda; só libera no G4.</p>
          <div className="divide-y rounded-md border">
            {items.map((i) => {
              const regra = d.trilha ? i.regra[d.trilha] : undefined;
              return (
                <label key={i.key} className="flex cursor-pointer items-start gap-2 px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={Boolean(d.cadastro?.[i.key])}
                    onChange={(e) => save({ cadastro: { ...(d.cadastro ?? {}), [i.key]: e.target.checked } })}
                    className="mt-0.5 h-4 w-4 accent-amber-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={d.cadastro?.[i.key] ? "text-slate-400 line-through" : "text-slate-800"}>{i.item}</span>
                    {typeof regra === "string" && <span className="block text-[11px] text-slate-500">{regra}</span>}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{i.area}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Areas({ t }: { t: Trilha }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-700">👥 Áreas nesta trilha</div>
      <div className="flex flex-wrap gap-1">
        {AREAS.filter((a) => a.t[t]).map((a) => (
          <span key={a.area} className={`rounded-full px-2 py-0.5 text-[11px] ${a.t[t] === true ? "bg-violet-50 text-violet-800" : "border border-dashed text-slate-500"}`}>
            {a.area}
            {a.t[t] === "opc" ? " (se aplicável)" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function GateHistory({ d, members }: { d: LaunchData; members: ReturnType<typeof useWorkspace>["members"] }) {
  const entries = (Object.entries(d.gates ?? {}) as [Gate, NonNullable<LaunchData["gates"]>[Gate]][])
    .filter(([, r]) => r?.decision)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!entries.length) return null;
  const label = { aprovado: "✅ aprovado", ajustar: "🔁 ajustar", reprovado: "⛔ reprovado" } as const;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-700">🧾 Decisões dos portões</div>
      <ul className="space-y-0.5 text-xs text-slate-600">
        {entries.map(([g, r]) => (
          <li key={g}>
            <b>{g}</b> {label[r!.decision!]} · {memberName(members.find((m) => m.user_id === r!.by))} ·{" "}
            {r!.at ? new Date(r!.at).toLocaleDateString("pt-BR") : ""}
            {r!.note ? ` · ${r!.note}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useState } from "react";

const PRIORITY_OPTIONS = [
  {
    value: "urgent",
    label: "🔴 Urgente",
    help: "Para tudo o que o designer está fazendo e absorve esta demanda.",
    cls: "border-red-500 bg-red-50 text-red-800 ring-2 ring-red-100",
  },
  {
    value: "high",
    label: "🟠 Importante",
    help: "Entra no fluxo, na ordem das demandas.",
    cls: "border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-100",
  },
] as const;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Formulário público de briefing: quem pede a demanda não precisa de conta no app. */
export default function BriefingForm({ token, members }: { token: string; members: { id: string; name: string }[] }) {
  const empty = { name: "", email: "", title: "", description: "", due: "", priority: "", assignee: "", website: "" };
  const [f, setF] = useState(empty);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.priority) return setError("Escolha a prioridade: Urgente ou Importante.");
    setSending(true);
    const res = await fetch(`/api/forms/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const json = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return setError(json.error ?? "Não deu para enviar. Tente de novo.");
    setDone(f.title);
    // Mantém nome e e-mail para quem vai pedir outra demanda
    setF({ ...empty, name: f.name, email: f.email });
  }

  if (done) {
    return (
      <div className="rounded-xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">✅</div>
        <p className="mt-2 text-lg font-semibold text-slate-800">Demanda enviada!</p>
        <p className="mt-1 text-sm text-slate-500">
          &quot;{done}&quot; já está na lista da equipe. Se precisar mudar algo, fale com o responsável.
        </p>
        <button onClick={() => setDone(null)} className="mt-5 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50">
          Enviar outra demanda
        </button>
      </div>
    );
  }

  const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100";
  const label = "mb-1 block text-sm font-semibold text-slate-700";

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl bg-white p-5 shadow-sm sm:p-7">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bf-name" className={label}>
            Seu nome
          </label>
          <input id="bf-name" required value={f.name} onChange={set("name")} autoComplete="name" className={input} />
        </div>
        <div>
          <label htmlFor="bf-email" className={label}>
            Seu e-mail
          </label>
          <input id="bf-email" required type="email" value={f.email} onChange={set("email")} autoComplete="email" className={input} />
        </div>
      </div>

      <div>
        <label htmlFor="bf-title" className={label}>
          Nome da demanda
        </label>
        <input id="bf-title" required value={f.title} onChange={set("title")} placeholder="Ex.: Arte para a campanha de Black Friday" className={input} />
      </div>

      <div>
        <label htmlFor="bf-desc" className={label}>
          Descrição do que você precisa
        </label>
        <textarea
          id="bf-desc"
          required
          rows={6}
          value={f.description}
          onChange={set("description")}
          placeholder="Objetivo, onde vai ser usado, formatos e tamanhos, textos, referências, links…"
          className={input}
        />
      </div>

      <div>
        <label htmlFor="bf-due" className={label}>
          Deadline
        </label>
        <input id="bf-due" required type="date" min={todayISO()} value={f.due} onChange={set("due")} className={`${input} sm:w-56`} />
      </div>

      <fieldset>
        <legend className={label}>Prioridade</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRIORITY_OPTIONS.map((p) => {
            const on = f.priority === p.value;
            return (
              <label
                key={p.value}
                className={`flex cursor-pointer gap-3 rounded-lg border-2 p-3 transition ${on ? p.cls : "border-slate-200 hover:border-slate-300"}`}
              >
                <input
                  type="radio"
                  name="priority"
                  value={p.value}
                  checked={on}
                  onChange={set("priority")}
                  className="mt-1 accent-violet-600"
                />
                <span>
                  <span className="block font-semibold">{p.label}</span>
                  <span className="block text-sm leading-snug opacity-80">{p.help}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="bf-assignee" className={label}>
          Responsável
        </label>
        <select id="bf-assignee" required value={f.assignee} onChange={set("assignee")} className={input}>
          <option value="" disabled>
            Escolha quem vai fazer
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="none">Não sei, a equipe decide</option>
        </select>
      </div>

      {/* Isca para robôs: escondida de pessoas */}
      <input
        type="text"
        name="website"
        value={f.website}
        onChange={set("website")}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        disabled={sending}
        className="w-full rounded-lg bg-violet-600 py-3 text-base font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {sending ? "Enviando…" : "Enviar demanda"}
      </button>
    </form>
  );
}

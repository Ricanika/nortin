// Gestão de PDV: tipos e cálculos (antes × depois da visita) usados na tela e no servidor.

export interface PdvPartner {
  codparc: number;
  nome: string;
  razao: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  vendedor: string | null;
  key_account: string | null;
  updated_at: string;
}
export interface PdvMonth {
  codparc: number;
  mes: string; // AAAA-MM-01
  valor: number;
  notas: number;
}
export interface PdvBaseMonth {
  mes: string;
  valor: number;
  clientes: number;
}
export interface PdvCurveItem {
  codparc: number;
  codprod: number;
  descricao: string;
  referencia: string | null;
  marca: string | null;
  valor: number;
  qtd: number;
  share: number;
  curva: "A" | "B" | "C";
  rank: number;
  tem_foto_erp: boolean;
}
export interface PdvData {
  checklist?: Record<string, boolean>;
  photos?: { antes?: string[]; depois?: string[] };
  visited_at?: string;
  notes?: string;
}

export const CHECKLIST: { key: string; label: string }[] = [
  { key: "exposicao", label: "Produtos expostos na gôndola" },
  { key: "frente", label: "Frente organizada (facing)" },
  { key: "preco", label: "Preço visível em todos os itens" },
  { key: "pop", label: "Material de PDV instalado (wobbler, faixa, display)" },
  { key: "ruptura", label: "Sem ruptura (nenhum produto em falta)" },
  { key: "concorrente", label: "Espaço igual ou maior que o concorrente" },
  { key: "estoque", label: "Estoque da loja contado" },
];

export const BEFORE_MONTHS = 6;
export const AFTER_MONTHS = 3;

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export interface Period {
  meses: number;
  valor: number;
  notas: number;
  media: number; // venda média por mês
  freq: number; // compras por mês
  ticket: number | null;
}
export interface Impact {
  visita: string;
  antes: Period;
  depois: Period | null; // null = ainda não fechou o 1º mês após a visita
  vendas: number | null; // variação %, ex.: 0.23
  frequencia: number | null;
  base: number | null; // variação da base no mesmo período
  acimaBase: number | null; // pontos percentuais acima da base
}

function period(rows: { mes: string; valor: number; notas: number }[], months: string[]): Period {
  const sel = months.map((m) => rows.find((r) => r.mes === m));
  const valor = sel.reduce((s, r) => s + Number(r?.valor ?? 0), 0);
  const notas = sel.reduce((s, r) => s + Number(r?.notas ?? 0), 0);
  const n = months.length || 1;
  return { meses: months.length, valor, notas, media: valor / n, freq: notas / n, ticket: notas ? valor / notas : null };
}

/**
 * Antes = média dos 6 meses fechados anteriores ao mês da visita.
 * Depois = meses fechados após o mês da visita (até 3). O mês da visita fica de fora dos dois.
 */
export function computeImpact(visit: string | null | undefined, sales: PdvMonth[], base: PdvBaseMonth[], today = new Date()): Impact | null {
  if (!visit) return null;
  const v = new Date(visit.length === 10 ? `${visit}T12:00:00` : visit);
  if (Number.isNaN(v.getTime())) return null;
  const vm = new Date(v.getFullYear(), v.getMonth(), 1);
  const current = new Date(today.getFullYear(), today.getMonth(), 1);
  const before = Array.from({ length: BEFORE_MONTHS }, (_, i) => monthKey(addMonths(vm, i - BEFORE_MONTHS)));
  const after: string[] = [];
  for (let i = 1; i <= AFTER_MONTHS; i++) {
    const m = addMonths(vm, i);
    if (m < current) after.push(monthKey(m));
  }
  const antes = period(sales, before);
  const depois = after.length ? period(sales, after) : null;
  const pct = (a: number, b: number) => (b > 0 ? a / b - 1 : null);
  const baseRows = base.map((b) => ({ mes: b.mes, valor: Number(b.valor), notas: 0 }));
  const baseGrowth = depois ? pct(period(baseRows, after).media, period(baseRows, before).media) : null;
  const vendas = depois ? pct(depois.media, antes.media) : null;
  return {
    visita: v.toISOString(),
    antes,
    depois,
    vendas,
    frequencia: depois ? pct(depois.freq, antes.freq) : null,
    base: baseGrowth,
    acimaBase: vendas !== null && baseGrowth !== null ? vendas - baseGrowth : null,
  };
}

/** Data da visita: o check-in, senão o prazo. */
export const visitDate = (t: { pdv?: PdvData | null; due_date?: string | null }) => t.pdv?.visited_at ?? t.due_date ?? null;

export const brl = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const pctLabel = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
export const ppLabel = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)} p.p.`;

export function fullAddress(p: Pick<PdvPartner, "endereco" | "bairro" | "cidade" | "uf" | "cep">) {
  const cep = p.cep ? p.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2") : null;
  return [p.endereco, p.bairro, [p.cidade, p.uf].filter(Boolean).join(" - "), cep].filter(Boolean).join(", ");
}
export const mapsUrl = (addr: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;

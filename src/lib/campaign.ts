/** Resultados de campanha por plataforma. CPC nunca é guardado: é gasto ÷ cliques. */

export type Platform = "google" | "meta";

export const PLATFORMS: { value: Platform; label: string; short: string; color: string }[] = [
  { value: "google", label: "Google", short: "G", color: "#ea4335" },
  { value: "meta", label: "Meta", short: "M", color: "#0866ff" },
];

export interface CampaignResult {
  task_id: string;
  platform: Platform;
  impressions: number;
  clicks: number;
  spend: number;
}

export interface Metrics {
  impressions: number;
  clicks: number;
  spend: number;
}

/** O banco devolve numeric como texto: normaliza para número. */
export function toResult(row: Record<string, unknown>): CampaignResult {
  return {
    task_id: String(row.task_id),
    platform: row.platform as Platform,
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    spend: Number(row.spend) || 0,
  };
}

export function sumMetrics(rows: Metrics[]): Metrics {
  return rows.reduce(
    (acc, r) => ({ impressions: acc.impressions + r.impressions, clicks: acc.clicks + r.clicks, spend: acc.spend + r.spend }),
    { impressions: 0, clicks: 0, spend: 0 },
  );
}

export const cpc = (m: Metrics) => (m.clicks > 0 ? m.spend / m.clicks : null);

const intFmt = new Intl.NumberFormat("pt-BR");
const compactFmt = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const moneyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const fmtInt = (n: number) => intFmt.format(n);
export const fmtCompact = (n: number) => (n >= 10000 ? compactFmt.format(n) : intFmt.format(n));
export const fmtMoney = (n: number) => moneyFmt.format(n);

/** Aceita "1.234,56", "1234,56", "1234.56" e "R$ 1.234,56". */
export function parseNumberBR(input: string): number {
  let s = input.replace(/[R$\s]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

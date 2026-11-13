/** Redes sociais: nomes, cores e o calendário de atualização das métricas. */

export interface SocialChannel {
  task_id: string;
  platform: string;
  ghl_account_id: string;
  account_name: string | null;
  ghl_post_id: string | null;
  status: "scheduled" | "published" | "failed";
  link: string | null;
  error: string | null;
  published_at: string | null;
  likes: number;
  comments: number;
  shares: number;
  /** ALCANCE digitado por canal (nos stories, as views). A coluna do banco se chama impressions. */
  impressions: number;
  metrics_at: string | null;
}

export interface MediaItem {
  url: string;
  type: string; // mime, ex.: image/png, video/mp4
  name?: string;
}

export const NETWORKS: Record<string, { label: string; short: string; color: string }> = {
  instagram: { label: "Instagram", short: "IG", color: "#e1306c" },
  facebook: { label: "Facebook", short: "FB", color: "#1877f2" },
  tiktok: { label: "TikTok", short: "TT", color: "#111827" },
  linkedin: { label: "LinkedIn", short: "IN", color: "#0a66c2" },
  youtube: { label: "YouTube", short: "YT", color: "#ff0000" },
  google: { label: "Google Empresa", short: "GB", color: "#34a853" },
  pinterest: { label: "Pinterest", short: "PI", color: "#e60023" },
};

/** Redes que entram no post por padrão (as do pedido); Google Empresa e Pinterest ficam opcionais. */
export const DEFAULT_NETWORKS = ["instagram", "facebook", "tiktok", "linkedin", "youtube"];

export const networkOf = (platform: string) =>
  NETWORKS[platform] ?? { label: platform, short: platform.slice(0, 2).toUpperCase(), color: "#64748b" };

/**
 * Próxima busca de métricas: todo dia na 1ª semana após publicar,
 * toda semana até completar 30 dias, depois 1 vez por mês.
 */
export function nextSyncAt(publishedAt: Date, now = new Date()): Date {
  const ageDays = (now.getTime() - publishedAt.getTime()) / 864e5;
  const step = ageDays < 7 ? 1 : ageDays < 30 ? 7 : 30;
  return new Date(now.getTime() + step * 864e5);
}

/** Curtidas + comentários + compartilhamentos */
export const interactions = (c: Pick<SocialChannel, "likes" | "comments" | "shares">) => c.likes + c.comments + c.shares;

export interface ContentTotals {
  /** alcance (coluna impressions) */
  impressions: number;
  /** engajamento = curtidas + comentários + compartilhamentos */
  interactions: number;
  likes: number;
  comments: number;
  shares: number;
  /** taxa de engajamento = engajamento ÷ alcance; null quando não há alcance */
  engagement: number | null;
}

/** Soma dos canais. O engajamento usa só os canais com impressões, para não distorcer a taxa. */
export function contentTotals(channels: SocialChannel[]): ContentTotals {
  const sum = (k: "impressions" | "likes" | "comments" | "shares") => channels.reduce((n, c) => n + (c[k] || 0), 0);
  const withImp = channels.filter((c) => c.impressions > 0);
  const imp = withImp.reduce((n, c) => n + c.impressions, 0);
  return {
    impressions: sum("impressions"),
    likes: sum("likes"),
    comments: sum("comments"),
    shares: sum("shares"),
    interactions: sum("likes") + sum("comments") + sum("shares"),
    engagement: imp > 0 ? withImp.reduce((n, c) => n + interactions(c), 0) / imp : null,
  };
}

const pctFmt = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const numFmt = new Intl.NumberFormat("pt-BR");
export const fmtPct = (v: number | null) => (v === null ? "—" : pctFmt.format(v));
export const fmtNum = (v: number) => numFmt.format(v);

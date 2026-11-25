// Processo de Criação e Lançamento de Produtos (Nitron v1.0): trilhas, fases, portões e cadastro.

export type Trilha = "A" | "B" | "C" | "D" | "E" | "F";
export type Phase = "F0" | "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "MANTIDO" | "ENCERRADO";
export type Gate = "G0" | "G1" | "G2" | "G3" | "G4" | "G5";
export type GateDecision = "aprovado" | "ajustar" | "reprovado";

export interface GateRecord {
  decision?: GateDecision;
  by?: string; // user_id
  at?: string;
  note?: string;
  criteria?: Record<string, boolean>;
}

export interface LaunchData {
  trilha?: Trilha;
  rota?: "A" | "B" | "revenda"; // trilha F: fabricar (A/B) ou revenda
  extras?: Trilha[]; // projeto que mistura tipos: áreas da outra trilha
  // G0
  busca?: string; // as 3 palavras procuradas no catálogo
  busca_resultado?: string;
  troca_soma?: "troca" | "soma";
  sku_sai?: string;
  hipotese?: string;
  publico?: string;
  litragem?: string;
  clientes_sku?: string;
  // G1
  preco_alvo?: string;
  margem_alvo?: string;
  volume_12m?: string;
  investimento?: string;
  payback?: string;
  meta_12m?: string;
  meta_clientes?: string;
  criterio_corte?: string;
  // F4 em diante
  codprod?: string;
  cadastro?: Record<string, boolean>;
  lancado_em?: string; // quando passou no G4
  gates?: Partial<Record<Gate, GateRecord>>;
  encerrado_motivo?: string;
}

export const TRILHAS: Record<Trilha, { nome: string; desc: string; cor: string; projetos: boolean }> = {
  A: { nome: "Produto novo", desc: "molde novo do zero", cor: "#1d4ed8", projetos: true },
  B: { nome: "Derivação de molde", desc: "alterar ou adaptar molde existente", cor: "#0f766e", projetos: true },
  C: { nome: "Cor, pigmento e sublinha", desc: "mesmo molde, nova aparência", cor: "#a16207", projetos: false },
  D: { nome: "Embalagem", desc: "nova embalagem ou apresentação", cor: "#7e22ce", projetos: false },
  E: { nome: "Kit e multipack", desc: "combinação de itens existentes", cor: "#be123c", projetos: false },
  F: { nome: "Nova categoria", desc: "decisão estratégica (fabricar ou revenda)", cor: "#334155", projetos: true },
};

/** Portão 0: a primeira resposta "sim" define a trilha. */
export const PORTAO0: { q: string; t: Trilha }[] = [
  { q: "O produto é de uma categoria em que a Nitron não atua hoje?", t: "F" },
  { q: "Precisa de molde novo (peça que não existe)?", t: "A" },
  { q: "Precisa alterar um molde existente (inserto, gravação, tampa nova, mudança de geometria, adaptação de produto interno)?", t: "B" },
  { q: "O produto físico é o mesmo e muda cor, pigmento, efeito ou cria uma sublinha?", t: "C" },
  { q: "O produto é o mesmo e muda embalagem, quantidade por pacote/master ou a apresentação?", t: "D" },
  { q: "Junta dois ou mais itens existentes num código vendável único?", t: "E" },
];

export const PHASES: { key: Phase; nome: string }[] = [
  { key: "F0", nome: "Ideia e triagem" },
  { key: "F1", nome: "Conceito e business case" },
  { key: "F2", nome: "Projeto e protótipo" },
  { key: "F3", nome: "Ferramentaria e tryout" },
  { key: "F4", nome: "Industrialização e cadastro" },
  { key: "F5", nome: "Lote piloto e estoque" },
  { key: "F6", nome: "Lançamento" },
  { key: "F7", nome: "Acompanhamento" },
  { key: "MANTIDO", nome: "Mantido" },
];

/** Fases da trilha (D e E não passam pela ferramentaria; revenda também não). */
export function phasesFor(d: LaunchData): Phase[] {
  const skipF3 = d.trilha === "D" || d.trilha === "E" || (d.trilha === "F" && d.rota === "revenda");
  return PHASES.map((p) => p.key).filter((k) => !(skipF3 && k === "F3"));
}

/** O que cada fase significa em cada trilha (resumo da tabela do fluxo-mestre). */
export function phaseHint(p: Phase, t?: Trilha): string | null {
  if (!t) return null;
  const h: Partial<Record<Phase, Partial<Record<Trilha, string>>>> = {
    F1: { A: "completo", F: "portão estratégico da diretoria" },
    F2: { B: "projeto da alteração", C: "amostra de cor", D: "mock-up de embalagem", E: "montagem-piloto do kit" },
    F3: { C: "teste de dosagem" },
    F5: { D: "1º lote", E: "1º lote" },
    F6: { A: "campanha", B: "campanha ou comunicado", C: "comunicação da linha", D: "comunicado", E: "comunicado ou campanha", F: "campanha" },
  };
  return h[p]?.[t] ?? (p === "F1" ? "simplificado" : null);
}

/** Portão que fecha cada fase. */
export const GATE_AFTER: Partial<Record<Phase, Gate>> = { F0: "G0", F1: "G1", F2: "G2", F4: "G3", F5: "G4", F7: "G5" };

export const GATES: Record<Gate, { pergunta: string; criterios: (t?: Trilha) => string[] }> = {
  G0: {
    pergunta: "Vale estudar? Qual trilha?",
    criterios: (t) => [
      "Não existe no catálogo (busca com 3 palavras)",
      "Trilha definida",
      "Hipótese de demanda escrita",
      ...(t === "C" || t === "D" || t === "E" ? ["Respondido: troca ou soma um SKU?"] : []),
    ],
  },
  G1: {
    pergunta: "Vale investir?",
    criterios: () => ["Preço-alvo", "Margem-alvo", "Volume de 12 meses", "Investimento e payback", "Meta de 12 meses e critério de corte"],
  },
  G2: {
    pergunta: "Libera o investimento?",
    criterios: (t) => [
      t === "C" ? "Padrão de cor aprovado" : t === "D" ? "Embalagem aprovada" : t === "E" ? "Kit aprovado" : "Desenho congelado",
      "Orçamento fechado",
      "Máquina, pigmento ou embalagem definidos",
    ],
  },
  G3: {
    pergunta: "Pronto para produzir?",
    criterios: () => ["Checklist de cadastro 100% fechado", "Embalagem aprovada pela Qualidade"],
  },
  G4: {
    pergunta: "Libera a venda?",
    criterios: () => ["Estoque disponível", "Preço ativo nas tabelas", "Nota fiscal de teste emitida sem erro", "Material de marketing pronto"],
  },
  G5: {
    pergunta: "Manter, ajustar ou descontinuar?",
    criterios: () => ["Faturamento contra a meta do G1", "Número de clientes", "Margem real contra a orçada", "Devolução", "Ruptura e saldo", "Efeito no SKU irmão"],
  },
};

/** Quem decide cada portão, por trilha. */
export function gateOwner(g: Gate, t?: Trilha): string {
  switch (g) {
    case "G0":
      return "Marketing de Produto";
    case "G1":
      return t === "D" || t === "E" ? "Marketing + Comercial" : t === "F" ? "Diretoria" : "Comitê de Produto";
    case "G2":
      return t === "A" || t === "B" || t === "F" ? "Comitê de Produto" : "Qualidade + Marketing";
    case "G3":
      return "PCP";
    case "G4":
      return "Comercial + Qualidade";
    case "G5":
      return "Comitê de Produto";
  }
}

/** Checklist de cadastro no ERP (F4), com o que vale em cada trilha e o responsável. */
export const CADASTRO: { key: string; item: string; area: string; regra: Partial<Record<Trilha, string | false>> }[] = [
  { key: "codprod", item: "CODPROD novo", area: "PCP", regra: { C: "um por cor", D: "só se mudar a quantidade ou a unidade vendida" } },
  { key: "referencia", item: "Referência (NNN.XXX.XXX)", area: "PCP", regra: { C: "regra de formação vigente", D: "mantém, se for o mesmo código" } },
  { key: "ean", item: "EAN-13 (GS1)", area: "Marketing", regra: { C: "um por cor", D: "novo se mudar a unidade vendida" } },
  { key: "dun", item: "DUN-14 (caixa master)", area: "Qualidade", regra: { D: "novo se mudar a quantidade na master" } },
  { key: "fiscal", item: "NCM, CEST e tributação", area: "Fiscal", regra: { C: "herdar e validar", D: "herdar", E: "definir (sortido)" } },
  { key: "estrutura", item: "Estrutura PA → PI", area: "PCP", regra: { C: "PI na nova cor + pigmento", D: "troca o componente de embalagem", E: "componentes + embalagem do kit" } },
  { key: "roteiro", item: "Roteiro e tempo-padrão", area: "PCP", regra: { C: "herda; setup de cor", D: "herda", E: "kitting" } },
  { key: "tecnicos", item: "Campos técnicos (tonelagem, cavidades, cor)", area: "PCP", regra: { C: "preencher cor", D: false, E: false } },
  { key: "embalagem", item: "Embalagem: pacote, master e palete", area: "Qualidade", regra: { C: "herda ou nova" } },
  { key: "preco", item: "Preço em todas as tabelas", area: "Comercial", regra: { D: "revisar", E: "regra de preço do kit" } },
  { key: "foto", item: "Foto, arte e ficha técnica", area: "Marketing", regra: { C: "foto nova", D: "arte nova", E: "foto e arte" } },
  { key: "estoque", item: "Local de estoque e endereço", area: "Estoque", regra: { D: "revisar dimensões" } },
  { key: "sku_sai", item: "SKU que sai", area: "Marketing de Produto", regra: { A: "avaliar", B: "avaliar", C: "obrigatório declarar", D: "esgotar a embalagem antiga", E: false } },
];

export const cadastroFor = (t?: Trilha) => CADASTRO.filter((c) => (t ? c.regra[t] !== false : true));

/** Áreas por trilha (matriz da página 6): true = obrigatória, "opc" = quando aplicável. */
export const AREAS: { area: string; t: Record<Trilha, boolean | "opc"> }[] = [
  { area: "Marketing de Produto", t: { A: true, B: true, C: true, D: true, E: true, F: true } },
  { area: "Projetos / Ferramentaria", t: { A: true, B: true, C: false, D: false, E: false, F: false } },
  { area: "Comercial: precificação", t: { A: true, B: true, C: true, D: "opc", E: true, F: true } },
  { area: "PCP", t: { A: true, B: true, C: true, D: true, E: true, F: true } },
  { area: "Fiscal", t: { A: true, B: true, C: true, D: "opc", E: true, F: true } },
  { area: "Qualidade", t: { A: true, B: true, C: true, D: true, E: true, F: true } },
  { area: "Compras", t: { A: "opc", B: "opc", C: true, D: true, E: "opc", F: true } },
  { area: "Injeção", t: { A: true, B: true, C: true, D: false, E: false, F: false } },
  { area: "Montagem", t: { A: "opc", B: "opc", C: "opc", D: "opc", E: true, F: "opc" } },
  { area: "Estoque e Expedição", t: { A: true, B: true, C: true, D: true, E: true, F: true } },
  { area: "Comercial: vendas", t: { A: true, B: true, C: true, D: true, E: true, F: true } },
  { area: "Marketing: campanha", t: { A: true, B: "opc", C: "opc", D: "opc", E: "opc", F: true } },
];

/** Fase do status pelo nome ("F2 · Projeto..." → F2). */
export function phaseOfStatus(name?: string | null): Phase | null {
  if (!name) return null;
  const m = name.trim().match(/^F([0-7])\b/);
  if (m) return `F${m[1]}` as Phase;
  if (/^mantid/i.test(name)) return "MANTIDO";
  if (/^encerrad/i.test(name)) return "ENCERRADO";
  return null;
}

/** Revisões do acompanhamento (90/180/365 dias após liberar a venda). */
export function reviews(lancadoEm?: string) {
  if (!lancadoEm) return [];
  const base = new Date(lancadoEm);
  return [90, 180, 365].map((d) => ({ dias: d, data: new Date(base.getTime() + d * 864e5) }));
}

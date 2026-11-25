import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sankhyaProductImage, sankhyaQuery } from "./sankhya";

// Venda de site/marketplace fica fora da base de comparação (o PDV é loja física)
const MARKETPLACE_TOPS = "3225, 3226";

/** Usa a view do TI (AD_VW_MERCH_*); se ela ainda não existir, a consulta direta equivalente. */
async function viewOr(viewSql: string, rawSql: string) {
  try {
    return await sankhyaQuery(viewSql);
  } catch {
    return sankhyaQuery(rawSql);
  }
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);

/** Copia do Sankhya: cadastro, vendas por mês (24 meses) e curva de produtos (12 meses) da loja. */
export async function refreshPartner(db: SupabaseClient, codparc: number) {
  if (!Number.isInteger(codparc) || codparc <= 0) throw new Error("Código de parceiro inválido");

  const [p] = await viewOr(
    `SELECT CODPARC, NOMEPARC, RAZAOSOCIAL, ENDERECO, COMPLEMENTO, BAIRRO NOMEBAI, CIDADE NOMECID, UF, CEP, TELEFONE, VENDEDOR, KEY_ACCOUNT
       FROM AD_VW_MERCH_PARCEIRO WHERE CODPARC = ${codparc}`,
    `
    SELECT P.CODPARC, P.NOMEPARC, P.RAZAOSOCIAL, E.NOMEEND, P.NUMEND, P.COMPLEMENTO, B.NOMEBAI, C.NOMECID, U.UF, P.CEP,
           P.TELEFONE, V.APELIDO VENDEDOR,
           (SELECT MAX(N.KEY_ACCOUNT) FROM AD_VW_COM_NOTAS N WHERE N.CODPARC = P.CODPARC) KEY_ACCOUNT
      FROM TGFPAR P
      LEFT JOIN TSIEND E ON E.CODEND = P.CODEND
      LEFT JOIN TSIBAI B ON B.CODBAI = P.CODBAI
      LEFT JOIN TSICID C ON C.CODCID = P.CODCID
      LEFT JOIN TSIUFS U ON U.CODUF = C.UF
      LEFT JOIN TGFVEN V ON V.CODVEND = P.CODVEND
     WHERE P.CODPARC = ${codparc}`,
  );
  if (!p) throw new Error(`Parceiro ${codparc} não encontrado no Sankhya`);

  const rua = txt(p.ENDERECO) ?? [txt(p.NOMEEND), txt(p.NUMEND)].filter(Boolean).join(", ");
  const partner = {
    codparc,
    nome: txt(p.NOMEPARC) ?? `Parceiro ${codparc}`,
    razao: txt(p.RAZAOSOCIAL),
    endereco: [rua, txt(p.COMPLEMENTO)].filter(Boolean).join(" - ") || null,
    bairro: txt(p.NOMEBAI),
    cidade: txt(p.NOMECID),
    uf: txt(p.UF),
    cep: txt(p.CEP),
    telefone: txt(p.TELEFONE),
    vendedor: txt(p.VENDEDOR),
    key_account: txt(p.KEY_ACCOUNT),
    updated_at: new Date().toISOString(),
  };

  const months = await viewOr(
    `SELECT MES, VALOR, NOTAS FROM AD_VW_MERCH_VENDAS_MES WHERE CODPARC = ${codparc}`,
    `
    SELECT TO_CHAR(TRUNC(N.DATA, 'MM'), 'YYYY-MM') MES, SUM(N.VALOR_NOTA) VALOR, COUNT(*) NOTAS
      FROM AD_VW_COM_NOTAS N
     WHERE N.CODPARC = ${codparc} AND N.DATA >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -24)
     GROUP BY TRUNC(N.DATA, 'MM')`,
  );

  const items = await viewOr(
    `SELECT * FROM (SELECT CODPROD, DESCRPROD, REFERENCIA, MARCA, VALOR, QTD, TEM_FOTO TEMFOTO
       FROM AD_VW_MERCH_PRODUTOS_12M WHERE CODPARC = ${codparc} ORDER BY VALOR DESC) FETCH FIRST 300 ROWS ONLY`,
    `
    SELECT * FROM (
      SELECT I.CODPROD, P.DESCRPROD, P.REFERENCIA, P.MARCA, SUM(I.VLRTOT) VALOR, SUM(I.QTDNEG) QTD,
             CASE WHEN P.IMAGEM IS NULL THEN 'N' ELSE 'S' END TEMFOTO
        FROM AD_VW_COM_NOTAS N
        JOIN TGFITE I ON I.NUNOTA = N.NUNOTA
        JOIN TGFPRO P ON P.CODPROD = I.CODPROD
       WHERE N.CODPARC = ${codparc} AND N.DATA >= ADD_MONTHS(SYSDATE, -12)
       GROUP BY I.CODPROD, P.DESCRPROD, P.REFERENCIA, P.MARCA, CASE WHEN P.IMAGEM IS NULL THEN 'N' ELSE 'S' END
       ORDER BY VALOR DESC
    ) FETCH FIRST 300 ROWS ONLY`,
  );

  // Curva ABC: A até 80% do valor acumulado, B até 95%, C o resto
  const total = items.reduce((s, i) => s + num(i.VALOR), 0) || 1;
  let acc = 0;
  const curve = items.map((i, idx) => {
    const share = num(i.VALOR) / total;
    const curva = acc < 0.8 ? "A" : acc < 0.95 ? "B" : "C";
    acc += share;
    return {
      codparc,
      codprod: num(i.CODPROD),
      descricao: txt(i.DESCRPROD) ?? `Produto ${i.CODPROD}`,
      referencia: txt(i.REFERENCIA),
      marca: txt(i.MARCA),
      valor: num(i.VALOR),
      qtd: num(i.QTD),
      share,
      curva,
      rank: idx + 1,
      tem_foto_erp: i.TEMFOTO === "S",
      updated_at: new Date().toISOString(),
    };
  });

  const e1 = (await db.from("pdv_partners").upsert(partner)).error;
  if (e1) throw new Error(e1.message);
  await db.from("pdv_sales_monthly").delete().eq("codparc", codparc);
  if (months.length) {
    const e2 = (
      await db
        .from("pdv_sales_monthly")
        .insert(months.map((m) => ({ codparc, mes: `${m.MES}-01`, valor: num(m.VALOR), notas: num(m.NOTAS) })))
    ).error;
    if (e2) throw new Error(e2.message);
  }
  await db.from("pdv_curve").delete().eq("codparc", codparc);
  if (curve.length) {
    const e3 = (await db.from("pdv_curve").insert(curve)).error;
    if (e3) throw new Error(e3.message);
  }
  await copyErpPhotos(db, curve.filter((c) => c.curva === "A" && c.tem_foto_erp).slice(0, 30).map((c) => c.codprod));
  return partner;
}

/** Fotos dos produtos da curva A que estão no Sankhya e ainda não temos (best effort). */
async function copyErpPhotos(db: SupabaseClient, codprods: number[]) {
  if (!codprods.length) return;
  const { data: have } = await db.from("pdv_product_photos").select("codprod").in("codprod", codprods);
  const missing = codprods.filter((c) => !have?.some((h) => h.codprod === c));
  for (const codprod of missing.slice(0, 15)) {
    const img = await sankhyaProductImage(codprod).catch(() => null);
    if (!img) continue;
    const ext = img.type.split("/")[1]?.split(";")[0] || "jpg";
    const path = `erp/${codprod}.${ext}`;
    const up = await db.storage.from("pdv").upload(path, img.bytes, { contentType: img.type, upsert: true });
    if (up.error) continue;
    const url = db.storage.from("pdv").getPublicUrl(path).data.publicUrl;
    await db.from("pdv_product_photos").upsert({ codprod, url, origem: "erp", updated_at: new Date().toISOString() });
  }
}

/** Vendas mensais de toda a base de lojas (24 meses), para comparar o crescimento. */
export async function refreshBase(db: SupabaseClient) {
  const rows = await viewOr(
    `SELECT MES, VALOR, CLIENTES FROM AD_VW_MERCH_BASE_MES`,
    `
    SELECT TO_CHAR(TRUNC(N.DATA, 'MM'), 'YYYY-MM') MES, SUM(N.VALOR_NOTA) VALOR, COUNT(DISTINCT N.CODPARC) CLIENTES
      FROM AD_VW_COM_NOTAS N
     WHERE N.DATA >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -24) AND N.CODTIPOPER NOT IN (${MARKETPLACE_TOPS})
     GROUP BY TRUNC(N.DATA, 'MM')`,
  );
  if (!rows.length) return 0;
  const { error } = await db
    .from("pdv_base_monthly")
    .upsert(rows.map((r) => ({ mes: `${r.MES}-01`, valor: num(r.VALOR), clientes: num(r.CLIENTES) })));
  if (error) throw new Error(error.message);
  return rows.length;
}

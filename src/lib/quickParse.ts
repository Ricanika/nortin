import { addDays, nextWeekday, ymd } from "./dates";
import type { Member, Priority, Recurrence } from "./types";

/**
 * Entende uma frase de criação rápida, digitada ou ditada:
 *   "Ligar comprador Assaí @bia amanhã !urgente"
 *   "Bia, ligar pro Assaí até sexta, é urgente"
 *   "Revisar tabela pra Ana dia 15, é importante"
 *   "Relatório de vendas toda sexta @ana"  (recorrente)
 * Tira da frase o que é responsável, prazo e prioridade; o resto vira o título.
 */
export interface Parsed {
  title: string;
  assignees: string[];
  due: string | null;
  priority: Priority | null;
  recurrence: Recurrence | null;
}

// \b do JS não entende acentos: estas fronteiras usam letras Unicode.
const S = "(?<![\\p{L}\\d])";
const E = "(?![\\p{L}\\d])";
const re = (src: string, flags = "iu") => new RegExp(src.replaceAll("‹", S).replaceAll("›", E), flags);

const WEEKDAYS: [RegExp, number][] = [
  [/^dom/, 0],
  [/^seg/, 1],
  [/^ter/, 2],
  [/^qua/, 3],
  [/^qui/, 4],
  [/^sex/, 5],
  [/^s[aá]b/, 6],
];

const PRIORITY_WORDS: Record<string, Priority> = {
  urgente: "urgent",
  importante: "high",
  alta: "high",
};

export function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function findMember(word: string, members: Member[]): Member | undefined {
  const w = normalize(word);
  if (w.length < 2) return undefined;
  const keys = (m: Member) =>
    [m.full_name?.split(/\s+/)[0], m.full_name, m.email?.split("@")[0]].filter(Boolean).map((k) => normalize(k!));
  return (
    members.find((m) => keys(m).some((k) => k === w)) ??
    (w.length >= 3 ? members.find((m) => keys(m).some((k) => k.startsWith(w))) : undefined)
  );
}

export function parseQuick(input: string, members: Member[], base = new Date()): Parsed {
  let text = ` ${input} `;
  let due: string | null = null;
  let priority: Priority | null = null;
  let recurrence: Recurrence | null = null;
  const assignees: string[] = [];

  const take = (pattern: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    let m: RegExpExecArray | null;
    const global = pattern.flags.includes("g");
    while ((m = pattern.exec(text))) {
      const keep = fn(m) === false;
      if (!keep) {
        text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
        pattern.lastIndex = m.index;
      }
      if (!global) break;
    }
  };
  const assign = (word: string) => {
    const member = findMember(word, members);
    if (!member) return false;
    if (!assignees.includes(member.user_id)) assignees.push(member.user_id);
    return true;
  };

  // Prioridade
  take(re("(?:^|\\s)!(urgente|importante|alta)›"), (m) => {
    priority = PRIORITY_WORDS[normalize(m[1])] ?? null;
  });
  if (!priority) {
    take(re(",?\\s*prioridade\\s+(urgente|importante|alta)›"), (m) => {
      priority = PRIORITY_WORDS[normalize(m[1])] ?? null;
    });
  }
  if (!priority) {
    take(re(",?\\s*(?:[eé]\\s+)?(?:muito\\s+)?‹urgente›"), () => {
      priority = "urgent";
    });
  }
  // Prioridades que não existem mais (!baixa, !normal, !média): só somem do título
  take(re("(?:^|\\s)!(?:baixa|normal|m[eé]dia)›"), () => {});
  // "importante" solto pode ser parte do título; só vale como ", é importante"
  if (!priority) {
    take(re(",?\\s*[eé]\\s+(?:muito\\s+)?‹importante›"), () => {
      priority = "high";
    });
  }

  // Responsáveis: @nome, "para/pra/pro (o|a) Nome", ou "Nome," no começo
  take(re("@([\\p{L}][\\p{L}.\\-]*)", "giu"), (m) => assign(m[1]));
  take(re("‹(?:para|pra|pro|p\\/)\\s+(?:o\\s+|a\\s+)?([\\p{L}]+)›", "giu"), (m) => assign(m[1]));
  take(re("^\\s*([\\p{L}]+)\\s*,"), (m) => assign(m[1]));
  take(re("‹(?:e|com)\\s+(?:o\\s+|a\\s+)?([\\p{L}]+)›(?=\\s*(?:$|,|\\.))", "giu"), (m) =>
    assignees.length > 0 ? assign(m[1]) : false,
  );

  // Prazo (o primeiro que aparecer vale)
  const setDue = (d: Date) => {
    if (!due) due = ymd(d);
  };

  // Recorrência (antes das datas: "toda segunda" não é só "segunda")
  const setRec = (r: Recurrence) => {
    if (!recurrence) recurrence = r;
  };
  take(re("‹(?:todos?\\s+os\\s+dias|tod[oa]\\s+dia|cada\\s+dia|diariamente)›"), () => setRec("daily"));
  take(re("‹(?:(?:nos|em)\\s+)?dias\\s+[uú]teis›|‹de\\s+segunda\\s+a\\s+sexta›"), () => setRec("weekdays"));
  take(re("‹(?:toda|cada)\\s+semana›|‹semanalmente›"), () => setRec("weekly"));
  take(re("‹(?:tod[oa]s?|cada)\\s+(?:as?\\s+|os?\\s+)?(domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado)s?(?:-feiras?|\\s+feiras?)?›"), (m) => {
    const w = normalize(m[1]);
    const idx = WEEKDAYS.find(([r]) => r.test(w))?.[1];
    if (idx === undefined) return false;
    setRec("weekly");
    // "toda segunda" numa segunda começa hoje
    setDue(addDays(base, (idx - base.getDay() + 7) % 7));
  });
  take(re("‹(?:todo|cada)\\s+m[eê]s›|‹mensalmente›"), () => setRec("monthly"));
  take(re("‹(?:todo|cada)\\s+ano›|‹anualmente›"), () => setRec("yearly"));
  const ate = "(?:at[eé]\\s+)?(?:(?:n?[oa]s?|para)\\s+)?";
  take(re(`‹${ate}depois\\s+de\\s+amanh[aã]›`), () => setDue(addDays(base, 2)));
  take(re(`‹${ate}amanh[aã]›`), () => setDue(addDays(base, 1)));
  take(re(`‹${ate}hoje›`), () => setDue(base));
  take(re(`‹${ate}(?:semana\\s+que\\s+vem|pr[oó]xima\\s+semana)›`), () => setDue(nextWeekday(base, 1)));
  take(re("‹em\\s+(\\d{1,2})\\s+dias?›"), (m) => setDue(addDays(base, Number(m[1]))));
  take(re(`‹${ate}(?:pr[oó]xim[oa]\\s+)?(domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado)(?:-feira|\\s+feira)?›`), (m) => {
    const w = normalize(m[1]);
    const idx = WEEKDAYS.find(([r]) => r.test(w))?.[1];
    if (idx !== undefined) setDue(nextWeekday(base, idx));
  });
  take(re(`‹${ate}(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?›`), (m) => {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : base.getFullYear();
    let d = new Date(year, month, day);
    if (!m[3] && ymd(d) < ymd(base)) d = new Date(++year, month, day);
    if (d.getMonth() !== month) return false;
    setDue(d);
  });
  take(re(`‹${ate}dia\\s+(\\d{1,2})›`), (m) => {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return false;
    let d = new Date(base.getFullYear(), base.getMonth(), day);
    if (ymd(d) < ymd(base)) d = new Date(base.getFullYear(), base.getMonth() + 1, day);
    setDue(d);
  });

  // Recorrente sem data: começa hoje
  if (recurrence && !due) due = ymd(base);

  const title = text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, "")
    .replace(/(,\s*)+$/g, "")
    .replace(/\s+(e|é)$/i, "")
    .trim();

  return {
    title: title ? title[0].toUpperCase() + title.slice(1) : "",
    assignees,
    due,
    priority,
    recurrence,
  };
}

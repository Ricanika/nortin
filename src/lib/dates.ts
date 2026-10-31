/** Datas sempre como AAAA-MM-DD no fuso local do usuário. */

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

export function todayISO(): string {
  return ymd(new Date());
}

/** Próxima ocorrência do dia da semana (0 = domingo). Hoje conta como "próxima semana". */
export function nextWeekday(base: Date, weekday: number): Date {
  const diff = (weekday - base.getDay() + 7) % 7 || 7;
  return addDays(base, diff);
}

export function shortcutDates(base = new Date()) {
  return [
    { label: "Hoje", date: ymd(base) },
    { label: "Amanhã", date: ymd(addDays(base, 1)) },
    { label: "Próx. segunda", date: ymd(nextWeekday(base, 1)) },
    { label: "Em 1 semana", date: ymd(addDays(base, 7)) },
  ];
}

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "Hoje", "Amanhã", "Ontem", "sex 07/11" — para chips e listas. */
export function friendlyDate(iso: string, base = new Date()): string {
  const today = ymd(base);
  if (iso === today) return "Hoje";
  if (iso === ymd(addDays(base, 1))) return "Amanhã";
  if (iso === ymd(addDays(base, -1))) return "Ontem";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === base.getFullYear();
  return `${WEEKDAY_SHORT[date.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}${sameYear ? "" : `/${String(y).slice(2)}`}`;
}

export function elevenstSaleDateRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  const pad = (number: number) => String(number).padStart(2, "0");
  const startDate = `${year}/${pad(month)}/${pad(day)}`;
  // 11st's 3y:110 period is inclusive, so its required end is start + 3 years - 1 day.
  const end = new Date(Date.UTC(year + 3, month - 1, day - 1));
  const endDate = `${end.getUTCFullYear()}/${pad(end.getUTCMonth() + 1)}/${pad(end.getUTCDate())}`;

  return {
    aplBgnDy: startDate,
    aplEndDy: endDate,
  };
}

export function elevenstSaleDateRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const startDate = `${value("year")}/${value("month")}/${value("day")}`;

  return {
    aplBgnDy: startDate,
    // The official API treats this sentinel as the maximum three-year sale period.
    aplEndDy: "2999/12/31",
  };
}

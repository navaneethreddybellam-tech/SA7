export const DEFAULT_TARIFF_INR_PER_KWH = 8.2;

export function roundEnergy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function calculateCostInr(energyKwh: number, tariffInrPerKwh: number): number {
  return Math.round(energyKwh * tariffInrPerKwh * 100) / 100;
}

export function indiaDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function indiaDayStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00+05:30`);
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

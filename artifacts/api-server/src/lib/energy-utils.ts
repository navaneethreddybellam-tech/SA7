export const DEFAULT_TARIFF_INR_PER_KWH = 8.2;

export function roundEnergy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function calculateCostInr(energyKwh: number, tariffInrPerKwh: number): number {
  return Math.round(energyKwh * tariffInrPerKwh * 100) / 100;
}

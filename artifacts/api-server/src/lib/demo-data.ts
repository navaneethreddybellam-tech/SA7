import { db, automationRulesTable, devicesTable, energyUsageTable, userSettingsTable, wasteEventsTable } from "@workspace/db";
import { calculateCostInr, DEFAULT_TARIFF_INR_PER_KWH } from "./energy-utils";

export async function createDemoData(userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(userSettingsTable).values({
      userId,
      tariffInrPerKwh: DEFAULT_TARIFF_INR_PER_KWH,
    });

    const now = Date.now();
    const [ac] = await tx
      .insert(devicesTable)
      .values({
        userId,
        name: "Living room AC",
        type: "AC",
        ratedPowerW: 1400,
        state: "ON",
        thresholdKwh: 1.1,
        maxRuntimeMinutes: 120,
        room: "Living room",
        active: true,
        onSince: new Date(now - 210 * 60 * 1000),
      })
      .returning();
    const [fan] = await tx
      .insert(devicesTable)
      .values({
        userId,
        name: "Bedroom fan",
        type: "Fan",
        ratedPowerW: 70,
        state: "OFF",
        thresholdKwh: 0.6,
        maxRuntimeMinutes: 480,
        room: "Bedroom",
        active: true,
      })
      .returning();
    const [fridge] = await tx
      .insert(devicesTable)
      .values({
        userId,
        name: "Kitchen refrigerator",
        type: "Refrigerator",
        ratedPowerW: 180,
        state: "ON",
        thresholdKwh: 1.8,
        maxRuntimeMinutes: 1440,
        room: "Kitchen",
        active: true,
        onSince: new Date(now - 8 * 60 * 60 * 1000),
      })
      .returning();

    await tx.insert(automationRulesTable).values({
      userId,
      deviceId: ac.id,
      triggerType: "runtime",
      thresholdValue: 180,
      action: "turn_off",
      enabled: true,
    });

    const demoDevices = [
      { id: ac.id, watts: 1400, minutes: 180, factor: 0.78 },
      { id: fan.id, watts: 70, minutes: 360, factor: 1 },
      { id: fridge.id, watts: 180, minutes: 1440, factor: 0.35 },
    ];
    const sampleRows = [];
    for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
      for (const device of demoDevices) {
        const energyKwh =
          Math.round((device.watts / 1000) * (device.minutes / 60) * device.factor * 1000) /
          1000;
        sampleRows.push({
          userId,
          deviceId: device.id,
          energyKwh,
          durationMinutes: device.minutes,
          recordedAt: new Date(now - daysAgo * 24 * 60 * 60 * 1000 - 60 * 60 * 1000),
          costInr: calculateCostInr(energyKwh, DEFAULT_TARIFF_INR_PER_KWH),
          simulated: true,
        });
      }
    }
    const insertedUsage = await tx.insert(energyUsageTable).values(sampleRows).returning();
    const acUsageRecords = insertedUsage.filter((row) => row.deviceId === ac.id);
    const recentAcRecord = acUsageRecords[acUsageRecords.length - 1];
    if (recentAcRecord) {
      const wastedKwh = 1.092;
      await tx.insert(wasteEventsTable).values({
        userId,
        usageId: recentAcRecord.id,
        deviceId: ac.id,
        reason: "Running 90 minutes beyond preferred runtime during peak afternoon",
        severity: "medium",
        wastedKwh,
        costInr: calculateCostInr(wastedKwh, DEFAULT_TARIFF_INR_PER_KWH),
        status: "open",
        createdAt: recentAcRecord.recordedAt,
      });
    }
  });
}

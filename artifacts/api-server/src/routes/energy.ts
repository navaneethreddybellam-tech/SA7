import { GoogleGenAI, Type } from "@google/genai";
import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, lt, sum } from "drizzle-orm";
import { z } from "zod/v4";
import {
  CreateAutomationRuleBody,
  CreateAutomationRuleResponse,
  CreateDeviceBody,
  CreateDeviceResponse,
  CreateUsageBody,
  CreateUsageResponse,
  GetDashboardResponse,
  GetDeviceResponse,
  GetLatestEnergyAnalysisResponse,
  GetTariffResponse,
  GetUsageResponse,
  GetWasteEventResponse,
  ListAutomationActionsResponse,
  ListAutomationRulesResponse,
  ListDevicesResponse,
  ListUsageResponse,
  ListWasteEventsResponse,
  RunEnergyAnalysisResponse,
  RunSimulationBody,
  RunSimulationResponse,
  SetAutomationRuleEnabledBody,
  SetAutomationRuleEnabledResponse,
  UpdateAutomationRuleBody,
  UpdateAutomationRuleResponse,
  UpdateDeviceBody,
  UpdateDeviceResponse,
  UpdateTariffBody,
  UpdateTariffResponse,
  UpdateUsageBody,
  UpdateUsageResponse,
  UpdateWasteStatusBody,
  UpdateWasteStatusResponse,
} from "@workspace/api-zod";
import {
  aiAnalysesTable,
  automationActionsTable,
  automationRulesTable,
  db,
  devicesTable,
  energyUsageTable,
  userSettingsTable,
  wasteEventsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/session-auth";
import {
  calculateCostInr,
  DEFAULT_TARIFF_INR_PER_KWH,
  indiaDateKey,
  indiaDayStart,
  roundEnergy,
  shiftDateKey,
} from "../lib/energy-utils";

const router: IRouter = Router();
router.use(requireAuth);

const deviceTypeValues = [
  "AC",
  "Fan",
  "Light",
  "TV",
  "Refrigerator",
  "Washing Machine",
  "Computer",
  "Heater",
  "Other",
] as const;
const stateValues = ["ON", "OFF"] as const;
const priorityValues = ["low", "medium", "high"] as const;

const aiOutputSchema = z.object({
  problemDetected: z.string().min(5).max(500),
  whyItMatters: z.string().min(5).max(800),
  targetDevice: z.string().min(1).max(100),
  recommendedAction: z.string().min(5).max(800),
  priority: z.enum(priorityValues),
  estimatedSavingsKwh: z.number().finite().nonnegative().max(10000),
});

type DbDevice = typeof devicesTable.$inferSelect;

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function deviceDto(device: DbDevice) {
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    ratedPowerW: device.ratedPowerW,
    state: device.state,
    thresholdKwh: device.thresholdKwh,
    maxRuntimeMinutes: device.maxRuntimeMinutes,
    room: device.room,
    active: device.active,
    onSince: device.onSince ? asIso(device.onSince) : null,
    createdAt: asIso(device.createdAt),
  };
}

async function tariffFor(userId: number): Promise<number> {
  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  if (settings) return settings.tariffInrPerKwh;

  const [inserted] = await db
    .insert(userSettingsTable)
    .values({ userId, tariffInrPerKwh: DEFAULT_TARIFF_INR_PER_KWH })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted.tariffInrPerKwh;
  const [createdByConcurrentRequest] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return createdByConcurrentRequest?.tariffInrPerKwh ?? DEFAULT_TARIFF_INR_PER_KWH;
}

async function ownedDevice(userId: number, deviceId: number): Promise<DbDevice | null> {
  const [device] = await db
    .select()
    .from(devicesTable)
    .where(and(eq(devicesTable.id, deviceId), eq(devicesTable.userId, userId)))
    .limit(1);
  return device ?? null;
}

function validId(req: { params: Record<string, string | string[]> }) {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(raw);
  return {
    success: Number.isSafeInteger(id) && id > 0,
    data: { id },
  };
}

async function toUsageDto(userId: number, id: number) {
  const rows = await db
    .select({
      id: energyUsageTable.id,
      deviceId: energyUsageTable.deviceId,
      deviceName: devicesTable.name,
      energyKwh: energyUsageTable.energyKwh,
      durationMinutes: energyUsageTable.durationMinutes,
      recordedAt: energyUsageTable.recordedAt,
      costInr: energyUsageTable.costInr,
      simulated: energyUsageTable.simulated,
    })
    .from(energyUsageTable)
    .innerJoin(devicesTable, eq(energyUsageTable.deviceId, devicesTable.id))
    .where(and(eq(energyUsageTable.id, id), eq(energyUsageTable.userId, userId)))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        ...row,
        recordedAt: asIso(row.recordedAt),
      }
    : null;
}

async function maybeCreateWaste(
  userId: number,
  usageId: number,
  device: DbDevice,
  usageKwh: number,
  durationMinutes: number,
  recordedAt: Date,
  tariff: number,
): Promise<boolean> {
  const runtimeMinutes =
    device.state === "ON" && device.onSince
      ? Math.max(0, Math.floor((recordedAt.getTime() - device.onSince.getTime()) / 60_000))
      : durationMinutes;
  const reasons: { reason: string; wastedKwh: number }[] = [];

  const cycleStart = device.onSince ?? new Date(recordedAt.getTime() - durationMinutes * 60_000);
  const [cycleUsage] = await db
    .select({ totalKwh: sum(energyUsageTable.energyKwh) })
    .from(energyUsageTable)
    .where(
      and(
        eq(energyUsageTable.userId, userId),
        eq(energyUsageTable.deviceId, device.id),
        gte(energyUsageTable.recordedAt, cycleStart),
      ),
    );
  const cycleKwh = roundEnergy(Math.max(usageKwh, Number(cycleUsage?.totalKwh ?? usageKwh)));

  // Long run-time rules are not applied to a refrigerator: its compressor cycles are normal.
  if (device.type !== "Refrigerator" && runtimeMinutes > device.maxRuntimeMinutes) {
    const excessMinutes = runtimeMinutes - device.maxRuntimeMinutes;
    const wastedKwh = roundEnergy((device.ratedPowerW / 1000) * (excessMinutes / 60));
    if (wastedKwh > 0) {
      reasons.push({
        reason: `Running ${excessMinutes} minutes beyond its preferred ${device.maxRuntimeMinutes}-minute runtime`,
        wastedKwh,
      });
    }
  }

  // Check if interval usage or cumulative cycle usage exceeds the device threshold
  if (usageKwh > device.thresholdKwh) {
    reasons.push({
      reason: `This interval used ${roundEnergy(usageKwh - device.thresholdKwh)} kWh above the device threshold`,
      wastedKwh: roundEnergy(usageKwh - device.thresholdKwh),
    });
  } else if (cycleKwh > device.thresholdKwh && cycleKwh - device.thresholdKwh > 0.05) {
    reasons.push({
      reason: `Active cycle consumed ${roundEnergy(cycleKwh - device.thresholdKwh)} kWh above the device threshold (${device.thresholdKwh} kWh)`,
      wastedKwh: roundEnergy(cycleKwh - device.thresholdKwh),
    });
  }

  const weekStart = new Date(recordedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const historical = await db
    .select({ energyKwh: energyUsageTable.energyKwh })
    .from(energyUsageTable)
    .where(
      and(
        eq(energyUsageTable.userId, userId),
        eq(energyUsageTable.deviceId, device.id),
        gte(energyUsageTable.recordedAt, weekStart),
        lt(energyUsageTable.recordedAt, recordedAt),
      ),
    );
  if (historical.length >= 3) {
    const average = historical.reduce((sum, row) => sum + row.energyKwh, 0) / historical.length;
    if (usageKwh > average * 1.6 && usageKwh - average > 0.05) {
      reasons.push({
        reason: `Usage is ${roundEnergy(usageKwh / average)}× this device's recent average`,
        wastedKwh: roundEnergy(usageKwh - average),
      });
    }
  }

  reasons.sort((a, b) => b.wastedKwh - a.wastedKwh);
  const detection = reasons[0];
  if (!detection || detection.wastedKwh <= 0) return false;

  const severity = detection.wastedKwh >= 2 ? "high" : detection.wastedKwh >= 0.75 ? "medium" : "low";
  await db.insert(wasteEventsTable).values({
    userId,
    usageId,
    deviceId: device.id,
    reason: detection.reason,
    severity,
    wastedKwh: detection.wastedKwh,
    costInr: calculateCostInr(detection.wastedKwh, tariff),
    status: "open",
    createdAt: recordedAt,
  });
  return true;
}

async function executeAutomation(
  userId: number,
  device: DbDevice,
  usageKwh: number,
  durationMinutes: number,
  recordedAt: Date,
  tariff: number,
): Promise<boolean> {
  if (device.state !== "ON" || !device.active) return false;
  const runtimeMinutes =
    device.onSince
      ? Math.max(0, Math.floor((recordedAt.getTime() - device.onSince.getTime()) / 60_000))
      : durationMinutes;

  const cycleStart = device.onSince ?? new Date(recordedAt.getTime() - durationMinutes * 60_000);
  const [cycleUsage] = await db
    .select({ totalKwh: sum(energyUsageTable.energyKwh) })
    .from(energyUsageTable)
    .where(
      and(
        eq(energyUsageTable.userId, userId),
        eq(energyUsageTable.deviceId, device.id),
        gte(energyUsageTable.recordedAt, cycleStart),
      ),
    );
  const cumulativeEnergyKwh = roundEnergy(Math.max(usageKwh, Number(cycleUsage?.totalKwh ?? usageKwh)));

  const rules = await db
    .select()
    .from(automationRulesTable)
    .where(
      and(
        eq(automationRulesTable.userId, userId),
        eq(automationRulesTable.deviceId, device.id),
        eq(automationRulesTable.enabled, true),
      ),
    )
    .orderBy(desc(automationRulesTable.createdAt));

  const triggered = rules.find((rule) => {
    if (rule.action !== "turn_off") return false;
    if (rule.triggerType === "runtime") return runtimeMinutes >= rule.thresholdValue;
    if (rule.triggerType === "energy") return cumulativeEnergyKwh >= rule.thresholdValue;
    return false;
  });
  if (!triggered) return false;

  const triggerReason =
    triggered.triggerType === "runtime"
      ? `Runtime reached ${runtimeMinutes} minutes (rule limit: ${triggered.thresholdValue} minutes)`
      : `Active cycle consumption reached ${cumulativeEnergyKwh} kWh (rule limit: ${triggered.thresholdValue} kWh)`;

  const devicePowerKw = device.ratedPowerW / 1000;
  let savedKwh = 0;
  if (triggered.triggerType === "runtime") {
    const excessMinutes = Math.max(0, runtimeMinutes - triggered.thresholdValue);
    const avoidedMinutes = excessMinutes > 0 ? excessMinutes : durationMinutes;
    const avoidedRuntimeHours = avoidedMinutes / 60;
    savedKwh = roundEnergy(avoidedRuntimeHours * devicePowerKw);
  } else {
    const excessEnergy = Math.max(0, cumulativeEnergyKwh - triggered.thresholdValue);
    savedKwh = roundEnergy(excessEnergy > 0 ? excessEnergy : (durationMinutes / 60) * devicePowerKw);
  }
  if (savedKwh <= 0) {
    savedKwh = roundEnergy((durationMinutes / 60) * devicePowerKw);
  }
  const savedInr = calculateCostInr(savedKwh, tariff);

  return db.transaction(async (tx) => {
    const [updatedDevice] = await tx
      .update(devicesTable)
      .set({ state: "OFF", onSince: null })
      .where(
        and(
          eq(devicesTable.id, device.id),
          eq(devicesTable.userId, userId),
          eq(devicesTable.state, "ON"),
          eq(devicesTable.active, true),
        ),
      )
      .returning({ id: devicesTable.id });
    if (!updatedDevice) return false;

    await tx.insert(automationActionsTable).values({
      userId,
      deviceId: device.id,
      ruleId: triggered.id,
      triggerReason,
      previousState: "ON",
      newState: "OFF",
      energySavedKwh: savedKwh,
      moneySavedInr: savedInr,
      createdAt: recordedAt,
    });
    return true;
  });
}

async function evaluateUsage(
  userId: number,
  usageId: number,
  device: DbDevice,
  usageKwh: number,
  durationMinutes: number,
  recordedAt: Date,
  tariff: number,
) {
  const wasteCreated = await maybeCreateWaste(
    userId,
    usageId,
    device,
    usageKwh,
    durationMinutes,
    recordedAt,
    tariff,
  );
  const actionExecuted = await executeAutomation(
    userId,
    device,
    usageKwh,
    durationMinutes,
    recordedAt,
    tariff,
  );
  return { wasteCreated, actionExecuted };
}

router.get("/devices", async (req, res): Promise<void> => {
  const devices = await db
    .select()
    .from(devicesTable)
    .where(eq(devicesTable.userId, req.userId!))
    .orderBy(devicesTable.createdAt);
  res.json(ListDevicesResponse.parse(devices.map(deviceDto)));
});

router.post("/devices", async (req, res): Promise<void> => {
  const parsed = CreateDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the device name, type, power, and thresholds." });
    return;
  }
  const data = parsed.data;
  const now = new Date();
  const [device] = await db
    .insert(devicesTable)
    .values({
      ...data,
      userId: req.userId!,
      onSince: data.state === "ON" ? now : null,
    })
    .returning();
  res.status(201).json(CreateDeviceResponse.parse(deviceDto(device)));
});

router.get("/devices/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  if (!params.success) {
    res.status(400).json({ error: "Invalid device id." });
    return;
  }
  const device = await ownedDevice(req.userId!, params.data.id);
  if (!device) {
    res.status(404).json({ error: "Device not found." });
    return;
  }
  res.json(GetDeviceResponse.parse(deviceDto(device)));
});

router.patch("/devices/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  const parsed = UpdateDeviceBody.safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide valid device fields to update." });
    return;
  }
  const current = await ownedDevice(req.userId!, params.data.id);
  if (!current) {
    res.status(404).json({ error: "Device not found." });
    return;
  }
  const changes = parsed.data;
  const nextState = changes.state ?? current.state;
  const update: Partial<typeof devicesTable.$inferInsert> = { ...changes };
  if (changes.active === false) {
    update.state = "OFF";
    update.onSince = null;
  } else if (changes.state && changes.state !== current.state) {
    update.onSince = changes.state === "ON" ? new Date() : null;
  }
  if (nextState === "OFF") update.onSince = null;
  const [device] = await db
    .update(devicesTable)
    .set(update)
    .where(and(eq(devicesTable.id, params.data.id), eq(devicesTable.userId, req.userId!)))
    .returning();
  res.json(UpdateDeviceResponse.parse(deviceDto(device)));
});

router.delete("/devices/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  if (!params.success) {
    res.status(400).json({ error: "Invalid device id." });
    return;
  }
  const [deleted] = await db
    .delete(devicesTable)
    .where(and(eq(devicesTable.id, params.data.id), eq(devicesTable.userId, req.userId!)))
    .returning({ id: devicesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Device not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/usage", async (req, res): Promise<void> => {
  const usageRows = await db
    .select({
      id: energyUsageTable.id,
      deviceId: energyUsageTable.deviceId,
      deviceName: devicesTable.name,
      energyKwh: energyUsageTable.energyKwh,
      durationMinutes: energyUsageTable.durationMinutes,
      recordedAt: energyUsageTable.recordedAt,
      costInr: energyUsageTable.costInr,
      simulated: energyUsageTable.simulated,
    })
    .from(energyUsageTable)
    .innerJoin(devicesTable, eq(energyUsageTable.deviceId, devicesTable.id))
    .where(eq(energyUsageTable.userId, req.userId!))
    .orderBy(desc(energyUsageTable.recordedAt))
    .limit(500);
  res.json(
    ListUsageResponse.parse(
      usageRows.map((row) => ({ ...row, recordedAt: asIso(row.recordedAt) })),
    ),
  );
});

router.post("/usage", async (req, res): Promise<void> => {
  const parsed = CreateUsageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid device, energy amount, and duration." });
    return;
  }
  const data = parsed.data;
  const device = await ownedDevice(req.userId!, data.deviceId);
  if (!device || !device.active) {
    res.status(400).json({ error: "Choose an active device in your account." });
    return;
  }
  const recordedAt = data.recordedAt ? new Date(data.recordedAt) : new Date();
  const tariff = await tariffFor(req.userId!);
  const [created] = await db
    .insert(energyUsageTable)
    .values({
      userId: req.userId!,
      deviceId: device.id,
      energyKwh: data.energyKwh,
      durationMinutes: data.durationMinutes,
      recordedAt,
      costInr: calculateCostInr(data.energyKwh, tariff),
      simulated: false,
    })
    .returning({ id: energyUsageTable.id });
  await evaluateUsage(
    req.userId!,
    created.id,
    device,
    data.energyKwh,
    data.durationMinutes,
    recordedAt,
    tariff,
  );
  const record = await toUsageDto(req.userId!, created.id);
  res.status(201).json(CreateUsageResponse.parse(record));
});

router.get("/usage/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  if (!params.success) {
    res.status(400).json({ error: "Invalid usage record id." });
    return;
  }
  const record = await toUsageDto(req.userId!, params.data.id);
  if (!record) {
    res.status(404).json({ error: "Usage record not found." });
    return;
  }
  res.json(GetUsageResponse.parse(record));
});

router.patch("/usage/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  const parsed = UpdateUsageBody.safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide valid usage fields to update." });
    return;
  }
  const current = await toUsageDto(req.userId!, params.data.id);
  if (!current) {
    res.status(404).json({ error: "Usage record not found." });
    return;
  }
  const data = parsed.data;
  const nextDeviceId = data.deviceId ?? current.deviceId;
  const device = await ownedDevice(req.userId!, nextDeviceId);
  if (!device || !device.active) {
    res.status(400).json({ error: "Choose an active device in your account." });
    return;
  }
  const nextEnergy = data.energyKwh ?? current.energyKwh;
  const nextDuration = data.durationMinutes ?? current.durationMinutes;
  const nextRecordedAt = data.recordedAt ? new Date(data.recordedAt) : new Date(current.recordedAt);
  const tariff = await tariffFor(req.userId!);
  const [updated] = await db
    .update(energyUsageTable)
    .set({
      deviceId: nextDeviceId,
      energyKwh: nextEnergy,
      durationMinutes: nextDuration,
      recordedAt: nextRecordedAt,
      costInr: calculateCostInr(nextEnergy, tariff),
    })
    .where(and(eq(energyUsageTable.id, params.data.id), eq(energyUsageTable.userId, req.userId!)))
    .returning({ id: energyUsageTable.id });
  await db
    .delete(wasteEventsTable)
    .where(
      and(
        eq(wasteEventsTable.userId, req.userId!),
        eq(wasteEventsTable.usageId, updated.id),
      ),
    );
  await evaluateUsage(
    req.userId!,
    updated.id,
    device,
    nextEnergy,
    nextDuration,
    nextRecordedAt,
    tariff,
  );
  const record = await toUsageDto(req.userId!, updated.id);
  res.json(UpdateUsageResponse.parse(record));
});

router.delete("/usage/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  if (!params.success) {
    res.status(400).json({ error: "Invalid usage record id." });
    return;
  }
  const [deleted] = await db
    .delete(energyUsageTable)
    .where(and(eq(energyUsageTable.id, params.data.id), eq(energyUsageTable.userId, req.userId!)))
    .returning({ id: energyUsageTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Usage record not found." });
    return;
  }
  res.sendStatus(204);
});

async function listRules(userId: number) {
  return db
    .select({
      id: automationRulesTable.id,
      deviceId: automationRulesTable.deviceId,
      deviceName: devicesTable.name,
      triggerType: automationRulesTable.triggerType,
      thresholdValue: automationRulesTable.thresholdValue,
      action: automationRulesTable.action,
      enabled: automationRulesTable.enabled,
      createdAt: automationRulesTable.createdAt,
    })
    .from(automationRulesTable)
    .innerJoin(devicesTable, eq(automationRulesTable.deviceId, devicesTable.id))
    .where(eq(automationRulesTable.userId, userId))
    .orderBy(desc(automationRulesTable.createdAt));
}

function ruleDto(rule: Awaited<ReturnType<typeof listRules>>[number]) {
  return { ...rule, createdAt: asIso(rule.createdAt) };
}

router.get("/automation-rules", async (req, res): Promise<void> => {
  const rules = await listRules(req.userId!);
  res.json(ListAutomationRulesResponse.parse(rules.map(ruleDto)));
});

router.post("/automation-rules", async (req, res): Promise<void> => {
  const parsed = CreateAutomationRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the rule device, trigger, and threshold." });
    return;
  }
  const data = parsed.data;
  const device = await ownedDevice(req.userId!, data.deviceId);
  if (!device || !device.active) {
    res.status(400).json({ error: "Choose an active device in your account." });
    return;
  }
  const [created] = await db
    .insert(automationRulesTable)
    .values({ ...data, userId: req.userId! })
    .returning({ id: automationRulesTable.id });
  const current = (await listRules(req.userId!)).find((row) => row.id === created.id);
  if (!current) {
    res.status(500).json({ error: "The rule was saved but could not be retrieved." });
    return;
  }
  res.status(201).json(CreateAutomationRuleResponse.parse(ruleDto(current)));
});

router.patch("/automation-rules/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  const parsed = UpdateAutomationRuleBody.safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide valid automation rule fields." });
    return;
  }
  const changes = parsed.data;
  if (changes.deviceId) {
    const device = await ownedDevice(req.userId!, changes.deviceId);
    if (!device || !device.active) {
      res.status(400).json({ error: "Choose an active device in your account." });
      return;
    }
  }
  const [updated] = await db
    .update(automationRulesTable)
    .set(changes)
    .where(and(eq(automationRulesTable.id, params.data.id), eq(automationRulesTable.userId, req.userId!)))
    .returning({ id: automationRulesTable.id });
  if (!updated) {
    res.status(404).json({ error: "Automation rule not found." });
    return;
  }
  const rule = (await listRules(req.userId!)).find((row) => row.id === updated.id);
  if (!rule) {
    res.status(500).json({ error: "The rule was updated but could not be retrieved." });
    return;
  }
  res.json(UpdateAutomationRuleResponse.parse(ruleDto(rule)));
});

router.delete("/automation-rules/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  if (!params.success) {
    res.status(400).json({ error: "Invalid rule id." });
    return;
  }
  const [deleted] = await db
    .delete(automationRulesTable)
    .where(and(eq(automationRulesTable.id, params.data.id), eq(automationRulesTable.userId, req.userId!)))
    .returning({ id: automationRulesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Automation rule not found." });
    return;
  }
  res.sendStatus(204);
});

router.patch("/automation-rules/:id/enabled", async (req, res): Promise<void> => {
  const params = validId(req);
  const parsed = SetAutomationRuleEnabledBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Choose whether the rule should be enabled." });
    return;
  }
  const [updated] = await db
    .update(automationRulesTable)
    .set({ enabled: parsed.data.enabled })
    .where(and(eq(automationRulesTable.id, params.data.id), eq(automationRulesTable.userId, req.userId!)))
    .returning({ id: automationRulesTable.id });
  if (!updated) {
    res.status(404).json({ error: "Automation rule not found." });
    return;
  }
  const rule = (await listRules(req.userId!)).find((row) => row.id === updated.id);
  if (!rule) {
    res.status(500).json({ error: "The rule was updated but could not be retrieved." });
    return;
  }
  res.json(SetAutomationRuleEnabledResponse.parse(ruleDto(rule)));
});

async function listWaste(userId: number) {
  return db
    .select({
      id: wasteEventsTable.id,
      deviceId: wasteEventsTable.deviceId,
      deviceName: devicesTable.name,
      reason: wasteEventsTable.reason,
      severity: wasteEventsTable.severity,
      wastedKwh: wasteEventsTable.wastedKwh,
      costInr: wasteEventsTable.costInr,
      status: wasteEventsTable.status,
      createdAt: wasteEventsTable.createdAt,
    })
    .from(wasteEventsTable)
    .innerJoin(devicesTable, eq(wasteEventsTable.deviceId, devicesTable.id))
    .where(eq(wasteEventsTable.userId, userId))
    .orderBy(desc(wasteEventsTable.createdAt))
    .limit(200);
}

async function getWaste(userId: number, id: number) {
  const [event] = await db
    .select({
      id: wasteEventsTable.id,
      deviceId: wasteEventsTable.deviceId,
      deviceName: devicesTable.name,
      reason: wasteEventsTable.reason,
      severity: wasteEventsTable.severity,
      wastedKwh: wasteEventsTable.wastedKwh,
      costInr: wasteEventsTable.costInr,
      status: wasteEventsTable.status,
      createdAt: wasteEventsTable.createdAt,
    })
    .from(wasteEventsTable)
    .innerJoin(devicesTable, eq(wasteEventsTable.deviceId, devicesTable.id))
    .where(and(eq(wasteEventsTable.userId, userId), eq(wasteEventsTable.id, id)))
    .limit(1);
  return event ?? null;
}

function wasteDto(event: Awaited<ReturnType<typeof listWaste>>[number]) {
  return { ...event, createdAt: asIso(event.createdAt) };
}

router.get("/waste-events", async (req, res): Promise<void> => {
  res.json(ListWasteEventsResponse.parse((await listWaste(req.userId!)).map(wasteDto)));
});

router.get("/waste-events/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  if (!params.success) {
    res.status(400).json({ error: "Invalid waste event id." });
    return;
  }
  const event = await getWaste(req.userId!, params.data.id);
  if (!event) {
    res.status(404).json({ error: "Waste event not found." });
    return;
  }
  res.json(GetWasteEventResponse.parse(wasteDto(event)));
});

router.patch("/waste-events/:id", async (req, res): Promise<void> => {
  const params = validId(req);
  const parsed = UpdateWasteStatusBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Choose a valid status for this waste event." });
    return;
  }
  const [updated] = await db
    .update(wasteEventsTable)
    .set({ status: parsed.data.status })
    .where(and(eq(wasteEventsTable.id, params.data.id), eq(wasteEventsTable.userId, req.userId!)))
    .returning({ id: wasteEventsTable.id });
  if (!updated) {
    res.status(404).json({ error: "Waste event not found." });
    return;
  }
  const event = await getWaste(req.userId!, updated.id);
  if (!event) {
    res.status(500).json({ error: "The event status was updated but could not be retrieved." });
    return;
  }
  res.json(UpdateWasteStatusResponse.parse(wasteDto(event)));
});

async function listActions(userId: number) {
  return db
    .select({
      id: automationActionsTable.id,
      deviceId: automationActionsTable.deviceId,
      deviceName: devicesTable.name,
      ruleId: automationActionsTable.ruleId,
      triggerReason: automationActionsTable.triggerReason,
      previousState: automationActionsTable.previousState,
      newState: automationActionsTable.newState,
      energySavedKwh: automationActionsTable.energySavedKwh,
      moneySavedInr: automationActionsTable.moneySavedInr,
      createdAt: automationActionsTable.createdAt,
    })
    .from(automationActionsTable)
    .innerJoin(devicesTable, eq(automationActionsTable.deviceId, devicesTable.id))
    .where(eq(automationActionsTable.userId, userId))
    .orderBy(desc(automationActionsTable.createdAt))
    .limit(200);
}

router.get("/automation-actions", async (req, res): Promise<void> => {
  const actions = await listActions(req.userId!);
  res.json(
    ListAutomationActionsResponse.parse(
      actions.map((action) => ({ ...action, createdAt: asIso(action.createdAt) })),
    ),
  );
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const now = new Date();
  const todayKey = indiaDateKey(now);
  const startToday = indiaDayStart(todayKey);
  const startMonth = indiaDayStart(`${todayKey.slice(0, 7)}-01`);
  const startWeekKey = shiftDateKey(todayKey, -6);
  const startWeek = indiaDayStart(startWeekKey);
  const tariff = await tariffFor(userId);
  const devices = await db.select().from(devicesTable).where(eq(devicesTable.userId, userId));
  const usageStart = startMonth < startWeek ? startMonth : startWeek;
  const usage = await db
    .select()
    .from(energyUsageTable)
    .where(and(eq(energyUsageTable.userId, userId), gte(energyUsageTable.recordedAt, usageStart)))
    .orderBy(desc(energyUsageTable.recordedAt));
  const monthEnergy = usage
    .filter((row) => row.recordedAt >= startMonth)
    .reduce((sum, row) => sum + row.energyKwh, 0);
  const todayEnergy = usage
    .filter((row) => row.recordedAt >= startToday)
    .reduce((sum, row) => sum + row.energyKwh, 0);
  const events = await db
    .select({
      deviceId: wasteEventsTable.deviceId,
      deviceName: devicesTable.name,
      reason: wasteEventsTable.reason,
      severity: wasteEventsTable.severity,
      wastedKwh: wasteEventsTable.wastedKwh,
      status: wasteEventsTable.status,
      createdAt: wasteEventsTable.createdAt,
    })
    .from(wasteEventsTable)
    .innerJoin(devicesTable, eq(wasteEventsTable.deviceId, devicesTable.id))
    .where(and(eq(wasteEventsTable.userId, userId), eq(wasteEventsTable.status, "open")));
  const actions = await listActions(userId);
  const [actionTotals] = await db
    .select({
      count: count(),
      energySaved: sum(automationActionsTable.energySavedKwh),
      moneySaved: sum(automationActionsTable.moneySavedInr),
    })
    .from(automationActionsTable)
    .where(eq(automationActionsTable.userId, userId));
  const [monthlyActionTotals] = await db
    .select({ count: count() })
    .from(automationActionsTable)
    .where(
      and(
        eq(automationActionsTable.userId, userId),
        gte(automationActionsTable.createdAt, startMonth),
      ),
    );
  const currentLoadKw =
    devices
      .filter((device) => device.active && device.state === "ON")
      .reduce((sum, device) => sum + device.ratedPowerW / 1000, 0);
  const wastedEnergyKwh = events.reduce((sum, event) => sum + event.wastedKwh, 0);
  const energySavedKwh = Number(actionTotals?.energySaved ?? 0);
  const moneySavedInr = Number(actionTotals?.moneySaved ?? 0);
  const daily = new Map<string, number>();
  for (const row of usage) {
    const key = indiaDateKey(row.recordedAt);
    daily.set(key, (daily.get(key) ?? 0) + row.energyKwh);
  }
  const dailyTrend = Array.from({ length: 7 }, (_, index) => {
    const key = shiftDateKey(startWeekKey, index);
    return { date: key, energyKwh: roundEnergy(daily.get(key) ?? 0) };
  });
  const monthlyUsage = await db
    .select({
      deviceId: energyUsageTable.deviceId,
      deviceName: devicesTable.name,
      energyKwh: energyUsageTable.energyKwh,
      recordedAt: energyUsageTable.recordedAt,
    })
    .from(energyUsageTable)
    .innerJoin(devicesTable, eq(energyUsageTable.deviceId, devicesTable.id))
    .where(and(eq(energyUsageTable.userId, userId), gte(energyUsageTable.recordedAt, startMonth)));
  const deviceBuckets = new Map<number, { deviceId: number; deviceName: string; energyKwh: number }>();
  for (const row of monthlyUsage.filter((row) => row.recordedAt >= startToday)) {
    const current = deviceBuckets.get(row.deviceId) ?? {
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      energyKwh: 0,
    };
    current.energyKwh += row.energyKwh;
    deviceBuckets.set(row.deviceId, current);
  }
  const latestWastes = events
    .map((event) => ({
      kind: "waste" as const,
      message: `${event.deviceName}: ${event.reason}`,
      severity: event.severity,
      createdAt: event.createdAt,
    }));
  const latestActions = actions.map((action) => ({
    kind: "automation" as const,
    message: `${action.deviceName} switched OFF by automation`,
    severity: "low" as const,
    createdAt: new Date(action.createdAt),
  }));
  const recentActivity = [...latestWastes, ...latestActions]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 6)
    .map((activity) => ({
      kind: activity.kind,
      message: activity.message,
      severity: activity.severity,
      createdAt: asIso(activity.createdAt),
    }));
  const payload = {
    currentLoadKw: roundEnergy(currentLoadKw),
    energyTodayKwh: roundEnergy(todayEnergy),
    energyMonthKwh: roundEnergy(monthEnergy),
    estimatedCostInr: calculateCostInr(monthEnergy, tariff),
    wastedEnergyKwh: roundEnergy(wastedEnergyKwh),
    potentialSavingsInr: calculateCostInr(wastedEnergyKwh, tariff),
    energySavedKwh: roundEnergy(energySavedKwh),
    moneySavedInr: Math.round(moneySavedInr * 100) / 100,
    automationActionsCount: Number(monthlyActionTotals?.count ?? 0),
    deviceSummary: {
      total: devices.length,
      on: devices.filter((device) => device.active && device.state === "ON").length,
      off: devices.filter((device) => device.active && device.state === "OFF").length,
      inactive: devices.filter((device) => !device.active).length,
    },
    dailyTrend,
    deviceUsage: [...deviceBuckets.values()]
      .sort((a, b) => b.energyKwh - a.energyKwh)
      .map((item) => ({
        ...item,
        energyKwh: roundEnergy(item.energyKwh),
      })),
    recentActivity,
  };
  res.json(GetDashboardResponse.parse(payload));
});

router.get("/settings/tariff", async (req, res): Promise<void> => {
  const tariffInrPerKwh = await tariffFor(req.userId!);
  res.json(GetTariffResponse.parse({ tariffInrPerKwh }));
});

router.patch("/settings/tariff", async (req, res): Promise<void> => {
  const parsed = UpdateTariffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a tariff greater than ₹0 per kWh." });
    return;
  }
  const userId = req.userId!;
  const tariffInrPerKwh = parsed.data.tariffInrPerKwh;
  await db.transaction(async (tx) => {
    await tx
      .insert(userSettingsTable)
      .values({ userId, tariffInrPerKwh })
      .onConflictDoUpdate({
        target: userSettingsTable.userId,
        set: { tariffInrPerKwh, updatedAt: new Date() },
      });

    const usage = await tx
      .select({ id: energyUsageTable.id, energyKwh: energyUsageTable.energyKwh })
      .from(energyUsageTable)
      .where(eq(energyUsageTable.userId, userId));
    for (const record of usage) {
      await tx
        .update(energyUsageTable)
        .set({ costInr: calculateCostInr(record.energyKwh, tariffInrPerKwh) })
        .where(and(eq(energyUsageTable.id, record.id), eq(energyUsageTable.userId, userId)));
    }

    const wastes = await tx
      .select({ id: wasteEventsTable.id, wastedKwh: wasteEventsTable.wastedKwh })
      .from(wasteEventsTable)
      .where(eq(wasteEventsTable.userId, userId));
    for (const event of wastes) {
      await tx
        .update(wasteEventsTable)
        .set({ costInr: calculateCostInr(event.wastedKwh, tariffInrPerKwh) })
        .where(and(eq(wasteEventsTable.id, event.id), eq(wasteEventsTable.userId, userId)));
    }

    const actions = await tx
      .select({ id: automationActionsTable.id, energySavedKwh: automationActionsTable.energySavedKwh })
      .from(automationActionsTable)
      .where(eq(automationActionsTable.userId, userId));
    for (const action of actions) {
      await tx
        .update(automationActionsTable)
        .set({ moneySavedInr: calculateCostInr(action.energySavedKwh, tariffInrPerKwh) })
        .where(and(eq(automationActionsTable.id, action.id), eq(automationActionsTable.userId, userId)));
    }

    const analyses = await tx
      .select({
        id: aiAnalysesTable.id,
        estimatedSavingsKwh: aiAnalysesTable.estimatedSavingsKwh,
      })
      .from(aiAnalysesTable)
      .where(eq(aiAnalysesTable.userId, userId));
    for (const analysis of analyses) {
      await tx
        .update(aiAnalysesTable)
        .set({
          estimatedSavingsInr: calculateCostInr(analysis.estimatedSavingsKwh, tariffInrPerKwh),
        })
        .where(and(eq(aiAnalysesTable.id, analysis.id), eq(aiAnalysesTable.userId, userId)));
    }
    return tariffInrPerKwh;
  });
  res.json(UpdateTariffResponse.parse({ tariffInrPerKwh }));
});

router.post("/simulation/run", async (req, res): Promise<void> => {
  const parsed = RunSimulationBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a simulation interval between 5 and 120 minutes." });
    return;
  }
  const durationMinutes = parsed.data.durationMinutes ?? 15;
  const userId = req.userId!;
  const tariff = await tariffFor(userId);
  const devices = await db
    .select()
    .from(devicesTable)
    .where(and(eq(devicesTable.userId, userId), eq(devicesTable.active, true), eq(devicesTable.state, "ON")));
  let recordsCreated = 0;
  let wasteEventsCreated = 0;
  let actionsExecuted = 0;
  for (const device of devices) {
    const dutyFactor =
      device.type === "Refrigerator"
        ? 0.35
        : device.type === "AC"
          ? 0.78
          : device.type === "Washing Machine"
            ? 0.72
            : device.type === "Heater"
              ? 0.85
              : 1;
    const energyKwh = roundEnergy(
      (device.ratedPowerW / 1000) * (durationMinutes / 60) * dutyFactor,
    );
    const recordedAt = new Date();
    const effectiveOnSince = device.onSince
      ? new Date(device.onSince.getTime() - durationMinutes * 60_000)
      : new Date(recordedAt.getTime() - durationMinutes * 60_000);
    await db
      .update(devicesTable)
      .set({ onSince: effectiveOnSince })
      .where(and(eq(devicesTable.id, device.id), eq(devicesTable.userId, userId)));
    device.onSince = effectiveOnSince;

    const [record] = await db.insert(energyUsageTable).values({
      userId,
      deviceId: device.id,
      energyKwh,
      durationMinutes,
      recordedAt,
      costInr: calculateCostInr(energyKwh, tariff),
      simulated: true,
    }).returning({ id: energyUsageTable.id });
    recordsCreated += 1;
    const result = await evaluateUsage(
      userId,
      record.id,
      device,
      energyKwh,
      durationMinutes,
      recordedAt,
      tariff,
    );
    if (result.wasteCreated) wasteEventsCreated += 1;
    if (result.actionExecuted) actionsExecuted += 1;
  }
  res.json(
    RunSimulationResponse.parse({
      recordsCreated,
      wasteEventsCreated,
      actionsExecuted,
    }),
  );
});

router.get("/ai/analysis", async (req, res): Promise<void> => {
  const [saved] = await db
    .select()
    .from(aiAnalysesTable)
    .where(eq(aiAnalysesTable.userId, req.userId!))
    .orderBy(desc(aiAnalysesTable.createdAt))
    .limit(1);
  const analysis = saved
    ? {
        ...saved,
        deviceId: saved.deviceId ?? null,
        deviceName: saved.deviceName ?? null,
        createdAt: asIso(saved.createdAt),
      }
    : null;
  res.json(GetLatestEnergyAnalysisResponse.parse({ analysis }));
});

router.post("/ai/analysis", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Gemini analysis is not configured on the server." });
    return;
  }

  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tariff = await tariffFor(userId);
  const devices = await db.select().from(devicesTable).where(eq(devicesTable.userId, userId));
  const usage = await db
    .select({
      deviceId: energyUsageTable.deviceId,
      deviceName: devicesTable.name,
      energyKwh: energyUsageTable.energyKwh,
      durationMinutes: energyUsageTable.durationMinutes,
      recordedAt: energyUsageTable.recordedAt,
      simulated: energyUsageTable.simulated,
    })
    .from(energyUsageTable)
    .innerJoin(devicesTable, eq(energyUsageTable.deviceId, devicesTable.id))
    .where(and(eq(energyUsageTable.userId, userId), gte(energyUsageTable.recordedAt, weekStart)))
    .orderBy(desc(energyUsageTable.recordedAt))
    .limit(60);
  if (usage.length === 0) {
    res.status(422).json({ error: "Add or simulate energy usage before running an analysis." });
    return;
  }

  const openWastes = await db
    .select({
      deviceId: wasteEventsTable.deviceId,
      reason: wasteEventsTable.reason,
      severity: wasteEventsTable.severity,
      wastedKwh: wasteEventsTable.wastedKwh,
      status: wasteEventsTable.status,
      createdAt: wasteEventsTable.createdAt,
    })
    .from(wasteEventsTable)
    .where(and(eq(wasteEventsTable.userId, userId), eq(wasteEventsTable.status, "open")))
    .orderBy(desc(wasteEventsTable.createdAt))
    .limit(20);

  const byDevice = new Map<number, { name: string; total: number; count: number; rows: typeof usage }>();
  for (const row of usage) {
    const current = byDevice.get(row.deviceId) ?? {
      name: row.deviceName,
      total: 0,
      count: 0,
      rows: [],
    };
    current.total += row.energyKwh;
    current.count += 1;
    current.rows.push(row);
    byDevice.set(row.deviceId, current);
  }
  const deviceUsage = [...byDevice.entries()].map(([deviceId, data]) => ({
    deviceId,
    deviceName: data.name,
    recentEnergyKwh: roundEnergy(data.total),
    historicalAverageKwhPerRecord: roundEnergy(data.total / Math.max(1, data.count)),
    recentIntervals: data.rows.slice(0, 8).map((row) => ({
      energyKwh: row.energyKwh,
      durationMinutes: row.durationMinutes,
      recordedAt: asIso(row.recordedAt),
      simulated: row.simulated,
    })),
  }));
  const [actionTotals] = await db
    .select({
      totalEnergySavedKwh: sum(automationActionsTable.energySavedKwh),
      totalMoneySavedInr: sum(automationActionsTable.moneySavedInr),
    })
    .from(automationActionsTable)
    .where(eq(automationActionsTable.userId, userId));
  const achievedSavingsKwh = roundEnergy(Number(actionTotals?.totalEnergySavedKwh ?? 0));
  const achievedSavingsInr = roundEnergy(Number(actionTotals?.totalMoneySavedInr ?? 0));

  const totalOpenWasteKwh = roundEnergy(
    openWastes.reduce((sum, event) => sum + event.wastedKwh, 0),
  );
  const activeLoadKw = roundEnergy(
    devices
      .filter((d) => d.active && d.state === "ON")
      .reduce((s, d) => s + d.ratedPowerW / 1000, 0),
  );
  const potentialSavingsUpperBoundKwh = totalOpenWasteKwh > 0 ? totalOpenWasteKwh : roundEnergy(activeLoadKw * 0.5);

  const runtimePatterns = devices.map((device) => ({
    deviceId: device.id,
    deviceName: device.name,
    state: device.state,
    active: device.active,
    ratedPowerW: device.ratedPowerW,
    preferredRuntimeMinutes: device.maxRuntimeMinutes,
    currentRuntimeMinutes:
      device.state === "ON" && device.onSince
        ? Math.max(0, Math.floor((now.getTime() - device.onSince.getTime()) / 60_000))
        : 0,
    deviceType: device.type,
  }));
  const input = {
    recentUsage: usage.slice(0, 20).map((row) => ({
      deviceName: row.deviceName,
      energyKwh: row.energyKwh,
      durationMinutes: row.durationMinutes,
      recordedAt: asIso(row.recordedAt),
      simulated: row.simulated,
    })),
    deviceUsage,
    openWasteEvents: openWastes.map((event) => ({
      deviceId: event.deviceId,
      reason: event.reason,
      severity: event.severity,
      wastedKwh: event.wastedKwh,
      detectedAt: asIso(event.createdAt),
    })),
    runtimePatterns,
    tariffInrPerKwh: tariff,
    potentialSavingsUpperBoundKwh,
    achievedSavingsKwh,
    achievedSavingsInr,
  };

  const ai = new GoogleGenAI({ apiKey });
  let modelOutput: unknown;
  try {
    const result = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Analyze this household energy data. Only make claims supported by the supplied records. Select targetDevice from the exact supplied device names. Explain the highest-priority measured concern and recommend a practical action. Distinguish potential future savings from already achieved savings (achievedSavingsKwh). Potential savings must not exceed potentialSavingsUpperBoundKwh; if no open waste events or optimization opportunities exist, return zero savings. Return JSON matching the requested schema. Input data: " +
                JSON.stringify(input),
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            problemDetected: { type: Type.STRING },
            whyItMatters: { type: Type.STRING },
            targetDevice: { type: Type.STRING, enum: devices.map((device) => device.name) },
            recommendedAction: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ["low", "medium", "high"] },
            estimatedSavingsKwh: { type: Type.NUMBER },
          },
          required: [
            "problemDetected",
            "whyItMatters",
            "targetDevice",
            "recommendedAction",
            "priority",
            "estimatedSavingsKwh",
          ],
        },
      },
    });
    if (!result.text) throw new Error("Empty Gemini response");
    modelOutput = JSON.parse(result.text);
  } catch (error) {
    const providerStatus =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : null;
    req.log.warn(
      {
        errorName: error instanceof Error ? error.name : "unknown",
        providerStatus,
      },
      "Gemini analysis request failed",
    );
    res.status(502).json({ error: "Gemini could not complete the analysis. Please try again." });
    return;
  }

  const validated = aiOutputSchema.safeParse(modelOutput);
  if (!validated.success) {
    req.log.warn({ validationErrorCount: validated.error.issues.length }, "Gemini response was invalid");
    res.status(502).json({ error: "Gemini returned an invalid analysis. Please try again." });
    return;
  }

  const matchedDevice = devices.find((device) => device.name === validated.data.targetDevice);
  if (!matchedDevice) {
    req.log.warn({ targetDevice: validated.data.targetDevice }, "Gemini selected an unknown device");
    res.status(502).json({ error: "Gemini returned an invalid analysis. Please try again." });
    return;
  }
  const estimatedSavingsKwh = Math.min(
    validated.data.estimatedSavingsKwh,
    potentialSavingsUpperBoundKwh > 0 ? potentialSavingsUpperBoundKwh : 1000,
  );
  const [saved] = await db
    .insert(aiAnalysesTable)
    .values({
      userId,
      problemDetected: validated.data.problemDetected,
      whyItMatters: validated.data.whyItMatters,
      deviceId: matchedDevice.id,
      deviceName: matchedDevice.name,
      recommendedAction: validated.data.recommendedAction,
      priority: validated.data.priority,
      estimatedSavingsKwh,
      estimatedSavingsInr: calculateCostInr(estimatedSavingsKwh, tariff),
    })
    .returning();
  res.json(
    RunEnergyAnalysisResponse.parse({
      ...saved,
      deviceId: saved.deviceId,
      deviceName: saved.deviceName,
      createdAt: asIso(saved.createdAt),
    }),
  );
});

export default router;

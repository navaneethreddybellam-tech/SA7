import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const devicesTable = pgTable(
  "energy_devices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    ratedPowerW: doublePrecision("rated_power_w").notNull(),
    state: text("state").notNull().default("OFF"),
    thresholdKwh: doublePrecision("threshold_kwh").notNull(),
    maxRuntimeMinutes: integer("max_runtime_minutes").notNull(),
    room: text("room"),
    active: boolean("active").notNull().default(true),
    onSince: timestamp("on_since", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("energy_devices_user_idx").on(table.userId)],
);

export const energyUsageTable = pgTable(
  "energy_usage",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    deviceId: integer("device_id").notNull().references(() => devicesTable.id, { onDelete: "cascade" }),
    energyKwh: doublePrecision("energy_kwh").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    costInr: doublePrecision("cost_inr").notNull(),
    simulated: boolean("simulated").notNull().default(false),
  },
  (table) => [
    index("energy_usage_user_recorded_idx").on(table.userId, table.recordedAt),
    index("energy_usage_device_idx").on(table.deviceId),
  ],
);

export const automationRulesTable = pgTable(
  "automation_rules",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    deviceId: integer("device_id").notNull().references(() => devicesTable.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type").notNull(),
    thresholdValue: doublePrecision("threshold_value").notNull(),
    action: text("action").notNull().default("turn_off"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("automation_rules_user_idx").on(table.userId)],
);

export const wasteEventsTable = pgTable(
  "waste_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    deviceId: integer("device_id").notNull().references(() => devicesTable.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    severity: text("severity").notNull(),
    wastedKwh: doublePrecision("wasted_kwh").notNull(),
    costInr: doublePrecision("cost_inr").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("waste_events_user_idx").on(table.userId, table.createdAt),
    index("waste_events_device_idx").on(table.deviceId),
  ],
);

export const automationActionsTable = pgTable(
  "automation_actions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    deviceId: integer("device_id").notNull().references(() => devicesTable.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id").notNull(),
    triggerReason: text("trigger_reason").notNull(),
    previousState: text("previous_state").notNull(),
    newState: text("new_state").notNull(),
    energySavedKwh: doublePrecision("energy_saved_kwh").notNull(),
    moneySavedInr: doublePrecision("money_saved_inr").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("automation_actions_user_idx").on(table.userId, table.createdAt)],
);

export const aiAnalysesTable = pgTable(
  "ai_analyses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    problemDetected: text("problem_detected").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    deviceId: integer("device_id").references(() => devicesTable.id, { onDelete: "set null" }),
    deviceName: text("device_name"),
    recommendedAction: text("recommended_action").notNull(),
    priority: text("priority").notNull(),
    estimatedSavingsKwh: doublePrecision("estimated_savings_kwh").notNull(),
    estimatedSavingsInr: doublePrecision("estimated_savings_inr").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_analyses_user_idx").on(table.userId, table.createdAt)],
);

export const userSettingsTable = pgTable(
  "user_energy_settings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    tariffInrPerKwh: doublePrecision("tariff_inr_per_kwh").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("user_energy_settings_user_idx").on(table.userId)],
);

export const sessionsTable = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_sessions_expiry_idx").on(table.expiresAt)],
);

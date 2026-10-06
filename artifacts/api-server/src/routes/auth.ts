import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import { createDemoData } from "../lib/demo-data";
import { createSession, destroySession, requireAuth } from "../lib/session-auth";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const router: IRouter = Router();
const PASSWORD_KEY_BYTES = 64;

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_BYTES, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derivePassword(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex || !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{128}$/.test(keyHex)) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  const actual = await derivePassword(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicUser(user: { id: number; email: string; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and a password with at least 10 characters." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    [user] = await db
      .insert(usersTable)
      .values({ email, passwordHash: await hashPassword(parsed.data.password) })
      .returning();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    throw error;
  }
  if (!user) {
    res.status(500).json({ error: "Unable to create the account. Please try again." });
    return;
  }

  try {
    await createDemoData(user.id);
    await createSession(user.id, res);
  } catch (error) {
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    req.log.error({ errorName: error instanceof Error ? error.name : "unknown" }, "Account setup failed");
    res.status(500).json({ error: "Unable to finish account setup. Please try again." });
    return;
  }

  res.status(201).json(RegisterResponse.parse(publicUser(user)));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }

  try {
    await createSession(user.id, res);
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "unknown" }, "Session creation failed");
    res.status(500).json({ error: "Unable to sign in right now. Please try again." });
    return;
  }

  res.json(LoginResponse.parse(publicUser(user)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroySession(req, res);
  res.sendStatus(204);
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(publicUser(user)));
});

export default router;

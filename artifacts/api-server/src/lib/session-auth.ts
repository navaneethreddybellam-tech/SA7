import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Request, RequestHandler, Response } from "express";
import { db, sessionsTable } from "@workspace/db";

const COOKIE_NAME = "connect.sid";
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET;

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_LIFETIME_MS,
  };
}

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function signedCookie(token: string) {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  const signature = createHmac("sha256", SESSION_SECRET).update(token).digest("base64url");
  return `${token}.${signature}`;
}

function parseSignedCookie(value: unknown): string | null {
  if (typeof value !== "string" || !SESSION_SECRET) return null;
  const [token, signature, extra] = value.split(".");
  if (!token || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", SESSION_SECRET).update(token).digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return null;
  }
  return token;
}

export async function createSession(userId: number, response: Response): Promise<void> {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date()));
  await db.insert(sessionsTable).values({
    tokenHash: digest(token),
    userId,
    expiresAt,
  });
  response.cookie(COOKIE_NAME, signedCookie(token), cookieOptions());
}

export async function destroySession(request: Request, response: Response): Promise<void> {
  const token = parseSignedCookie(request.cookies?.[COOKIE_NAME]);
  if (token) {
    await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, digest(token)));
  }
  response.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

export const requireAuth: RequestHandler = async (request, response, next) => {
  const token = parseSignedCookie(request.cookies?.[COOKIE_NAME]);
  if (!token) {
    response.status(401).json({ error: "Please sign in to continue." });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.tokenHash, digest(token)),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    response.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    response.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }

  request.userId = session.userId;
  next();
};

import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/** Shared by browser and public API adapters so one cannot bypass account
 * suspension, expiry or revocation checks implemented by the other.
 */
export async function authenticateSession(token: unknown) {
  if (typeof token !== "string" || !token || token.length > 4096) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (session.user.status !== "ACTIVE") throw new AppError("Account is not active", 403, "ACCOUNT_INACTIVE");
  const cutoff = new Date(now.getTime() - 60_000);
  if (!session.lastUsedAt || session.lastUsedAt <= cutoff) {
    await prisma.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now },
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: cutoff } }],
      },
      data: { lastUsedAt: now },
    });
  }
  return session;
}

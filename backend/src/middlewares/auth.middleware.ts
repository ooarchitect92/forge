import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { AUTH_COOKIE_NAME } from "../config/auth.js";

const SESSION_ACTIVITY_INTERVAL_MS = 60_000;
const MAX_SESSION_TOKEN_LENGTH = 4096;

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token: unknown = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.substring(7).trim();
    }
    if (typeof token !== "string" || !token || token.length > MAX_SESSION_TOKEN_LENGTH) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    // Schema ownership belongs to migrations. Never repair tables during login.
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      return res.status(401).json({ success: false, message: "Invalid or expired session" });
    }
    if (session.user.status !== "ACTIVE") {
      return res.status(403).json({ success: false, message: "Account is not active" });
    }

    const activityCutoff = new Date(now.getTime() - SESSION_ACTIVITY_INTERVAL_MS);
    if (!session.lastUsedAt || session.lastUsedAt <= activityCutoff) {
      // The conditional update coalesces concurrent activity writes. Authentication
      // still reads current expiry, revocation and account status on every request.
      await prisma.session.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          expiresAt: { gt: now },
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: activityCutoff } }],
        },
        data: { lastUsedAt: now },
      });
    }

    res.locals.user = session.user;
    res.locals.session = session;
    (req as Request & { user?: typeof session.user }).user = session.user;
    next();
  } catch (error) {
    // Unknown security state is not permission. The error handler returns a
    // controlled failure; no role fallback or runtime DDL is attempted here.
    next(error);
  }
}

export function requireRole(allowedRoles: string | string[]) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req: Request, res: Response, next: NextFunction) => {
    // Passport and legacy middleware also attach a verified server-side req.user.
    const user = res.locals.user || (req as Request & { user?: { role: string } }).user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!roles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "You do not have access to this resource." },
      });
    }
    next();
  };
}

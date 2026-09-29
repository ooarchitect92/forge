import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware.js";
import { assignOrganizationSeat, getOrganizationBilling, reserveUsage, settleUsageReservation, startOrganizationCheckout } from "../billing.service.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try { res.json({ success: true, ...(await getOrganizationBilling(String(req.params.organizationId), res.locals.user.id)) }); }
  catch (error) { next(error); }
});

router.post("/checkout", async (req, res, next) => {
  try {
    const key = String(req.header("Idempotency-Key") || "");
    const result = await startOrganizationCheckout({
      organizationId: String(req.params.organizationId), actorId: res.locals.user.id,
      planKey: req.body?.planKey, successUrl: req.body?.successUrl, cancelUrl: req.body?.cancelUrl,
      idempotencyKey: key, email: res.locals.user.email,
    });
    res.status(201).json({ success: true, checkout: result });
  } catch (error) { next(error); }
});

router.post("/seats/:userId", async (req, res, next) => {
  try { res.json({ success: true, ...(await assignOrganizationSeat(String(req.params.organizationId), res.locals.user.id, String(req.params.userId))) }); }
  catch (error) { next(error); }
});

router.post("/usage/reservations", async (req, res, next) => {
  try {
    const result = await reserveUsage({
      organizationId: String(req.params.organizationId), actorId: res.locals.user.id,
      resource: req.body?.resource, amount: Number(req.body?.amount), key: String(req.header("Idempotency-Key") || ""),
    });
    res.status(201).json({ success: true, reservation: result });
  } catch (error) { next(error); }
});

router.post("/usage/reservations/:id/:action", async (req, res, next) => {
  try {
    const action = String(req.params.action);
    if (action !== "consume" && action !== "release") return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    const result = await settleUsageReservation(String(req.params.organizationId), res.locals.user.id, String(req.params.id), action === "consume" ? "CONSUMED" : "RELEASED");
    res.json({ success: true, reservation: result });
  } catch (error) { next(error); }
});

export default router;

import express from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../src/middleware/auth.js";

const prisma = new PrismaClient();
const router = express.Router();

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role && role !== "ADMIN") return res.status(403).json({ error: "Admins only" });
  next();
}

/**
 * GET /admin/iot/status-reports
 * returns { items: [] }
 */
router.get("/iot/status-reports", requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await prisma.iotDeviceStatusReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return res.json({ items });
  } catch (err) {
    console.log("[admin/iot/status-reports] error:", err);
    return res.status(500).json({ error: "Failed to load IoT status reports." });
  }
});

/**
 * PATCH /admin/iot/status-reports/:id
 * body: { adminStatus, note? }
 */
router.patch("/iot/status-reports/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id;

  const adminStatus = (req.body?.adminStatus ?? "").toString().trim().toUpperCase();
  const note = req.body?.note != null ? String(req.body.note).trim() : undefined;

  if (!adminStatus) return res.status(400).json({ error: "adminStatus is required" });

  try {
    const updated = await prisma.iotDeviceStatusReport.update({
      where: { id },
      data: {
        adminStatus,
        ...(note !== undefined ? { note } : {}),
      },
    });

    return res.json({ message: "Status updated.", item: updated });
  } catch (err) {
    console.log("[admin/iot/status-reports/:id] error:", err);
    return res.status(500).json({ error: "Failed to update status." });
  }
});

export default router;

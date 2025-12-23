// apps/api/routes/admin.iot.js
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
    const rows = await prisma.iotDeviceStatusReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        bus: true,
        driver: true,
      },
    });

    // shape for web-admin (avoid blanks)
    const items = rows.map((r) => ({
      id: r.id,
      deviceId: r.deviceId || r.bus?.deviceId || null,
      busId: r.busId || null,
      driverProfileId: r.driverProfileId || null,

      status: r.status,
      adminStatus: r.adminStatus,
      note: r.note,

      createdAt: r.createdAt,
      updatedAt: r.updatedAt,

      // derived display fields
      busNumber: r.bus?.number || null,
      busPlate: r.bus?.plate || null,
      driverName: r.driver?.fullName || null,
    }));

    return res.json({ items });
  } catch (err) {
    console.log("[admin/iot/status-reports] error:", err);
    return res.status(500).json({ error: "Failed to load IoT status reports." });
  }
});

/**
 * PATCH /admin/iot/status-reports/:id
 * body: { adminStatus }
 */
router.patch("/iot/status-reports/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const adminStatus = (req.body?.adminStatus ?? "").toString().trim().toUpperCase();
  if (!adminStatus) return res.status(400).json({ error: "adminStatus is required" });

  try {
    const updated = await prisma.iotDeviceStatusReport.update({
      where: { id },
      data: { adminStatus },
    });

    return res.json({ message: "Status updated.", item: updated });
  } catch (err) {
    console.log("[admin/iot/status-reports/:id] error:", err);
    return res.status(500).json({ error: "Failed to update status." });
  }
});

export default router;

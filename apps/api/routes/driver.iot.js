// apps/api/routes/driver.iot.js
import express from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../src/middleware/auth.js";

const prisma = new PrismaClient();
const router = express.Router();

/* ---------------- helpers ---------------- */
function getUserId(req) {
  return req.user?.sub || req.user?.id || req.userId || null;
}

function requireDriver(req, res, next) {
  const role = req.user?.role;
  if (role && role !== "DRIVER") {
    return res.status(403).json({ error: "Drivers only" });
  }
  next();
}

function normalizeDriverStatus(status) {
  const s = String(status || "").trim().toUpperCase();
  if (s === "WORKING") return "WORKING";
  if (s === "NOT_WORKING") return "NOT_WORKING";
  if (s === "NEEDS_MAINTENANCE") return "NEEDS_MAINTENANCE";
  return null;
}

/**
 * POST /driver/iot/report
 * body: { status, note? }
 */
router.post("/iot/report", requireAuth, requireDriver, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const status = normalizeDriverStatus(req.body?.status);
  const note = (req.body?.note ?? "").toString().trim() || null;

  if (!status) {
    return res.status(400).json({
      error: "Invalid status. Use WORKING | NEEDS_MAINTENANCE | NOT_WORKING",
    });
  }

  try {
    // find driver profile + (optional) bus + deviceId
    const dp = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { bus: true },
    });

    const driverProfileId = dp?.driverId || null;
    const busId = dp?.busId || dp?.bus?.id || null;
    const deviceId = dp?.bus?.deviceId || null;

    const created = await prisma.iotDeviceStatusReport.create({
      data: {
        status,
        note,
        deviceId,
        busId,
        driverProfileId,
      },
    });

    return res.json({
      message: "IoT status report submitted.",
      item: created,
    });
  } catch (err) {
    console.log("[driver/iot/report] error:", err);
    return res.status(500).json({ error: "Failed to submit IoT report." });
  }
});

export default router;

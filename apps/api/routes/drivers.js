import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

router.post("/scan", async (req, res) => {
  try {
    // Validate the payload
    const { payload } = z.object({ payload: z.string().min(1) }).parse(req.body);
    const raw = payload.trim();

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {}

    let candidateId = parsed?.driverProfileId || parsed?.driverId || parsed?.userId || parsed?.id || raw;

    // Fetch driver profile with associated bus details
    let prof = await prisma.driverProfile.findUnique({
      where: { id: candidateId },
      include: { bus: true },
    });

    if (!prof) {
      prof = await prisma.driverProfile.findFirst({
        where: { userId: candidateId },
        include: { bus: true },
      });
    }

    if (!prof) {
      return res.status(404).json({ message: "Driver not found for this QR." });
    }

    const driverName = prof.driverName || prof.fullName || prof.name || "Unknown Driver";
    const busStatus = prof.bus?.status ?? null; // "ACTIVE" | "INACTIVE" | "IN_MAINTENANCE"
    const busIsActive = prof.bus?.isActive ?? null; // boolean

    // Add a check for maintenance status
    if (busStatus === "IN_MAINTENANCE") {
      return res.status(400).json({
        message: "Bus is under maintenance. Cannot start trip.",
      });
    }

    return res.json({
      driverProfileId: prof.id,
      userId: prof.userId,
      name: driverName,
      code: prof.id,
      busId: prof.busId ?? null,
      busNumber: prof.bus?.number ?? null,
      plateNumber: prof.bus?.plate ?? null,
      busType: prof.bus?.busType ?? null,
      vehicleType: prof.bus?.busType ?? null,
      busStatus,
      busIsActive,
    });
  } catch (e) {
    console.error("POST /drivers/scan ERROR", e);
    if (e instanceof z.ZodError)
      return res.status(400).json({ message: "Invalid payload" });

    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /drivers/by-user/:userId
 */
router.get("/by-user/:userId", async (req, res) => {
  try {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.params);

    const prof = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { bus: true },
    });

    if (!prof) return res.status(404).json({ message: "Driver profile not found" });

    const driverName = prof.driverName || prof.fullName || prof.name || "Unknown Driver";
    const busStatus = prof.bus?.status ?? null;
    const busIsActive = prof.bus?.isActive ?? null;

    return res.json({
      driverProfileId: prof.id,
      userId: prof.userId,
      fullName: driverName,
      busId: prof.busId,
      bus: prof.bus
        ? {
            id: prof.bus.id,
            number: prof.bus.number,
            plate: prof.bus.plate,
            type: prof.bus.busType,
            status: prof.bus.status,
            isActive: prof.bus.isActive,
          }
        : null,
      busStatus,
      busIsActive,
    });
  } catch (e) {
    console.error("GET /drivers/by-user/:userId ERROR", e);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /drivers/current (Driver-side auth)
 */
router.get("/current", async (req, res) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { driverProfile: { include: { bus: true } } },
    });

    if (!me?.driverProfile)
      return res.status(404).json({ message: "Not a driver" });

    const d = me.driverProfile;
    const driverName = d.driverName || d.fullName || d.name || "Unknown Driver";
    const busStatus = d.bus?.status ?? null;
    const busIsActive = d.bus?.isActive ?? null;

    return res.json({
      driverProfileId: d.id,
      userId: d.userId,
      fullName: driverName,
      busId: d.busId,
      bus: d.bus
        ? {
            id: d.bus.id,
            number: d.bus.number,
            plate: d.bus.plate,
            type: d.bus.busType,
            status: d.bus.status,
            isActive: d.bus.isActive,
          }
        : null,
      busStatus,
      busIsActive,
    });
  } catch (e) {
    console.error("GET /drivers/current ERROR", e);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /drivers/duty
 * Body: { status: "ON_DUTY" | "OFF_DUTY" }
 * Uses logged-in user (req.user.sub) to find DriverProfile and update status.
 */
router.patch("/duty", async (req, res) => {
  try {
    const { status } = z.object({ status: z.string().min(1) }).parse(req.body);
    const normalized = status.toUpperCase();

    if (!["ON_DUTY", "OFF_DUTY"].includes(normalized)) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid status. Use "ON_DUTY" or "OFF_DUTY".',
      });
    }

    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized: no user in token." });
    }

    const driver = await prisma.driverProfile.findFirst({
      where: { userId },
      select: { driverId: true, status: true },
    });

    if (!driver) {
      return res.status(404).json({
        ok: false,
        message: "Driver profile not found for this user.",
      });
    }

    // Check bus status before allowing "ON_DUTY"
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { driverId: driver.driverId },
      include: { bus: true },
    });

    if (driverProfile?.bus?.status === "IN_MAINTENANCE" && normalized === "ON_DUTY") {
      return res.status(400).json({
        ok: false,
        message: "Cannot go ON_DUTY, bus is under maintenance.",
      });
    }

    const updated = await prisma.driverProfile.update({
      where: { driverId: driver.driverId },
      data: { status: normalized },
      select: { driverId: true, status: true, busId: true },
    });

    return res.json({
      ok: true,
      status: updated.status,
    });
  } catch (e) {
    console.error("PATCH /drivers/duty ERROR", e);
    if (e instanceof z.ZodError) {
      return res.status(400).json({ ok: false, message: "Invalid request body." });
    }
    return res.status(500).json({
      ok: false,
      message: "Server error updating duty status.",
    });
  }
});

export default router;

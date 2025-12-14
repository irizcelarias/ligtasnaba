// apps/api/routes/iot.js
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const router = Router();
const prisma = new PrismaClient();

/* ---------- Zod schema for incoming IoT payload ---------- */
const iotIncidentSchema = z.object({
  code: z.string().min(1), // "YELLOW" | "ORANGE" | "RED"
  message: z.string().min(1),

  driverId: z.string().min(1).optional(),
  busNumber: z.string().min(1).optional(),
  plateNumber: z.string().min(1).optional(),

  latitude: z.number().optional(),
  longitude: z.number().optional(),

  deviceId: z.string().optional(),
});

/* =========================================
   POST /iot/emergency  (ESP32 -> API)
   ========================================= */
router.post("/emergency", async (req, res) => {
  try {
    const payload = iotIncidentSchema.parse(req.body || {});
    const codeUpper = payload.code.toUpperCase();

    let busId = null;
    let busNumber = null;
    let busPlate = null;
    let driverProfileId = null;

    let finalDeviceId = payload.deviceId || null;

    // 1) PRIORITY: lookup by deviceId (Bus.deviceId)
    if (finalDeviceId) {
      const busByDevice = await prisma.bus.findFirst({
        where: { deviceId: finalDeviceId },
        select: { id: true, number: true, plate: true },
      });

      if (busByDevice) {
        busId = busByDevice.id;
        busNumber = busByDevice.number;
        busPlate = busByDevice.plate;
      }
    }

    // 2) SECOND: lookup by busNumber / plateNumber
    if (!busId && (payload.busNumber || payload.plateNumber)) {
      const bus = await prisma.bus.findFirst({
        where: {
          OR: [
            payload.busNumber ? { number: payload.busNumber } : undefined,
            payload.plateNumber ? { plate: payload.plateNumber } : undefined,
          ].filter(Boolean),
        },
        select: {
          id: true,
          number: true,
          plate: true,
          deviceId: true,
        },
      });

      if (bus) {
        busId = bus.id;
        busNumber = bus.number;
        busPlate = bus.plate;

        // If IoT omitted deviceId, use the bus.deviceId
        if (!finalDeviceId && bus.deviceId) {
          finalDeviceId = bus.deviceId;
        }
      }
    }

    // 3) AUTO-ASSIGN ACTIVE DRIVER OF THIS BUS
    if (busId) {
      const driver = await prisma.driverProfile.findFirst({
        where: { busId, isActive: true },
        orderBy: { createdAt: "desc" },
        select: { driverId: true, fullName: true },
      });

      if (driver) {
        // FK column sa EmergencyIncident table
        driverProfileId = driver.driverId;
      }
    }

    // 4) Create the incident with the correct links
    const incident = await prisma.emergencyIncident.create({
      data: {
        deviceId: finalDeviceId || "UNKNOWN_DEVICE",
        code: codeUpper,
        message: payload.message,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        status: "PENDING",
        busId,
        driverProfileId,
        busNumber,
        busPlate,
      },
    });

    return res.status(201).json({
      ok: true,
      message: "Emergency incident recorded from IoT device.",
      incident,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        ok: false,
        message: "Invalid payload from IoT device",
        errors: err.errors,
      });
    }

    console.error("POST /iot/emergency ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to record emergency incident",
    });
  }
});

/* helper to normalize incidents (shared by active + history) */
function mapIncident(i) {
  const busNumber = i.busNumber || i.bus?.number || null;
  const busPlate = i.busPlate || i.bus?.plate || null;

  const driverName = i.driver?.fullName || null;

  return {
    id: i.id,
    deviceId: i.deviceId,
    code: i.code,
    message: i.message,
    latitude: i.latitude,
    longitude: i.longitude,
    status: i.status,
    busId: i.busId,
    driverProfileId: i.driverProfileId,
    busNumber,
    busPlate,
    createdAt: i.createdAt,
    resolvedAt: i.resolvedAt,
    driverName,
    bus: i.bus
      ? {
          id: i.bus.id,
          number: i.bus.number,
          plate: i.bus.plate,
        }
      : null,
  };
}

/* =========================================
   GET /iot/emergencies  (Admin dashboard – ACTIVE ONLY)
   ========================================= */
router.get("/emergencies", async (_req, res) => {
  try {
    const incidents = await prisma.emergencyIncident.findMany({
      where: {
        status: {
          in: ["PENDING", "ACTIVE", "OPEN", "ONGOING"],
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        driver: {
          select: { driverId: true, fullName: true },
        },
        bus: {
          select: { id: true, number: true, plate: true },
        },
      },
    });

    const mapped = incidents.map(mapIncident);

    return res.json(mapped);
  } catch (err) {
    console.error("GET /iot/emergencies ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to load IoT emergencies",
    });
  }
});

/* =========================================
   GET /iot/emergencies/history  (Emergency Reports – RESOLVED/CLOSED)
   ========================================= */
router.get("/emergencies/history", async (_req, res) => {
  try {
    const incidents = await prisma.emergencyIncident.findMany({
      where: {
        status: {
          in: ["RESOLVED", "CLOSED"],
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        driver: {
          select: { driverId: true, fullName: true },
        },
        bus: {
          select: { id: true, number: true, plate: true },
        },
      },
    });

    const mapped = incidents.map(mapIncident);

    return res.json(mapped);
  } catch (err) {
    console.error("GET /iot/emergencies/history ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to load IoT emergency history",
    });
  }
});

/* =========================================
   POST /iot/emergencies/:id/resolve
   ========================================= */
router.post("/emergencies/:id/resolve", async (req, res) => {
  const { id } = req.params;

  try {
    const incident = await prisma.emergencyIncident.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });

    return res.json({
      ok: true,
      message: "Incident marked as resolved.",
      incident,
    });
  } catch (err) {
    console.error("POST /iot/emergencies/:id/resolve ERROR:", err);

    if (err.code === "P2025") {
      return res.status(404).json({
        ok: false,
        message: "Incident not found.",
      });
    }

    return res.status(500).json({
      ok: false,
      message: "Failed to resolve incident.",
    });
  }
});

export default router;

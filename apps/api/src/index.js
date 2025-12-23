// apps/api/src/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
dotenv.config();

if (typeof globalThis.fetch !== "function") {
  const { default: nodeFetch } = await import("node-fetch");
  globalThis.fetch = nodeFetch;
}

/* ---------- utils ---------- */
function abs(req, rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}${rel.startsWith("/") ? "" : "/"}${rel}`;
}

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import QRCode from "qrcode";

import { sendOtpEmail, sendPasswordResetEmail } from "./utils/mailer.js";

import mapsRouter from "../routes/maps.js";
import tripsRouter from "../routes/trips.js";
import incidentsRouter from "../routes/incidents.js";
import adminDriversRouter from "../routes/admin.drivers.js";
import driversRouter from "../routes/drivers.js";
import driverProfileRouter from "../routes/driver.profile.js";
import commuterTripsRouter from "../routes/commuter.trips.js";
import driverRatingsRouter from "../routes/driver.ratings.js";
import driverReportsRouter from "../routes/driver.reports.js";
import adminFeedbackRouter from "../routes/admin.feedback.js";
import adminIncidentsRouter from "../routes/admin.incidents.js";
import adminSettingsRoutes from "../routes/admin.settings.js";
import iotRouter from "../routes/iot.js";
import adminTripsRouter from "../routes/admin-trips.js";
import driverIotRouter from "../routes/driver.iot.js";
import adminIotRouter from "../routes/admin.iot.js";


const app = express();
const prisma = new PrismaClient();

/* ---------- app setup ---------- */
app.set("trust proxy", 1);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const GOOGLE_PLACES_KEY =
  process.env.GOOGLE_PLACES_KEY || process.env.GOOGLE_DIRECTIONS_KEY || "";

/* ---------- auth helpers ---------- */
const sign = (u) =>
  jwt.sign({ sub: u.id, role: u.role, email: u.email }, JWT_SECRET, {
    expiresIn: "7d",
  });

function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN")
    return res.status(403).json({ message: "Admins only" });
  next();
}

function requireUserAuth(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user?.role !== "COMMUTER") {
      return res.status(403).json({ message: "Commuters only" });
    }
    next();
  });
}

function requireDriverAuth(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user?.role !== "DRIVER") {
      return res.status(403).json({ message: "Drivers only" });
    }
    next();
  });
}

/* ---------- simple OTP store (dev) ---------- */
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

function setOtp(email) {
  const code = generateOtp();
  const now = Date.now();
  otpStore.set(email, { code, expiresAt: now + OTP_TTL_MS, lastSentAt: now });
  return code;
}

/* ---------- password-reset store (forgot password) ---------- */
// separate from account-activation OTPs so they don't conflict
const resetStore = new Map();
const RESET_TTL_MS = 10 * 60 * 1000; // 10 minutes

function setResetToken(email) {
  const code = generateOtp();
  const now = Date.now();
  resetStore.set(email, { code, expiresAt: now + RESET_TTL_MS });
  return code;
}

/* ---------- health ---------- */
app.get("/health", async (_req, res) => {
  try {
    await prisma.user.count();
    res.json({
      ok: true,
      version: "build-v6",
      env: { port: PORT, database: true, googleKeyPresent: !!GOOGLE_PLACES_KEY },
    });
  } catch {
    res.json({
      ok: false,
      version: "build-v6",
      env: { port: PORT, database: false, googleKeyPresent: !!GOOGLE_PLACES_KEY },
    });
  }
});

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* ---------- QR images (driver QR codes) ---------- */
app.use(
  "/driver-qr",
  express.static(path.join(process.cwd(), "public", "driver-qr"))
);

/* ---------- routers ---------- */
app.use("/maps", mapsRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/incidents", incidentsRouter);

app.use("/drivers", requireAuth, driversRouter);
app.use("/driver", requireAuth, driverProfileRouter);
app.use("/driver", requireAuth, driverRatingsRouter);
app.use("/driver", requireAuth, driverReportsRouter);

// MOUNT IOT ROUTER UNDER /iot TO AVOID CONFLICTS
app.use("/iot", iotRouter);
app.use(adminTripsRouter);

app.use("/driver", driverIotRouter);
app.use("/admin", adminIotRouter);

/* --- DRIVER DUTY STATUS (ON_DUTY / OFF_DUTY) --- */
app.patch("/driver/duty", requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== "DRIVER") {
      return res.status(403).json({ message: "Drivers only" });
    }

    const schema = z.object({
      status: z.enum(["ON_DUTY", "OFF_DUTY"]),
    });

    const { status } = schema.parse(req.body);

    const driver = await prisma.driverProfile.findUnique({
      where: { userId: req.user.sub },
    });

    if (!driver) {
      return res.status(404).json({ message: "Driver profile not found" });
    }

    const updated = await prisma.driverProfile.update({
      where: { driverId: driver.driverId },
      data: { status },
    });

    return res.json({
      message: "Duty status updated",
      status: updated.status,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid status" });
    }
    console.error("PATCH /driver/duty ERROR:", err);
    return res.status(500).json({ message: "Failed to update duty status" });
  }
});

/* ---------- COMMUTER BUS QR SCAN (for mobile app) ---------- */
app.post("/commuter/scan-bus", requireUserAuth, async (req, res) => {
  try {
    let { payload } = req.body || {};
    if (!payload) {
      return res.status(400).json({ message: "Missing payload" });
    }

    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = { raw: payload };
      }
    }

    if (payload.type && payload.type !== "bus") {
      return res.status(400).json({ message: "QR is not a bus code" });
    }

    const busNumber =
      payload.busNumber ||
      payload.number ||
      payload.bus_no ||
      payload.bus?.number ||
      null;

    if (!busNumber) {
      return res
        .status(400)
        .json({ message: "Bus number missing in QR payload" });
    }

    const bus = await prisma.bus.findFirst({
      where: { number: String(busNumber) },
    });

    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    // ✅ IMPORTANT: kuhaa ang related user + commuterProfile aron naay fallback sa avatar ug name
    const driver = await prisma.driverProfile.findFirst({
      where: {
        busId: bus.id,
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          include: {
            commuterProfile: true,
          },
        },
      },
    });

    const driverStatus = driver?.status || "OFF_DUTY";
    const onDuty = driverStatus === "ACTIVE" || driverStatus === "ON_DUTY";

    // ✅ PICK BEST NAME
    const driverName =
      driver?.fullName ||
      driver?.user?.commuterProfile?.fullName ||
      driver?.user?.email ||
      "Unknown Driver";

    // ✅ PICK BEST AVATAR SOURCE (driverProfile OR commuterProfile)
    const avatarRel =
      driver?.profileUrl ||
      driver?.user?.commuterProfile?.profileUrl ||
      null;

    const driverAvatarAbs = avatarRel ? abs(req, avatarRel) : null;

    return res.json({
      driverProfileId: driver?.id ?? null,
      driverId: driver?.driverId ?? null,
      busId: bus.id,
      name: driverName,
      code: driver?.driverId ?? driver?.code ?? driver?.driverCode ?? null,
      busNumber: bus.number,
      plateNumber: bus.plate,
      busType: bus.busType,
      corridor: bus.corridor,
      forwardRoute: bus.forwardRoute,
      returnRoute: bus.returnRoute,
      status: driverStatus,
      onDuty,
      deviceId: bus.deviceId || null, // expose deviceId to client

      // ✅ these are what BusScanner reads
      driverAvatar: driverAvatarAbs,
      profileUrl: driverAvatarAbs,
    });
  } catch (err) {
    console.error("POST /commuter/scan-bus ERROR:", err);
    res.status(500).json({ message: "Failed to scan bus QR" });
  }
});

app.use("/commuter", requireUserAuth, commuterTripsRouter);

/* ----- ADMIN AREA (ALL PROTECTED) ----- */
app.use("/admin", requireAuth, requireAdmin, adminDriversRouter);
app.use("/admin", requireAuth, requireAdmin, adminSettingsRoutes);
app.use("/admin", requireAuth, requireAdmin, adminFeedbackRouter);
app.use(
  "/admin/incidents",
  requireAuth,
  requireAdmin,
  adminIncidentsRouter
);

/* ---------- auth endpoints ---------- */
app.post("/auth/login", async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().min(3),
      password: z.string().min(6),
    });

    const { email, password } = schema.parse(req.body);
    const identifier = email.trim();
    const isEmail = identifier.includes("@");

    const where = isEmail
      ? { email: identifier.toLowerCase() }
      : { phone: identifier };

    const user = await prisma.user.findFirst({ where });

    if (!user || !user.password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const statusUpper = String(user.status || "").toUpperCase();

    if (user.role === "COMMUTER" && statusUpper !== "ACTIVE") {
      return res.status(403).json({
        message: "Account not verified. Please complete OTP verification.",
        code: "NOT_ACTIVE",
      });
    }

    if (statusUpper === "BLOCKED") {
      return res.status(403).json({ message: "Account is blocked" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({
      token: sign(user),
      role: user.role,
      mustChangePassword: user.mustChangePassword || false,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid input" });
    }
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/auth/register", async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      phone: z.string().min(6),
      password: z.string().min(6),
      role: z.enum(["COMMUTER", "DRIVER"]).optional(),
      fullName: z.string().min(1),
      address: z.string().optional(),
      language: z.string().optional(),
    });
    const { email, phone, password, role, fullName, address, language } =
      schema.parse(req.body);
    const key = email.toLowerCase().trim();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: key }, { phone }] },
      include: { commuterProfile: true },
    });

    if (existing) {
      const isActive = String(existing.status || "").toUpperCase() === "ACTIVE";
      if (isActive)
        return res
          .status(409)
          .json({ message: "Email or phone already registered" });

      const hash = await bcrypt.hash(password, 12);
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          email: key,
          phone,
          password: hash,
          role: role ?? existing.role ?? "COMMUTER",
          mustChangePassword: false,
          status: "PENDING_VERIFICATION",
          ...(role === "COMMUTER" || !role
            ? existing.commuterProfile
              ? {
                  commuterProfile: {
                    update: {
                      fullName,
                      address:
                        address ?? existing.commuterProfile.address ?? null,
                      language:
                        language ?? existing.commuterProfile.language ?? "en",
                    },
                  },
                }
              : {
                  commuterProfile: {
                    create: {
                      fullName,
                      address: address || null,
                      language: language || "en",
                    },
                  },
                }
            : {}),
        },
      });

      const code = setOtp(key);
      try {
        await sendOtpEmail(key, code);
      } catch (err2) {
        console.error("MAILTRAP SEND OTP (existing) ERROR:", err2);
      }
      console.log(`OTP (unverified existing) for ${key}: ${code}`);
      return res.status(200).json({
        code: "UNVERIFIED",
        message: "Account exists but unverified. OTP resent.",
        user: updated,
      });
    }

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: key,
        phone,
        password: hash,
        role: role ?? "COMMUTER",
        mustChangePassword: false,
        status: "PENDING_VERIFICATION",
        ...(role === "COMMUTER" || !role
          ? {
              commuterProfile: {
                create: {
                  fullName,
                  address: address || null,
                  language: language || "en",
                },
              },
            }
          : {}),
      },
      include: { commuterProfile: true },
    });

    const code = setOtp(key);
    try {
      await sendOtpEmail(key, code);
    } catch (err2) {
      console.error("MAILTRAP SEND OTP (new user) ERROR:", err2);
    }
    console.log(`OTP for ${key}: ${code}`);
    res.status(201).json({ message: "Registered. OTP sent.", user });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ message: err.errors[0]?.message || "Invalid input" });
    if (err?.code === "P2002")
      return res
        .status(409)
        .json({ message: "Email or phone already registered" });
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/auth/request-otp", async (req, res) => {
  try {
    const schema = z.object({ email: z.string().email() });
    const { email } = schema.parse(req.body);
    const key = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: key },
      select: { id: true, status: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const existing = otpStore.get(key);
    const now = Date.now();
    if (existing && now - existing.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      const secs = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000
      );
      return res
        .status(429)
        .json({ message: `Please wait ${secs}s before requesting again` });
    }

    const code = setOtp(key);
    try {
      await sendOtpEmail(key, code);
    } catch (err2) {
      console.error("MAILTRAP SEND OTP (request-otp) ERROR:", err2);
    }
    console.log(`[request-otp] Resent OTP for ${key}: ${code}`);
    return res.json({
      message: "OTP sent",
      // OTP code intentionally not returned to client
    });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res.status(400).json({ message: "Invalid email" });
    console.error("REQUEST OTP ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      code: z.string().length(6),
    });
    const { email, code } = schema.parse(req.body);
    const key = email.toLowerCase().trim();

    const record = otpStore.get(key);
    if (!record)
      return res
        .status(400)
        .json({ message: "No OTP found. Please request again." });
    if (Date.now() > record.expiresAt) {
      otpStore.delete(key);
      return res.status(400).json({ message: "OTP expired. Request again." });
    }
    if (record.code !== code.trim())
      return res.status(400).json({ message: "Invalid code" });

    otpStore.delete(key);
    const user = await prisma.user.update({
      where: { email: key },
      data: { status: "ACTIVE" },
    });

    const token = sign(user);
    console.log(`OTP verified for ${key}`);
    res.json({ token, user });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res.status(400).json({ message: "Invalid input" });
    console.error("VERIFY OTP ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------- password reset (forgot + reset) ---------- */

// 1) request password reset – send code to email
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const schema = z.object({ email: z.string().email() });
    const { email } = schema.parse(req.body);
    const key = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: key },
      include: {
        commuterProfile: true,
        driverProfile: true,
      },
    });

    // ❌ Email not found → tell the client explicitly
    if (!user) {
      console.log(`[forgot-password] No user found for ${key}`);
      return res
        .status(404)
        .json({ ok: false, message: "Email not registered." });
    }

    const code = setResetToken(key);

    const displayName =
      user.driverProfile?.fullName ||
      user.commuterProfile?.fullName ||
      "LigtasCommute user";

    try {
      await sendPasswordResetEmail(key, code, displayName);
    } catch (err2) {
      console.error("MAILTRAP SEND RESET CODE ERROR:", err2);
      // still continue; code is stored in resetStore
    }

    console.log(
      `[forgot-password] Reset code for ${key}: ${code} (expires in ${
        RESET_TTL_MS / 60000
      }m)`
    );

    return res.json({
      ok: true,
      message: "Password reset code sent.",
      // Reset code intentionally not returned to client
    });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res.status(400).json({ ok: false, message: "Invalid email" });
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// 2) actually reset password using code
app.post("/auth/reset-password", async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      code: z.string().length(6),
      newPassword: z.string().min(6),
    });

    const { email, code, newPassword } = schema.parse(req.body);
    const key = email.toLowerCase().trim();

    const record = resetStore.get(key);
    if (!record) {
      return res
        .status(400)
        .json({ message: "No reset request found. Please try again." });
    }

    if (Date.now() > record.expiresAt) {
      resetStore.delete(key);
      return res
        .status(400)
        .json({ message: "Reset code expired. Please request again." });
    }

    if (record.code !== code.trim()) {
      return res.status(400).json({ message: "Invalid reset code" });
    }

    const user = await prisma.user.findUnique({
      where: { email: key },
    });

    if (!user) {
      resetStore.delete(key);
      return res.status(404).json({ message: "User not found" });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hash, mustChangePassword: false },
    });

    resetStore.delete(key);
    return res.json({ message: "Password reset successful" });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res.status(400).json({ message: "Invalid input" });
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------- buses (admin) ---------- */

// shared include so each bus comes with its drivers
const BUS_INCLUDE = {
  drivers: {
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: {
      driverId: true,
      fullName: true,
      status: true,
      isActive: true,
      createdAt: true,
      busId: true,
    },
  },
};

app.get("/buses", requireAuth, requireAdmin, async (req, res) => {
  const { busType, type, vehicleType, active, status, corridor } = req.query;
  const typeParam = busType || type || vehicleType;

  const where = {
    ...(typeParam ? { busType: String(typeParam).toUpperCase() } : {}),
    ...(active != null ? { isActive: String(active) === "true" } : {}),
    ...(status ? { status: String(status).toUpperCase() } : {}),
    ...(corridor ? { corridor: String(corridor).toUpperCase() } : {}),
  };

  try {
    const buses = await prisma.bus.findMany({
      where,
      include: BUS_INCLUDE,
      orderBy: [{ createdAt: "desc" }],
    });

    res.json(buses);
  } catch (err) {
    console.error("GET /buses ERROR:", err);
    res.status(500).json({ message: "Failed to load buses" });
  }
});

app.get("/buses/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const bus = await prisma.bus.findUnique({
      where: { id: req.params.id },
      include: BUS_INCLUDE,
    });
    if (!bus) return res.status(404).json({ message: "Bus not found" });
    res.json(bus);
  } catch (err) {
    console.error("GET /buses/:id ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get(
  "/buses/by-number/:number",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const bus = await prisma.bus.findFirst({
        where: { number: req.params.number },
        include: BUS_INCLUDE,
      });
      if (!bus) return res.status(404).json({ message: "Bus not found" });
      res.json(bus);
    } catch (err) {
      console.error("GET /buses/by-number/:number ERROR:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// CREATE BUS + generate QR
app.post("/buses", requireAuth, requireAdmin, async (req, res) => {
  try {
    const schema = z.object({
      number: z.string().min(1),
      plate: z.string().min(1),
      busType: z.enum(["AIRCON", "NON_AIRCON"]),
      status: z.enum(["ACTIVE", "IN_MAINTENANCE", "INACTIVE"]).optional(),
      corridor: z.enum(["EAST", "WEST"]).optional(),
      isActive: z.boolean().optional(),
      routeId: z.string().optional(),
      forwardRoute: z.string().optional(),
      returnRoute: z.string().optional(),
      deviceId: z.string().min(1).optional(), // NEW
    });

    const input = schema.parse(req.body);

    const finalStatus = (input.status || "ACTIVE").toUpperCase();
    const finalCorridor = (input.corridor || "EAST").toUpperCase();

    const bus = await prisma.bus.create({
      data: {
        number: input.number,
        plate: input.plate,
        busType: input.busType,
        status: finalStatus,
        corridor: finalCorridor,
        isActive:
          typeof input.isActive === "boolean"
            ? input.isActive
            : finalStatus === "ACTIVE",
        routeId: input.routeId || null,
        forwardRoute: input.forwardRoute || null,
        returnRoute: input.returnRoute || null,
        deviceId: input.deviceId ? input.deviceId.trim() : null, // NEW
      },
    });

    const payload = {
      type: "bus",
      busId: bus.id,
      number: bus.number,
      plate: bus.plate,
      busType: bus.busType,
      corridor: bus.corridor,
      routeId: bus.routeId,
      deviceId: bus.deviceId || null, // include in QR payload
    };

    const qrUrl = await QRCode.toDataURL(JSON.stringify(payload), {
      margin: 1,
      scale: 6,
    });

    const updatedBus = await prisma.bus.update({
      where: { id: bus.id },
      data: { qrUrl },
    });

    console.log(
      "CREATE BUS:",
      updatedBus.id,
      updatedBus.number,
      updatedBus.plate
    );
    res.status(201).json(updatedBus);
  } catch (err) {
    if (err?.code === "P2002")
      return res
        .status(409)
        .json({ message: "Bus number or plate already exists" });
    if (err instanceof z.ZodError)
      return res.status(400).json({ message: "Invalid input" });
    console.error("CREATE BUS ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// UPDATE BUS + regenerate QR if anything important changed
app.put("/buses/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const schema = z.object({
      number: z.string().min(1).optional(),
      plate: z.string().min(1).optional(),
      busType: z.enum(["AIRCON", "NON_AIRCON"]).optional(),
      status: z.enum(["ACTIVE", "IN_MAINTENANCE", "INACTIVE"]).optional(),
      corridor: z.enum(["EAST", "WEST"]).optional(),
      isActive: z.boolean().optional(),
      routeId: z.string().optional(),
      forwardRoute: z.string().optional(),
      returnRoute: z.string().optional(),
      deviceId: z.string().min(1).optional(), // NEW
    });

    const input = schema.parse(req.body);

    const data = {
      ...input,
      ...(input.status
        ? {
            status: input.status,
            ...(input.isActive === undefined
              ? { isActive: input.status === "ACTIVE" }
              : {}),
          }
        : {}),
      ...(input.corridor ? { corridor: input.corridor } : {}),
    };

    // Allow clearing deviceId ("", null)
    if (input.deviceId !== undefined) {
      data.deviceId = input.deviceId.trim() || null;
    }

    const bus = await prisma.bus.update({
      where: { id: req.params.id },
      data,
    });

    const payload = {
      type: "bus",
      busId: bus.id,
      number: bus.number,
      plate: bus.plate,
      busType: bus.busType,
      corridor: bus.corridor,
      routeId: bus.routeId,
      deviceId: bus.deviceId || null, // NEW
    };

    const qrUrl = await QRCode.toDataURL(JSON.stringify(payload), {
      margin: 1,
      scale: 6,
    });

    const updatedBus = await prisma.bus.update({
      where: { id: bus.id },
      data: { qrUrl },
    });

    res.json(updatedBus);
  } catch (err) {
    if (err?.code === "P2025")
      return res.status(404).json({ message: "Bus not found" });
    if (err?.code === "P2002")
      return res
        .status(409)
        .json({ message: "Bus number or plate already exists" });
    if (err instanceof z.ZodError)
      return res.status(400).json({ message: "Invalid input" });
    console.error("UPDATE BUS ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/buses/:id", requireAuth, requireAdmin, async (req, res) => {
  const soft = String(req.query.soft || "true") === "true";
  try {
    if (soft) {
      const bus = await prisma.bus.update({
        where: { id: req.params.id },
        data: { isActive: false, status: "INACTIVE" },
      });
      return res.json({ message: "Bus deactivated", bus });
    }
    await prisma.bus.delete({ where: { id: req.params.id } });
    res.json({ message: "Bus deleted" });
  } catch (err) {
    if (err?.code === "P2025")
      return res.status(404).json({ message: "Bus not found" });
    console.error("DELETE BUS ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------- user profile ---------- */
app.get("/users/me", requireAuth, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: {
        commuterProfile: true,
        driverProfile: { include: { bus: true } },
      },
    });
    if (!me) return res.status(404).json({ message: "User not found" });

    const contacts = await prisma.emergencyContact.findMany({
      where: { userId: me.id },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      select: { name: true, phone: true, relation: true, priority: true },
    });

    const commuter = me.commuterProfile;
    const driverProfile = me.driverProfile;

    const driverQrRel = driverProfile?.qrUrl || null;
    const driverQrAbs = driverQrRel ? abs(req, driverQrRel) : null;

    res.json({
      id: me.id,
      email: me.email,
      phone: me.phone,
      role: me.role,
      status: me.status,

      fullName: driverProfile?.fullName ?? commuter?.fullName ?? null,
      address: driverProfile?.address ?? commuter?.address ?? null,
      language: commuter?.language ?? "en",

      profileUrl: commuter?.profileUrl ? abs(req, commuter.profileUrl) : null,
      emergencyContacts: contacts,

      qrUrl: driverQrAbs,
      driverQrUrl: driverQrAbs,

      driver: driverProfile
        ? {
            driverId: driverProfile.driverId,
            fullName: driverProfile.fullName,
            status: driverProfile.status,
            corridor: driverProfile.corridor,
            forwardRoute: driverProfile.forwardRoute,
            returnRoute: driverProfile.returnRoute,
            qrUrl: driverQrAbs,
            bus: driverProfile.bus
              ? {
                  id: driverProfile.bus.id,
                  number: driverProfile.bus.number,
                  plate: driverProfile.bus.plate,
                  type: driverProfile.bus.busType,
                  isActive: driverProfile.bus.isActive,
                  corridor: driverProfile.bus.corridor,
                  forwardRoute: driverProfile.bus.forwardRoute,
                  returnRoute: driverProfile.bus.returnRoute,
                }
              : null,
          }
        : null,
    });
  } catch (err) {
    console.error("GET /users/me ERROR:", err);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

app.patch("/users/me", requireAuth, async (req, res) => {
  try {
    const schema = z.object({
      fullName: z.string().min(1).optional(),
      phone: z.string().min(6).optional(),
      address: z.string().optional(),
      language: z.string().optional(),
      profileUrl: z.string().optional(),
      emergencyContacts: z
        .array(
          z.object({
            name: z.string().min(1),
            phone: z.string().min(6),
            relation: z.string().optional().nullable(),
            priority: z.number().int().min(0).max(2).optional(),
          })
        )
        .max(3)
        .optional(),
    });

    const input = schema.parse(req.body);
    const userId = req.user.sub;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { commuterProfile: true, driverProfile: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (input.phone) {
      await prisma.user.update({
        where: { id: userId },
        data: { phone: input.phone },
      });
    }

    const commuter =
      user.commuterProfile ??
      (await prisma.commuterProfile.create({
        data: {
          userId,
          fullName:
            input.fullName ?? user.driverProfile?.fullName ?? "Commuter",
          address: input.address ?? null,
          language: input.language ?? "en",
          profileUrl: input.profileUrl ?? null,
        },
      }));

    if (user.commuterProfile) {
      await prisma.commuterProfile.update({
        where: { id: commuter.id },
        data: {
          ...(input.fullName ? { fullName: input.fullName } : {}),
          ...(input.address !== undefined
            ? { address: input.address ?? null }
            : {}),
          ...(input.language ? { language: input.language } : {}),
          ...(input.profileUrl !== undefined
            ? { profileUrl: input.profileUrl ?? null }
            : {}),
        },
      });
    }

    if (input.emergencyContacts) {
      const payload = input.emergencyContacts.slice(0, 3).map((c, i) => ({
        userId,
        name: c.name,
        phone: c.phone,
        relation: c.relation ?? null,
        priority: c.priority ?? i,
      }));

      await prisma.$transaction([
        prisma.emergencyContact.deleteMany({ where: { userId } }),
        prisma.emergencyContact.createMany({ data: payload }),
      ]);
    }

    const contacts = await prisma.emergencyContact.findMany({
      where: { userId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      select: { name: true, phone: true, relation: true, priority: true },
    });

    return res.json({
      message: "Profile updated successfully",
      emergencyContacts: contacts,
    });
  } catch (err) {
    console.error("PATCH /users/me ERROR:", err);
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ message: err.errors[0]?.message || "Invalid input" });
    if (err?.code === "P2002")
      return res
        .status(409)
        .json({ message: "Duplicate entry (phone/priority per user)" });
    res.status(500).json({ message: "Server error" });
  }
});

app.patch("/users/change-password", requireAuth, async (req, res) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(6),
      newPassword: z.string().min(6),
    });
    const { currentPassword, newPassword } = schema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user || !user.password)
      return res.status(404).json({ message: "User not found" });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok)
      return res
        .status(400)
        .json({ message: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hash, mustChangePassword: false },
    });
    res.json({ message: "Password updated" });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res.status(400).json({ message: "Invalid input" });
    console.error("CHANGE PASSWORD ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------- start/shutdown ---------- */
const server = app.listen(PORT, HOST, () =>
  console.log(`API running on http://${HOST}:${PORT}`)
);

function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

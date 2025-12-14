// apps/web-admin/src/app/(protected)/emergency-dashboard/page.js
"use client";

import { useEffect, useRef, useState } from "react";
import { listIotEmergencies, resolveEmergency } from "@/lib/api";
import { Poppins } from "next/font/google";

/* ---------- FONT ---------- */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

/* ---------- small helpers ---------- */
function timeAgo(dateString) {
  if (!dateString) return "—";
  const created = new Date(dateString);
  if (Number.isNaN(created.getTime())) return "—";

  const diffMs = Date.now() - created.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin === 1) return "1 min ago";
  if (diffMin < 60) return `${diffMin} mins ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return "1 hour ago";
  if (diffHr < 24) return `${diffHr} hrs ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "1 day ago";
  return `${diffDay} days ago`;
}

function fmtDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

/* code (YELLOW / ORANGE / RED) -> severity label */
function mapSeverityFromCode(codeRaw) {
  const c = (codeRaw || "").toString().toUpperCase();

  if (c === "RED" || c === "CODE_RED") return "HIGH";
  if (c === "ORANGE" || c === "CODE_ORANGE") return "MODERATE";
  if (c === "YELLOW" || c === "CODE_YELLOW") return "MINOR";

  return "UNKNOWN";
}

// small helper so we can filter by "last X days" etc.
function isWithinDays(dateString, days) {
  if (!dateString) return false;
  const dt = new Date(dateString);
  if (Number.isNaN(dt.getTime())) return false;
  const now = new Date();
  const diffMs = now.getTime() - dt.getTime();
  return diffMs <= days * 24 * 60 * 60 * 1000 && diffMs >= 0;
}

/* ---------- main component ---------- */
export default function EmergencyDashboardPage() {
  const [emergencies, setEmergencies] = useState([]);
  const [allEmergencies, setAllEmergencies] = useState([]); // full list from API
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [flash, setFlash] = useState({ type: "", text: "" });

  // for realtime + modal
  const [alertIncident, setAlertIncident] = useState(null);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const prevIdsRef = useRef(new Set());
  const hasLoadedRef = useRef(false);

  const S = styles;

  function showFlash(type, text) {
    setFlash({ type, text });
    setTimeout(() => setFlash({ type: "", text: "" }), 1400);
  }

  // quiet=true = used for background polling (no loading spinner / flash)
  async function loadEmergencies(quiet = false) {
    try {
      if (!quiet) setLoading(true);

      const data = await listIotEmergencies({});

      const arr = Array.isArray(data)
        ? data
        : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.incidents)
        ? data.incidents
        : [];

      setAllEmergencies(arr);

      const active = arr.filter((e) => {
        const st = (e.status || "").toString().toUpperCase();
        return (
          st === "PENDING" ||
          st === "ACTIVE" ||
          st === "OPEN" ||
          st === "ONGOING"
        );
      });

      // ---- detect new incident for popup modal ----
      const prevIds = prevIdsRef.current;
      let newIncident = null;
      for (const e of active) {
        const id = e?.id ?? e?.incidentId;
        if (id && !prevIds.has(id)) {
          newIncident = e;
          break;
        }
      }

      prevIdsRef.current = new Set(
        active.map((e) => e?.id ?? e?.incidentId).filter(Boolean)
      );

      setEmergencies(active);

      if (hasLoadedRef.current && newIncident) {
        setAlertIncident(newIncident);
        setShowAlertModal(true);
      }
      if (!hasLoadedRef.current) {
        hasLoadedRef.current = true;
      }
    } catch (err) {
      console.error("LOAD EMERGENCIES ERROR:", err);
      if (!quiet) {
        showFlash("error", err?.message || "Failed to load emergencies.");
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    // initial load
    loadEmergencies(false);

    // realtime polling every 5 seconds
    const intervalId = setInterval(() => {
      loadEmergencies(true);
    }, 5000);

    return () => clearInterval(intervalId);
  }, []);

  async function handleResolve(incident) {
    const id = incident?.id ?? incident?.incidentId;
    if (!id) return;

    try {
      setResolvingId(id);
      await resolveEmergency(id);

      setEmergencies((prev) =>
        prev.filter((e) => (e.id ?? e.incidentId) !== id)
      );
      const nextIds = new Set(prevIdsRef.current);
      nextIds.delete(id);
      prevIdsRef.current = nextIds;

      showFlash("success", "Incident marked as resolved.");
    } catch (err) {
      console.error("RESOLVE EMERGENCY ERROR:", err);
      showFlash("error", err?.message || "Failed to resolve incident.");
    } finally {
      setResolvingId(null);
    }
  }

  function severityPill(severityRaw, fallbackCode) {
    const Sx = S;

    const baseSeverity =
      (severityRaw && severityRaw.toString().toUpperCase()) ||
      mapSeverityFromCode(fallbackCode);

    let style;
    let label;

    if (baseSeverity === "MINOR" || baseSeverity === "LOW") {
      style = Sx.sevLow;
      label = "MINOR";
    } else if (baseSeverity === "MODERATE" || baseSeverity === "MEDIUM") {
      style = Sx.sevMedium;
      label = "MODERATE";
    } else if (baseSeverity === "HIGH" || baseSeverity === "CRITICAL") {
      style = Sx.sevHigh;
      label = "HIGH";
    } else {
      style = Sx.sevUnknown;
      label = "UNKNOWN";
    }

    return <span style={style}>{label}</span>;
  }

  // ---------- normalize incident from API ---------- */
  function normalizeIncident(e) {
    if (!e) return null;
    const id = e?.id ?? e?.incidentId;

    const busNumber = e?.busNumber || e?.bus?.number || "Unknown bus";

    const busPlate = e?.busPlate || e?.plateNumber || e?.bus?.plate || null;

    const driverName =
      e?.driverName ||
      e?.driverFullName ||
      e?.driver?.fullName ||
      "Unknown driver";

    const deviceId =
      e?.deviceId ||
      e?.device_id ||
      e?.deviceCode ||
      e?.iotDeviceId ||
      "N/A";

    // Build coordinate label + map link
    let coordLabel = null;
    let mapUrl = null;

    if (typeof e?.latitude === "number" && typeof e?.longitude === "number") {
      const lat = e.latitude.toFixed(5);
      const lng = e.longitude.toFixed(5);
      coordLabel = `${lat}, ${lng}`;
      mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    }

    const locationLabel =
      e?.locationLabel ||
      e?.locationText ||
      e?.nearestLandmark ||
      coordLabel ||
      "Location not available";

    const createdAt = e?.createdAt || e?.timestamp || e?.reportedAt || null;
    const severity = e?.severity || mapSeverityFromCode(e?.code);
    const message = e?.message || "No details provided.";

    return {
      id,
      busNumber,
      busPlate,
      driverName,
      deviceId,
      locationLabel,
      createdAt,
      severity,
      message,
      mapUrl,
      raw: e,
    };
  }

  const alertData = normalizeIncident(alertIncident);

  /* ---------- derived data for new sections ---------- */

  const normalizedActive = emergencies.map(normalizeIncident).filter(Boolean);

  const normalizedAll = allEmergencies.map(normalizeIncident).filter(Boolean);

  // overview stats (based on whatever we have in allEmergencies)
  const incidentsLast7Days = normalizedAll.filter((i) =>
    isWithinDays(i.createdAt, 7)
  );

  const totalActive = normalizedActive.length;
  const totalRecent = incidentsLast7Days.length;
  const totalIncidents = normalizedAll.length; // 👈 total incidents overall

  let highCount = 0;
  let moderateCount = 0;
  let minorCount = 0;

  normalizedActive.forEach((i) => {
    const sev = (i.severity || "").toString().toUpperCase();
    if (sev === "HIGH" || sev === "CRITICAL") highCount += 1;
    else if (sev === "MODERATE" || sev === "MEDIUM") moderateCount += 1;
    else if (sev === "MINOR" || sev === "LOW") minorCount += 1;
  });

  const lastIncident =
    normalizedAll.length > 0
      ? [...normalizedAll].sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        )[0]
      : null;

  // Timeline: latest 6 incidents (active or resolved from what we have)
  const timelineItems = [...normalizedAll]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  // Trends: incidents per day in last 7 days
  const now = new Date();
  const trendMap = {};
  incidentsLast7Days.forEach((i) => {
    const dt = new Date(i.createdAt);
    if (Number.isNaN(dt.getTime())) return;
    const key = dt.toISOString().slice(0, 10);
    trendMap[key] = (trendMap[key] || 0) + 1;
  });

  const trendDays = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    trendDays.push({
      key,
      label,
      count: trendMap[key] || 0,
    });
  }

  const maxTrendCount =
    trendDays.reduce((max, d) => Math.max(max, d.count), 0) || 1;

  // Driver performance snapshot (based on incidents count)
  const driverStatsMap = {};
  normalizedAll.forEach((i) => {
    const name = i.driverName || "Unknown driver";
    if (!driverStatsMap[name]) {
      driverStatsMap[name] = {
        name,
        total: 0,
        high: 0,
      };
    }
    driverStatsMap[name].total += 1;
    const sev = (i.severity || "").toString().toUpperCase();
    if (sev === "HIGH" || sev === "CRITICAL") driverStatsMap[name].high += 1;
  });

  const driverStats = Object.values(driverStatsMap).sort(
    (a, b) => b.total - a.total
  );
  const topDriver = driverStats[0] || null;
  const safestDriver =
    driverStats.length > 0
      ? [...driverStats].sort((a, b) => a.high - b.high || a.total - b.total)[0]
      : null;

  return (
    <div className={poppins.className} style={S.page}>
      {/* header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
          Emergency Dashboard
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 14 }}>
          Live monitoring of active emergency alerts from LigtasCommute devices.
        </p>
      </div>

      {/* ---------- QUICK OVERVIEW CARDS ---------- */}
      <section style={S.overviewGrid}>
        <div style={S.overviewCard}>
          <div style={S.overviewLabel}>Active Emergencies</div>
          <div style={S.overviewValue}>{totalActive}</div>
          <div style={S.overviewSub}>Real-time open alerts</div>
        </div>

        <div style={S.overviewCard}>
          <div style={S.overviewLabel}>High Severity (Active)</div>
          <div style={S.overviewValue}>{highCount}</div>
          <div style={S.overviewSub}>
            Red-level emergencies currently ongoing
          </div>
        </div>

        <div style={S.overviewCard}>
          <div style={S.overviewLabel}>Total Incidents</div>
          <div style={S.overviewValue}>{totalIncidents}</div>
          <div style={S.overviewSub}>
            All incidents received from IoT devices
          </div>
        </div>

        <div style={S.overviewCard}>
          <div style={S.overviewLabel}>Last Alert Received</div>
          <div style={S.overviewValueSm}>
            {lastIncident ? timeAgo(lastIncident.createdAt) : "—"}
          </div>
          <div style={S.overviewSub}>
            {lastIncident
              ? `Bus ${lastIncident.busNumber} · ${lastIncident.driverName}`
              : "No recent alerts"}
          </div>
        </div>
      </section>

      {/* top meta row – LIVE FEED */}
      <div style={S.topMetaRow}>
        <div style={S.livePill}>
          <span style={S.liveDot} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>LIVE FEED</span>
          <span style={S.liveCount}>
            {loading
              ? "Loading…"
              : `${emergencies.length} active incident${
                  emergencies.length === 1 ? "" : "s"
                }`}
          </span>
        </div>
      </div>

      {/* flash */}
      {flash.text && (
        <div aria-live="polite" role="status" style={S.flash(flash.type)}>
          {flash.text}
        </div>
      )}

      {/* main card – ACTIVE EMERGENCIES */}
      <section style={S.card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "flex-start",
            marginBottom: 8,
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 18,
                marginBottom: 2,
              }}
            >
              Active Emergencies
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Incidents will disappear here once marked as resolved and will
              move to Emergency Reports.
            </div>
          </div>
        </div>

        {loading && emergencies.length === 0 ? (
          <p style={S.muted}>Loading active emergencies…</p>
        ) : emergencies.length === 0 ? (
          <div style={S.emptyState}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              No active emergencies
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              All recent incidents are already resolved. This panel will update
              automatically whenever a new alert is triggered.
            </div>
          </div>
        ) : (
          <div style={S.incidentList}>
            {emergencies.map((e) => {
              const data = normalizeIncident(e);
              if (!data) return null;
              const {
                id,
                busNumber,
                busPlate,
                driverName,
                deviceId,
                locationLabel,
                createdAt,
                severity,
                message,
                mapUrl,
                raw,
              } = data;

              return (
                <div key={id || Math.random()} style={S.incidentCard}>
                  {/* top row: bus + driver + severity + time ago */}
                  <div style={S.incidentHeader}>
                    <div style={S.incidentTitleCol}>
                      <div style={S.incidentLabel}>BUS &amp; DRIVER</div>
                      <div style={S.incidentTitle}>
                        Bus {busNumber} · {driverName}
                      </div>
                    </div>

                    <div style={S.incidentRightCol}>
                      {severityPill(severity, raw?.code)}
                      <div style={S.incidentTime}>{timeAgo(createdAt)}</div>
                    </div>
                  </div>

                  {/* info grid with section labels */}
                  <div style={S.infoGrid}>
                    <div>
                      <div style={S.infoSectionHeader}>
                        INCIDENT INFORMATION
                      </div>
                      <div style={S.infoRow}>
                        <span style={S.infoLabel}>Device ID</span>
                        <span style={S.infoValue}>{deviceId}</span>
                      </div>
                      <div style={S.infoRow}>
                        <span style={S.infoLabel}>Reported at</span>
                        <span style={S.infoValue}>
                          {fmtDateTime(createdAt)}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div style={S.infoSectionHeader}>BUS &amp; LOCATION</div>
                      <div style={S.infoRow}>
                        <span style={S.infoLabel}>Location</span>
                        {mapUrl ? (
                          <a
                            href={mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={S.mapLink}
                          >
                            {locationLabel}
                          </a>
                        ) : (
                          <span style={S.infoValue}>{locationLabel}</span>
                        )}
                      </div>
                      <div style={S.infoRow}>
                        <span style={S.infoLabel}>Plate number</span>
                        <span style={S.infoValue}>
                          {busPlate || "Not available"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* message / details */}
                  <div style={S.infoRow}>
                    <span style={S.infoLabel}>Details</span>
                    <span style={S.infoValue}>{message}</span>
                  </div>

                  {/* footer: Resolve button */}
                  <div style={S.incidentFooter}>
                    <button
                      type="button"
                      style={{
                        ...S.resolveBtn,
                        ...(resolvingId === id ? { opacity: 0.6 } : {}),
                      }}
                      disabled={resolvingId === id}
                      onClick={() => handleResolve(e)}
                    >
                      {resolvingId === id ? "Resolving…" : "Mark as Resolved"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 🔔 EMERGENCY ALERT MODAL */}
      {showAlertModal && alertData && (
        <div style={S.modalOverlay}>
          <div style={S.modal}>
            <div style={S.modalHeader}>
              <div style={S.modalBadge}>NEW EMERGENCY</div>
              <button
                type="button"
                style={S.modalClose}
                onClick={() => setShowAlertModal(false)}
              >
                ×
              </button>
            </div>

            <div style={S.modalBody}>
              <div style={S.modalTitle}>
                Bus {alertData.busNumber} · {alertData.driverName}
              </div>
              <div style={S.modalMetaRow}>
                {severityPill(alertData.severity, alertData.raw?.code)}
                <span style={S.modalTime}>
                  {timeAgo(alertData.createdAt)}
                </span>
              </div>

              <div style={S.modalInfoGrid}>
                <div style={S.modalInfoItem}>
                  <div style={S.modalInfoLabel}>Device ID</div>
                  <div style={S.modalInfoValue}>{alertData.deviceId}</div>
                </div>

                <div style={S.modalInfoItem}>
                  <div style={S.modalInfoLabel}>Location</div>
                  {alertData.mapUrl ? (
                    <a
                      href={alertData.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={S.mapLink}
                    >
                      {alertData.locationLabel}
                    </a>
                  ) : (
                    <div style={S.modalInfoValue}>
                      {alertData.locationLabel}
                    </div>
                  )}
                </div>

                <div style={S.modalInfoItem}>
                  <div style={S.modalInfoLabel}>Reported at</div>
                  <div style={S.modalInfoValue}>
                    {fmtDateTime(alertData.createdAt)}
                  </div>
                </div>
                <div style={S.modalInfoItem}>
                  <div style={S.modalInfoLabel}>Incident ID</div>
                  <div style={S.modalInfoValue}>
                    {alertData.busPlate
                      ? `${alertData.busPlate} · ${alertData.id}`
                      : alertData.id || "Not available"}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={S.modalInfoLabel}>Details</div>
                <div style={S.modalInfoValue}>{alertData.message}</div>
              </div>
            </div>

            <div style={S.modalFooter}>
              <button
                type="button"
                style={S.modalSecondaryBtn}
                onClick={() => setShowAlertModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- styles ---------- */

const styles = {
  page: {
    display: "grid",
    gap: 16,
    maxWidth: 1120,
    margin: "0 auto",
    padding: "0 16px 24px",
  },

  /* QUICK OVERVIEW CARDS */
  overviewGrid: {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  overviewCard: {
    background: "var(--card)",
    borderRadius: 20,
    border: "1px solid var(--line)",
    padding: 14,
    boxShadow: "0 14px 30px rgba(15,23,42,0.04)",
  },
  overviewLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.08,
    color: "#9CA3AF",
    marginBottom: 4,
  },
  overviewValue: {
    fontSize: 22,
    fontWeight: 800,
    color: "#0D658B",
  },
  overviewValueSm: {
    fontSize: 18,
    fontWeight: 700,
    color: "#0D658B",
  },
  overviewSub: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 4,
  },

  topMetaRow: {
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 4,
    gap: 12,
    flexWrap: "wrap",
  },
  livePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid #FCA5A5",
    background: "#FEF2F2",
    color: "#B91C1C",
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: "999px",
    background: "#EF4444",
    boxShadow: "0 0 0 3px rgba(239,68,68,0.35)",
  },
  liveCount: {
    fontSize: 12,
    color: "#7F1D1D",
  },

  card: {
    background: "var(--card)",
    border: "1px solid var(--line)",
    borderRadius: 24,
    padding: 20,
    boxShadow: "0 20px 45px rgba(15,23,42,0.06)",
    marginTop: 4,
  },

  muted: { color: "#6B7280", fontSize: 14 },

  flash: (type) => ({
    padding: "10px 14px",
    borderRadius: 10,
    fontSize: 14,
    marginTop: 8,
    color: type === "error" ? "#B91C1C" : "#166534",
    background: type === "error" ? "#FEE2E2" : "#DCFCE7",
    border: type === "error" ? "1px solid #FCA5A5" : "1px solid #86EFAC",
  }),

  emptyState: {
    padding: "24px 12px",
    textAlign: "center",
  },

  incidentList: {
    display: "grid",
    gap: 10,
    marginTop: 10,
  },

  incidentCard: {
    border: "1px solid #E2E8F0",
    borderRadius: 24,
    padding: 18,
    background: "#FFFFFF",
    boxShadow: "0 18px 40px rgba(15,23,42,0.05)",
  },

  incidentHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  incidentTitleCol: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  incidentLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.08,
    color: "#9CA3AF",
  },
  incidentTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "#0D658B",
  },
  incidentRightCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
  },
  incidentTime: {
    fontSize: 12,
    color: "#6B7280",
  },

  infoGrid: {
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 24,
  },
  infoSectionHeader: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.08,
    color: "#9CA3AF",
    marginBottom: 4,
  },
  infoRow: {
    display: "flex",
    gap: 12,
    fontSize: 13,
    marginTop: 4,
  },
  infoLabel: {
    width: 110,
    color: "#6B7280",
  },
  infoValue: {
    color: "#111827",
    fontWeight: 500,
  },

  incidentFooter: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 14,
  },
  resolveBtn: {
    borderRadius: 999,
    border: "none",
    background: "#B91C1C",
    color: "#F9FAFB",
    padding: "8px 16px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600,
  },

  // severity pills
  sevLow: {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.08,
    background: "#ECFDF3",
    color: "#166534",
    border: "1px solid #86EFAC",
  },
  sevMedium: {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.08,
    background: "#FEF9C3",
    color: "#854D0E",
    border: "1px solid #FACC15",
  },
  sevHigh: {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.08,
    background: "#FEF2F2",
    color: "#B91C1C",
    border: "1px solid #FCA5A5",
  },
  sevUnknown: {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.08,
    background: "#E5E7EB",
    color: "#374151",
    border: "1px solid #CBD5F5",
  },

  /* bottom grid: timeline + trends + drivers */
  bottomGrid: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)",
    gap: 12,
  },

  sectionHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0F172A",
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#6B7280",
  },

  timelineCard: {
    background: "var(--card)",
    borderRadius: 24,
    border: "1px solid var(--line)",
    padding: 16,
    boxShadow: "0 18px 40px rgba(15,23,42,0.04)",
    minHeight: 180,
  },
  emptySmall: {
    padding: "12px 4px",
  },
  timelineList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "grid",
    gap: 8,
  },
  timelineItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  timelineLeft: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 6,
    background: "#0EA5E9",
    boxShadow: "0 0 0 3px rgba(14,165,233,0.25)",
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#0D658B",
  },
  timelineMeta: {
    fontSize: 12,
    color: "#6B7280",
  },
  timelineRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
  },
  timelineTime: {
    fontSize: 12,
    color: "#6B7280",
  },

  rightColumn: {
    display: "grid",
    gap: 12,
    gridTemplateRows: "minmax(0, auto) minmax(0, auto)",
  },

  trendCard: {
    background: "var(--card)",
    borderRadius: 24,
    border: "1px solid var(--line)",
    padding: 16,
    boxShadow: "0 18px 40px rgba(15,23,42,0.04)",
  },
  trendChart: {
    marginTop: 8,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 120,
  },
  trendBarGroup: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  trendBarOuter: {
    width: "100%",
    borderRadius: 999,
    background: "#E5E7EB",
    height: 80,
    display: "flex",
    alignItems: "flex-end",
    overflow: "hidden",
  },
  trendBarInner: {
    width: "100%",
    borderRadius: 999,
    background:
      "linear-gradient(to top, rgba(14,165,233,1), rgba(59,130,246,1))",
    transition: "height 0.3s ease-out",
  },
  trendBarLabel: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: 4,
  },
  trendBarCount: {
    fontSize: 11,
    color: "#0F172A",
  },

  driverCard: {
    background: "var(--card)",
    borderRadius: 24,
    border: "1px solid var(--line)",
    padding: 16,
    boxShadow: "0 18px 40px rgba(15,23,42,0.04)",
  },
  driverContent: {
    display: "grid",
    gap: 10,
  },
  driverHighlight: {
    padding: 10,
    borderRadius: 16,
    background: "#ECFEFF",
    border: "1px solid #67E8F9",
  },
  driverHighlightSecondary: {
    padding: 10,
    borderRadius: 16,
    background: "#EEF2FF",
    border: "1px solid #A5B4FC",
  },
  driverHighlightLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.08,
    color: "#6B7280",
    marginBottom: 2,
  },
  driverHighlightName: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0F172A",
  },
  driverHighlightMeta: {
    fontSize: 12,
    color: "#4B5563",
    marginTop: 2,
  },
  driverTable: {
    marginTop: 4,
    borderTop: "1px solid #E5E7EB",
    paddingTop: 6,
    display: "grid",
    gap: 4,
  },
  driverRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
  },
  driverRowName: {
    fontWeight: 500,
    color: "#111827",
  },
  driverRowStats: {
    color: "#6B7280",
    display: "flex",
    gap: 4,
  },

  /* modal styles */
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: "16px",
  },
  modal: {
    width: "100%",
    maxWidth: 440,
    background: "#FFFFFF",
    borderRadius: 24,
    boxShadow: "0 25px 60px rgba(15,23,42,0.35)",
    padding: 20,
    border: "1px solid #E5E7EB",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  modalBadge: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.12,
    padding: "4px 10px",
    borderRadius: 999,
    background: "#FEF2F2",
    color: "#B91C1C",
    border: "1px solid #FCA5A5",
  },
  modalClose: {
    border: "none",
    background: "transparent",
    fontSize: 20,
    lineHeight: 1,
    cursor: "pointer",
    color: "#4B5563",
  },
  modalBody: {
    marginTop: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#0D658B",
    marginBottom: 4,
  },
  modalMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  modalTime: {
    fontSize: 12,
    color: "#6B7280",
  },
  modalInfoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14,
    marginTop: 4,
  },
  modalInfoItem: {},
  modalInfoLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.08,
    color: "#9CA3AF",
    marginBottom: 2,
  },
  modalInfoValue: {
    fontSize: 13,
    fontWeight: 500,
    color: "#111827",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 16,
    gap: 8,
  },
  modalSecondaryBtn: {
    borderRadius: 999,
    border: "1px solid #CBD5F5",
    background: "#F9FAFB",
    color: "#111827",
    padding: "8px 16px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 500,
  },

  mapLink: {
    fontSize: 13,
    fontWeight: 500,
    color: "#0D658B",
    textDecoration: "underline",
    cursor: "pointer",
    wordBreak: "break-word",
  },
};

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { listIotDevices, listIotStatusReports } from "@/lib/api";

/* ---------------- helpers ---------------- */
function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function badgeStyle(kind) {
  const up = String(kind || "").toUpperCase();

  const good = {
    background: "var(--success-bg, rgba(16,185,129,0.10))",
    color: "var(--success, #047857)",
    borderColor: "var(--success-border, rgba(16,185,129,0.35))",
  };
  const warn = {
    background: "var(--warning-bg, rgba(245,158,11,0.10))",
    color: "var(--warning, #92400E)",
    borderColor: "var(--warning-border, rgba(245,158,11,0.35))",
  };
  const bad = {
    background: "var(--danger-bg, rgba(239,68,68,0.10))",
    color: "var(--danger, #B91C1C)",
    borderColor: "var(--danger-border, rgba(239,68,68,0.35))",
  };
  const info = {
    background: "var(--info-bg, rgba(59,130,246,0.10))",
    color: "var(--info, #1D4ED8)",
    borderColor: "var(--info-border, rgba(59,130,246,0.35))",
  };
  const neutral = {
    background: "rgba(148,163,184,0.10)",
    color: "var(--muted, #64748B)",
    borderColor: "rgba(148,163,184,0.30)",
  };

  if (["WORKING", "ONLINE", "RESOLVED"].includes(up)) return good;
  if (["NEEDS_MAINTENANCE", "MAINTENANCE", "IN_PROGRESS"].includes(up))
    return warn;
  if (["NOT_WORKING", "OFFLINE"].includes(up)) return bad;
  if (["PENDING", "OPEN", "ACTIVE", "ONGOING"].includes(up)) return info;

  return neutral;
}

/* =========================================================
   PAGE
========================================================= */
export default function MonitoringPage() {
  const S = styles;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [devices, setDevices] = useState([]);
  const [reports, setReports] = useState([]);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState("NEWEST");

  async function load() {
    try {
      setLoading(true);
      setErr("");

      // ✅ use the shared API wrapper (adds Authorization header)
      const [devItems, repItems] = await Promise.all([
        listIotDevices(),
        listIotStatusReports(),
      ]);

      setDevices(Array.isArray(devItems) ? devItems : []);
      setReports(Array.isArray(repItems) ? repItems : []);
    } catch (e) {
      console.error("[IoT Monitoring] load error:", e);
      setErr(e?.message || "Failed to load IoT monitoring data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const items = useMemo(() => {
    const devItems = (devices || []).map((d) => {
      const dt = d.lastSeen || d.updatedAt || d.createdAt || null;

      return {
        type: "DEVICE",
        key: `dev:${d.deviceId || d.id}`,
        title: d.deviceName || `IoT ${d.deviceId || d.id || "Device"}`,
        meta: `Bus ${d.busNumber || "—"} · ${d.busPlate || "—"}`,
        date: dt,
        badge: String(d.status || "UNKNOWN").toUpperCase(),

        deviceId: d.deviceId || d.id || "—",
        busNumber: d.busNumber || "—",
        busPlate: d.busPlate || "—",
        driverName: d.driverName || "—",
        network: d.network || "—",
      };
    });

    const repItems = (reports || []).map((r) => {
      const dt = r.createdAt || r.reportedAt || null;
      const condition = r.condition || r.issueType || "—";

      return {
        type: "REPORT",
        key: `rep:${r.id}`,
        title: r.driverName || "Driver report",
        meta: `Bus ${r.busNumber || "—"} · ${r.busPlate || "—"} · Device ${
          r.deviceId || "—"
        }`,
        date: dt,
        badge: String(r.status || r.reportStatus || "PENDING").toUpperCase(),

        deviceId: r.deviceId || "—",
        busNumber: r.busNumber || "—",
        busPlate: r.busPlate || "—",
        driverName: r.driverName || "—",
        condition,
        notes: r.description || r.message || "—",
      };
    });

    const all = [...devItems, ...repItems];

    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? all.filter((x) => {
          const hay = [
            x.title,
            x.meta,
            x.deviceId,
            x.busNumber,
            x.busPlate,
            x.driverName,
            x.condition,
            x.notes,
            x.badge,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(needle);
        })
      : all;

    filtered.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return sort === "NEWEST" ? tb - ta : ta - tb;
    });

    return filtered;
  }, [devices, reports, q, sort]);

  return (
    <div style={S.page}>
      <div>
        <h1 style={S.pageTitle}>IoT monitoring</h1>
        <p style={S.pageSub}>
          Monitor device availability and driver-submitted IoT status.
        </p>
      </div>

      {err && <div style={S.errorBox}>{err}</div>}

      <section style={S.container}>
        <div style={S.containerHeader}>
          <div style={S.containerTitle}>IoT list</div>

          <div style={S.controlsRow}>
            <div style={S.searchWrap}>
              <input
                style={S.search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by device, bus, plate, driver, status..."
              />
            </div>

            <select
              style={S.select}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="NEWEST">Newest to oldest</option>
              <option value="OLDEST">Oldest to newest</option>
            </select>

            <button style={S.refreshBtn} onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div style={S.list}>
          {!loading && items.length === 0 ? (
            <div style={S.empty}>No items found</div>
          ) : (
            items.map((x) => (
              <article key={x.key} style={S.card}>
                <div style={S.cardTop}>
                  <div style={S.cardLeft}>
                    <div style={S.cardTitle}>{x.title}</div>
                    <div style={S.cardMeta}>{x.meta}</div>
                  </div>

                  <div style={S.cardRight}>
                    <span style={S.cardDate}>{formatDate(x.date)}</span>
                    <span style={{ ...S.badge, ...badgeStyle(x.badge) }}>
                      {x.badge}
                    </span>
                  </div>
                </div>

                <div style={S.grid}>
                  {x.type === "DEVICE" ? (
                    <>
                      <div>
                        <div style={S.groupLabel}>DEVICE</div>

                        <div style={S.row}>
                          <span style={S.label}>Device ID</span>
                          <span style={S.value}>{x.deviceId}</span>
                        </div>

                        <div style={S.row}>
                          <span style={S.label}>Last seen</span>
                          <span style={S.value}>{formatDateTime(x.date)}</span>
                        </div>

                        <div style={S.row}>
                          <span style={S.label}>Network</span>
                          <span style={S.value}>{x.network}</span>
                        </div>
                      </div>

                      <div>
                        <div style={S.groupLabel}>BUS & DRIVER</div>

                        <div style={S.row}>
                          <span style={S.label}>Bus number</span>
                          <span style={S.value}>{x.busNumber}</span>
                        </div>

                        <div style={S.row}>
                          <span style={S.label}>Plate</span>
                          <span style={S.value}>{x.busPlate}</span>
                        </div>

                        <div style={S.row}>
                          <span style={S.label}>Driver</span>
                          <span style={S.value}>{x.driverName}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div style={S.groupLabel}>REPORT</div>

                        <div style={S.row}>
                          <span style={S.label}>Condition</span>
                          <span style={S.value}>{x.condition}</span>
                        </div>

                        <div style={S.row}>
                          <span style={S.label}>Device</span>
                          <span style={S.value}>{x.deviceId}</span>
                        </div>

                        <div style={S.row}>
                          <span style={S.label}>Driver</span>
                          <span style={S.value}>{x.driverName}</span>
                        </div>
                      </div>

                      <div>
                        <div style={S.groupLabel}>BUS</div>

                        <div style={S.row}>
                          <span style={S.label}>Bus number</span>
                          <span style={S.value}>{x.busNumber}</span>
                        </div>

                        <div style={S.row}>
                          <span style={S.label}>Plate</span>
                          <span style={S.value}>{x.busPlate}</span>
                        </div>

                        <div style={S.row}>
                          <span style={S.label}>Notes</span>
                          <span style={S.value}>{x.notes}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------------- styles (theme-matching) ---------------- */
const styles = {
  page: {
    maxWidth: 1120,
    margin: "0 auto",
    padding: "0 16px 24px",
    display: "grid",
    gap: 14,
    color: "var(--text)",
  },

  pageTitle: { margin: 0, fontSize: 24, fontWeight: 800 },
  pageSub: { margin: "6px 0 0", color: "var(--muted)" },

  errorBox: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(239,68,68,0.10)",
    border: "1px solid rgba(239,68,68,0.35)",
    color: "var(--danger, #B91C1C)",
    fontSize: 13,
  },

  container: {
    background: "var(--card)",
    borderRadius: 24,
    border: "1px solid var(--line)",
    boxShadow: "0 20px 55px rgba(15,23,42,0.06)",
    padding: 18,
  },

  containerHeader: { display: "grid", gap: 12, marginBottom: 8 },
  containerTitle: { fontSize: 18, fontWeight: 800 },

  controlsRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },

  searchWrap: { flex: 1, minWidth: 280 },
  search: {
    width: "100%",
    height: 40,
    borderRadius: 999,
    border: "1px solid var(--line)",
    background: "transparent",
    padding: "0 14px",
    outline: "none",
    fontSize: 13,
    color: "var(--text)",
  },

  select: {
    height: 40,
    borderRadius: 999,
    border: "1px solid var(--line)",
    padding: "0 12px",
    fontSize: 13,
    background: "transparent",
    color: "var(--text)",
  },

  refreshBtn: {
    height: 40,
    borderRadius: 999,
    border: "1px solid var(--line)",
    padding: "0 14px",
    background: "transparent",
    color: "var(--text)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },

  list: {
    marginTop: 10,
    display: "grid",
    gap: 12,
    maxHeight: 560,
    overflowY: "auto",
    paddingRight: 6,
  },

  empty: {
    padding: 40,
    textAlign: "center",
    color: "var(--muted)",
    fontWeight: 600,
  },

  card: {
    border: "1px solid var(--line)",
    borderRadius: 20,
    padding: 16,
    background: "transparent",
  },

  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },

  cardLeft: { display: "grid", gap: 4 },
  cardTitle: { fontWeight: 800, fontSize: 16 },
  cardMeta: { fontSize: 12, color: "var(--muted)" },

  cardRight: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  cardDate: { fontSize: 12, color: "var(--muted)" },

  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    border: "1px solid transparent",
  },

  grid: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 36,
  },

  groupLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: "var(--muted)",
    letterSpacing: 0.08,
    textTransform: "uppercase",
  },

  row: {
    display: "flex",
    gap: 14,
    marginTop: 6,
    alignItems: "flex-start",
  },
  label: { width: 120, color: "var(--muted)", fontSize: 13 },
  value: {
    flex: 1,
    color: "var(--text)",
    fontWeight: 700,
    fontSize: 13,
    overflowWrap: "anywhere",
  },
};

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  listIotDevices,
  listIotStatusReports,
  updateIotStatusReport,
} from "@/lib/api";

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

  if (["WORKING", "ONLINE", "OK"].includes(up)) return good;
  if (["NEEDS_MAINTENANCE", "MAINTENANCE", "IN_PROGRESS"].includes(up)) return warn;
  if (["NOT_WORKING", "OFFLINE"].includes(up)) return bad;
  if (["PENDING", "OPEN", "ACTIVE", "ONGOING"].includes(up)) return info;
  if (["RESOLVED", "DONE", "CLOSED"].includes(up)) return good;

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

  // edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editAdminStatus, setEditAdminStatus] = useState("PENDING");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setErr("");

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

  function openEdit(report) {
    setEditId(report.id);
    setEditAdminStatus(String(report.adminStatus || "PENDING").toUpperCase());
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editId) return;
    try {
      setSaving(true);
      await updateIotStatusReport(editId, editAdminStatus);
      setEditOpen(false);
      setEditId(null);
      await load();
    } catch (e) {
      console.error("[IoT Monitoring] update error:", e);
      setErr(e?.message || "Failed to update report.");
    } finally {
      setSaving(false);
    }
  }

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

      // NOTE: "DEVICE-0002" comes from r.deviceId (or fallback to bus.deviceId if your API provides it)
      return {
        type: "REPORT",
        key: `rep:${r.id}`,
        id: r.id,

        title: r.driverName || "Driver report",
        meta: `Bus ${r.busNumber || "—"} · ${r.busPlate || "—"} · Device ${
          r.deviceId || "—"
        }`,
        date: dt,

        // main condition badge = driver status
        badge: String(r.status || "PENDING").toUpperCase(),

        // admin side status (pending/resolved etc)
        adminStatus: String(r.adminStatus || "PENDING").toUpperCase(),

        deviceId: r.deviceId || "—",
        busNumber: r.busNumber || "—",
        busPlate: r.busPlate || "—",
        driverName: r.driverName || "—",
      };
    });

    const all = [...repItems, ...devItems]; // show reports first

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
            x.badge,
            x.adminStatus,
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

                    {/* main status badge */}
                    <span style={{ ...S.badge, ...badgeStyle(x.badge) }}>
                      {x.badge}
                    </span>

                    {/* admin status badge + edit button only for reports */}
                    {x.type === "REPORT" && (
                      <>
                        <span style={{ ...S.badge, ...badgeStyle(x.adminStatus) }}>
                          {x.adminStatus}
                        </span>
                        <button
                          style={S.editBtn}
                          onClick={() => openEdit(x)}
                          title="Update admin status"
                        >
                          Edit
                        </button>
                      </>
                    )}
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
                          <span style={S.value}>{x.badge}</span>
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

                        {/* ✅ removed NOTES */}
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* ---------------- Edit Modal ---------------- */}
      {editOpen && (
        <div style={S.modalOverlay} onMouseDown={() => !saving && setEditOpen(false)}>
          <div style={S.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>Update report status</div>
            <div style={S.modalSub}>Set admin status (e.g., PENDING / RESOLVED).</div>

            <div style={{ marginTop: 12 }}>
              <div style={S.groupLabel}>ADMIN STATUS</div>
              <select
                style={{ ...S.select, width: "100%", marginTop: 8 }}
                value={editAdminStatus}
                onChange={(e) => setEditAdminStatus(e.target.value)}
                disabled={saving}
              >
                <option value="PENDING">PENDING</option>
                <option value="NEEDS_CHECK">NEEDS_CHECK</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="OK">OK</option>
              </select>
            </div>

            <div style={S.modalActions}>
              <button
                style={S.cancelBtn}
                onClick={() => setEditOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button style={S.saveBtn} onClick={saveEdit} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- styles ---------------- */
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

  editBtn: {
    height: 30,
    borderRadius: 999,
    border: "1px solid var(--line)",
    padding: "0 10px",
    background: "transparent",
    color: "var(--text)",
    fontSize: 12,
    fontWeight: 800,
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

  // modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,0.45)",
    display: "grid",
    placeItems: "center",
    padding: 16,
    zIndex: 50,
  },
  modal: {
    width: "100%",
    maxWidth: 420,
    background: "var(--card)",
    border: "1px solid var(--line)",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 30px 70px rgba(2,6,23,0.35)",
  },
  modalTitle: { fontSize: 16, fontWeight: 900 },
  modalSub: { marginTop: 6, color: "var(--muted)", fontSize: 13 },
  modalActions: {
    marginTop: 16,
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  cancelBtn: {
    height: 40,
    borderRadius: 12,
    border: "1px solid var(--line)",
    padding: "0 14px",
    background: "transparent",
    fontWeight: 800,
    cursor: "pointer",
  },
  saveBtn: {
    height: 40,
    borderRadius: 12,
    border: "1px solid var(--line)",
    padding: "0 14px",
    background: "rgba(59,130,246,0.12)",
    fontWeight: 900,
    cursor: "pointer",
  },
};

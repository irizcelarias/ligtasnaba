// apps/web-admin/src/app/(protected)/trips/page.js
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Poppins } from "next/font/google";
import { listTrips } from "@/lib/api";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// ---------- helpers ----------
function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatTimeRange(start, end) {
  if (!start) return "—";
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (Number.isNaN(s.getTime())) return "—";
  const opts = { hour: "2-digit", minute: "2-digit" };
  const startStr = s.toLocaleTimeString(undefined, opts);
  if (!e || Number.isNaN(e.getTime())) return `${startStr} – Ongoing`;
  const endStr = e.toLocaleTimeString(undefined, opts);
  return `${startStr} – ${endStr}`;
}

function formatDuration(start, end) {
  if (!start || !end) return "—";
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const diffMs = e.getTime() - s.getTime();
  if (diffMs <= 0) return "—";
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes} mins`;
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  if (mins === 0) return `${hours} hr${hours > 1 ? "s" : ""}`;
  return `${hours}h ${mins}m`;
}

function formatStatus(status) {
  if (!status) return "—";
  const up = String(status).toUpperCase();
  if (up === "ONGOING") return "Ongoing";
  if (up === "COMPLETED") return "Completed";
  if (up === "CANCELLED") return "Cancelled";
  return up.charAt(0) + up.slice(1).toLowerCase();
}

function statusStyles(status) {
  const up = String(status || "").toUpperCase();
  if (up === "COMPLETED") {
    return {
      background: "rgba(16, 185, 129, 0.08)",
      color: "#047857",
      borderColor: "rgba(16, 185, 129, 0.45)",
    };
  }
  if (up === "ONGOING") {
    return {
      background: "rgba(59, 130, 246, 0.08)",
      color: "#1D4ED8",
      borderColor: "rgba(59, 130, 246, 0.45)",
    };
  }
  if (up === "CANCELLED") {
    return {
      background: "rgba(239, 68, 68, 0.08)",
      color: "#B91C1C",
      borderColor: "rgba(239, 68, 68, 0.4)",
    };
  }
  return {
    background: "rgba(148,163,184,0.08)",
    color: "#4B5563",
    borderColor: "rgba(148,163,184,0.4)",
  };
}

const PAGE_SIZE = 5;

export default function TripHistoryPage() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("newest"); // "newest" | "oldest"
  const [page, setPage] = useState(1);

  const S = styles;

  async function loadTrips() {
    try {
      setLoading(true);
      setErrorMsg("");

      const res = await listTrips();
      const items = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res)
        ? res
        : [];

      // Filter out ongoing trips
      const completedTrips = items.filter((trip) => {
        const status = (trip.status || "").toUpperCase();
        return status === "COMPLETED"; // Only include completed trips
      });

      setTrips(completedTrips);
      setPage(1);
    } catch (err) {
      console.error("LOAD TRIPS ERROR:", err);
      setErrorMsg(err?.message || "Failed to load trip history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTrips();
  }, []);

  // reset page when search/sort changes
  useEffect(() => {
    setPage(1);
  }, [search, sortOrder]);

  const normalizedSearch = search.trim().toLowerCase();

  // search
  const searched = useMemo(() => {
    if (!normalizedSearch) return trips;
    return trips.filter((trip) => {
      const driverLabel =
        trip.driverName ||
        (trip.driverProfile && trip.driverProfile.fullName) ||
        "Unknown driver";
      const busLabel =
        trip.busNumber || (trip.bus && trip.bus.number) || "";
      const plateLabel =
        trip.busPlate || (trip.bus && trip.bus.plate) || "";
      const startingPoint = trip.originLabel || "";
      const destination = trip.destLabel || "";
      const statusLabel = formatStatus(trip.status);
      const dateLabel = formatDate(trip.startedAt);

      const target = [
        driverLabel,
        busLabel,
        plateLabel,
        startingPoint,
        destination,
        statusLabel,
        dateLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return target.includes(normalizedSearch);
    });
  }, [normalizedSearch, trips]);

  // sort by date (newest/oldest)
  const sorted = useMemo(() => {
    const arr = [...searched];
    return arr.sort((a, b) => {
      const aDate = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bDate = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return sortOrder === "newest" ? bDate - aDate : aDate - bDate;
    });
  }, [searched, sortOrder]);

  // pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div className={poppins.className} style={S.page}>
      {/* Header (same vibe as Feedback) */}
      <div>
        <h1 style={S.title}>Trip history</h1>
        <p style={S.sub}>
          Monitor completed trips across all drivers and buses.
        </p>
      </div>

      {/* Main card */}
      <section style={S.card}>
        <div style={S.cardHeader}>
          <div style={S.cardTitle}>Trip list</div>

          {/* Search + sort toolbar (same layout as Feedback) */}
          <div style={S.toolbar}>
            <div style={S.searchWrapper}>
              <input
                style={S.searchInput}
                placeholder="Search by driver, bus, plate, starting point, destination, status…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div style={S.toolbarRight}>
              <select
                style={S.sortSelect}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              >
                <option value="newest">Newest to oldest</option>
                <option value="oldest">Oldest to newest</option>
              </select>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div style={S.errorBox}>
            {errorMsg}
          </div>
        )}

        {/* List / empty / loading */}
        {loading && trips.length === 0 ? (
          <div style={S.emptyWrapper}>
            <div style={S.emptyTitle}>Loading trips…</div>
          </div>
        ) : pageItems.length === 0 ? (
          <div style={S.emptyWrapper}>
            <div style={S.emptyTitle}>No trips found</div>
            <div style={S.emptySub}>
              Completed trips will appear here once drivers finish their rides.
            </div>
          </div>
        ) : (
          <>
            <div style={S.list}>
              {pageItems.map((trip) => {
                const driverLabel =
                  trip.driverName ||
                  (trip.driverProfile && trip.driverProfile.fullName) ||
                  "Unknown driver";
                const busLabel =
                  trip.busNumber || (trip.bus && trip.bus.number) || "—";
                const plateLabel =
                  trip.busPlate || (trip.bus && trip.bus.plate) || "";
                const startingPoint = trip.originLabel || "—";
                const destination = trip.destLabel || "—";
                const dateText = formatDate(trip.startedAt);
                const statusLabel = formatStatus(trip.status);
                const timeText = formatTimeRange(
                  trip.startedAt,
                  trip.endedAt
                );
                const durationText = formatDuration(
                  trip.startedAt,
                  trip.endedAt
                );

                return (
                  <article key={trip.id} style={S.item}>
                    <div style={S.itemMain}>
                      {/* Top row: driver, bus, date, status badge */}
                      <div style={S.itemHeaderRow}>
                        <div style={S.itemTitleRow}>
                          <span style={S.itemTitle}>{driverLabel}</span>
                          <span style={S.itemMeta}>
                            Bus {busLabel}
                            {plateLabel ? ` · ${plateLabel}` : ""}
                          </span>
                        </div>

                        <div style={S.itemHeaderRight}>
                          <span style={S.itemDate}>{dateText}</span>
                          <span
                            style={{
                              ...S.statusBadge,
                              ...statusStyles(trip.status),
                            }}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </div>

                      {/* Info grid – similar to feedback layout */}
                      <div style={S.infoGrid}>
                        <div>
                          <div style={S.sectionHeader}>ROUTE</div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>From</span>
                            <span style={S.infoValue}>{startingPoint}</span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>To</span>
                            <span style={S.infoValue}>{destination}</span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Time</span>
                            <span style={S.infoValue}>{timeText}</span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Duration</span>
                            <span style={S.infoValue}>{durationText}</span>
                          </div>
                        </div>

                        <div>
                          <div style={S.sectionHeader}>BUS & DRIVER</div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Bus number</span>
                            <span style={S.infoValue}>{busLabel}</span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Plate</span>
                            <span style={S.infoValue}>
                              {plateLabel || "—"}
                            </span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Driver</span>
                            <span style={S.infoValue}>{driverLabel}</span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Status</span>
                            <span style={S.infoValue}>{statusLabel}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Pagination */}
            <div style={S.paginationBottom}>
              <button
                type="button"
                style={S.pageCircleBtn}
                disabled={currentPage === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              <span style={S.paginationLabel}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                style={S.pageCircleBtn}
                disabled={currentPage === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                ›
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------- styles (mirrored from Feedback page) ----------
const styles = {
  page: {
    display: "grid",
    gap: 16,
    maxWidth: 1120,
    margin: "0 auto",
    padding: "0 16px 24px",
  },
  title: { fontSize: 22, fontWeight: 800, margin: 0 },
  sub: { margin: "6px 0 0", color: "var(--muted)" },

  card: {
    background: "var(--card)",
    borderRadius: 24,
    border: "1px solid var(--line)",
    padding: 20,
    boxShadow: "0 20px 45px rgba(15,23,42,0.06)",
  },
  cardHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBottom: 10,
  },
  cardTitle: {
    fontWeight: 700,
    fontSize: 18,
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
    flexWrap: "wrap",
  },
  searchWrapper: { flex: 1, minWidth: 220 },
  searchInput: {
    width: "100%",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,.45)",
    padding: "8px 12px",
    fontSize: 13,
    outline: "none",
    background: "#F9FBFF",
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  sortSelect: {
    borderRadius: 999,
    border: "1px solid #D4DBE7",
    padding: "8px 12px",
    fontSize: 13,
    background: "#FFFFFF",
    color: "var(--text)",
    outline: "none",
  },

  errorBox: {
    marginTop: 8,
    marginBottom: 8,
    padding: "8px 12px",
    borderRadius: 8,
    fontSize: 13,
    background: "rgba(239,68,68,.08)",
    color: "#b91c1c",
    border: "1px solid rgba(248,113,113,.7)",
  },

  emptyWrapper: {
    height: 200,
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    color: "#9CA3AF",
    fontSize: 13,
  },
  emptyTitle: { fontWeight: 600 },
  emptySub: { marginTop: 4 },

  list: {
    display: "grid",
    gap: 10,
    maxHeight: 420,
    overflowY: "auto",
    paddingRight: 4,
  },

  item: {
    border: "1px solid #E2E8F0",
    borderRadius: 24,
    padding: 20,
    background: "#FFFFFF",
    boxShadow: "0 18px 40px rgba(15,23,42,0.05)",
  },
  itemMain: { display: "grid", gap: 10 },

  itemHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  itemTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  itemTitle: { fontWeight: 800, fontSize: 16, color: "#0D658B" },
  itemMeta: {
    fontSize: 12,
    color: "#6B7280",
  },
  itemHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  itemDate: {
    fontSize: 12,
    color: "#6B7280",
  },
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    border: "1px solid transparent",
  },

  infoGrid: {
    marginTop: 6,
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 40,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.08,
    textTransform: "uppercase",
    color: "#9CA3AF",
    marginBottom: 6,
  },
  infoRow: {
    display: "flex",
    gap: 16,
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
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },

  paginationBottom: {
    marginTop: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 14,
  },
  paginationLabel: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: 500,
  },
  pageCircleBtn: {
    width: 30,
    height: 30,
    borderRadius: "999px",
    border: "1px solid #E5E7EB",
    background: "#FFFFFF",
    color: "#4B5563",
    cursor: "pointer",
    fontSize: 16,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
};

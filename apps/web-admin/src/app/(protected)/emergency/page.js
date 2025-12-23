// apps/web-admin/src/app/(protected)/emergencys/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { listEmergencies, listIncidents } from "@/lib/api";
import { X as XIcon } from "lucide-react";
import { Poppins } from "next/font/google";

/* ---------- FONT ---------- */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

/* ===========================
   Helpers (shared)
=========================== */

function todayInput() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

function inRange(createdAt, from, to) {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return false;
  if (from && d < from) return false;
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    if (d > end) return false;
  }
  return true;
}

function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const v = String(cell ?? "");
          if (v.includes(",") || v.includes('"') || v.includes("\n")) {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return v;
        })
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Emergency helpers */
function getSeverity(e) {
  const sev = (e.severity || "").toString().trim();
  if (sev) return sev;

  const code = (e.code || "").toString().toUpperCase();
  if (code === "YELLOW") return "Minor";
  if (code === "ORANGE") return "Moderate";
  if (code === "RED") return "High";
  return "Not specified";
}

function getLocationText(e) {
  if (e.locationText) return e.locationText;

  const lat = e.latitude ?? e.lat ?? null;
  const lng = e.longitude ?? e.lng ?? null;

  if (lat != null && lng != null) return `${lat}, ${lng}`;
  return "";
}

/* small field */
function ModalField({ label, value }) {
  return (
    <div style={S.fieldGroup}>
      <label style={S.fieldLabel}>{label}</label>
      <input style={S.fieldInput} value={value ?? "—"} readOnly />
    </div>
  );
}

/* ===========================
   Page (2 tabs)
=========================== */

export default function ReportsTabsPage() {
  const [tab, setTab] = useState("EMERGENCY"); // EMERGENCY | INCIDENT

  return (
    <div className={poppins.className} style={S.page}>
      {/* Header + Tabs (underline style) */}
      <div style={S.headerBlock}>
        <h1 style={S.title}>Reports</h1>
        <p style={S.sub}>
          View history of resolved emergency alerts and incident reports.
        </p>

        <div style={S.tabsRow}>
          <button
            type="button"
            onClick={() => setTab("EMERGENCY")}
            style={S.textTab(tab === "EMERGENCY")}
          >
            Emergency Reports
          </button>

          <button
            type="button"
            onClick={() => setTab("INCIDENT")}
            style={S.textTab(tab === "INCIDENT")}
          >
            Incident Reports
          </button>
        </div>
        <div style={S.tabsLine} />
      </div>

      {tab === "EMERGENCY" ? <EmergencyReportsTab /> : <IncidentReportsTab />}
    </div>
  );
}

/* ===========================
   TAB 1: Emergency Reports
=========================== */

function EmergencyReportsTab() {
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState({ type: "", text: "" });

  const [items, setItems] = useState([]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState(null);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const maxDate = todayInput();

  function showFlash(type, text) {
    setFlash({ type, text });
    setTimeout(() => setFlash({ type: "", text: "" }), 1600);
  }

  async function loadEmergencies() {
    try {
      setLoading(true);
      const res = await listEmergencies();

      const raw = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res)
        ? res
        : [];

      // Reports tab = history (exclude active/pending)
      const history = raw.filter((e) => {
        const st = (e.status || "").toString().toUpperCase();
        if (st === "PENDING" || st === "ACTIVE" || st === "OPEN" || st === "ONGOING")
          return false;
        if (!st && e.resolvedAt) return true;
        return !!st || !!e.resolvedAt;
      });

      setItems(history);
      setPage(1);
    } catch (err) {
      console.error("LOAD EMERGENCIES (reports) ERROR:", err);
      showFlash("error", err.message || "Failed to load emergency reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmergencies();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate, search]);

  function onFromChange(value) {
    if (value && value > maxDate) return;
    setFromDate(value);
  }
  function onToChange(value) {
    if (value && value > maxDate) return;
    setToDate(value);
  }

  const normalizedSearch = search.trim().toLowerCase();
  const fromObj = parseDate(fromDate);
  const toObj = parseDate(toDate);

  const filtered = useMemo(() => {
    let list = items;

    if (fromObj || toObj) {
      list = list.filter((item) => inRange(item.createdAt, fromObj, toObj));
    }

    if (normalizedSearch) {
      list = list.filter((e) => {
        const locationText = getLocationText(e);
        const target = [
          e.driverName,
          e.busNumber,
          e.deviceId,
          e.status,
          getSeverity(e),
          e.code,
          e.message,
          locationText,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return target.includes(normalizedSearch);
      });
    }

    return [...list].sort((a, b) => {
      const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bd - ad;
    });
  }, [items, normalizedSearch, fromObj, toObj]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  function resetFilters() {
    setFromDate("");
    setToDate("");
    setSearch("");
  }

  function exportExcel() {
    if (!filtered.length) {
      showFlash("error", "No emergency reports to export.");
      return;
    }

    const header = [
      "Emergency ID",
      "Device ID",
      "Bus Number",
      "Driver",
      "Status",
      "Severity",
      "Code",
      "Triggered At",
      "Resolved At",
      "Location",
      "Message",
    ];

    const rows = filtered.map((e) => {
      const locationText = getLocationText(e);
      return [
        e.id || "",
        e.deviceId || "",
        e.busNumber || "",
        e.driverName || "",
        e.status || "",
        getSeverity(e) || "",
        e.code || "",
        e.createdAt ? new Date(e.createdAt).toLocaleString() : "",
        e.resolvedAt ? new Date(e.resolvedAt).toLocaleString() : "",
        locationText || "",
        (e.message || "").replace(/\r?\n/g, " "),
      ];
    });

    downloadCsv("emergency-reports.csv", header, rows);
  }

  return (
    <>
      {/* Filters */}
      <section style={S.card}>
        <div style={S.filterRow}>
          <div style={S.searchWrapper}>
            <input
              style={S.searchInput}
              placeholder="Search by bus, device ID, driver, severity, code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={S.filterField}>
            <div style={S.filterLabel}>From</div>
            <input
              type="date"
              max={maxDate}
              value={fromDate}
              onChange={(e) => onFromChange(e.target.value)}
              style={S.dateInput}
            />
          </div>

          <div style={S.filterField}>
            <div style={S.filterLabel}>To</div>
            <input
              type="date"
              max={maxDate}
              value={toDate}
              onChange={(e) => onToChange(e.target.value)}
              style={S.dateInput}
            />
          </div>

          <button type="button" onClick={resetFilters} style={S.resetBtn}>
            Reset
          </button>

          <button type="button" style={S.exportBtn} onClick={exportExcel}>
            Export CSV
          </button>
        </div>
      </section>

      {/* List */}
      <section style={S.listCard}>
        {flash.text && (
          <div aria-live="polite" role="status" style={S.flash(flash.type)}>
            {flash.text}
          </div>
        )}

        {loading && items.length === 0 ? (
          <div style={S.emptyWrapper}>
            <div style={S.emptyTitle}>Loading emergency reports…</div>
          </div>
        ) : pageItems.length === 0 ? (
          <div style={S.emptyWrapper}>
            <div style={S.emptyTitle}>No emergency reports found</div>
            <div style={S.emptySub}>Try different filters.</div>
          </div>
        ) : (
          <>
            <div style={S.list}>
              {pageItems.map((e) => {
                const locationText = getLocationText(e);

                return (
                  <article key={e.id} style={S.item}>
                    <div style={S.itemMain}>
                      <div style={S.itemHeaderRow}>
                        <div style={S.itemTitleRow}>
                          <span style={S.itemTitle}>
                            Bus {e.busNumber || "—"}
                          </span>
                          {e.deviceId && (
                            <span style={S.deviceTag}>Device {e.deviceId}</span>
                          )}
                        </div>

                        <div style={S.statusPill(e.status || "RESOLVED")}>
                          {e.status || "RESOLVED"}
                        </div>
                      </div>

                      <div style={S.infoGrid}>
                        <div>
                          <div style={S.sectionHeader}>EMERGENCY INFO</div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Driver</span>
                            <span style={S.infoValue}>
                              {e.driverName || "Unknown driver"}
                            </span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Severity</span>
                            <span style={S.infoValue}>{getSeverity(e)}</span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Code</span>
                            <span style={S.infoValue}>{e.code || "—"}</span>
                          </div>
                        </div>

                        <div>
                          <div style={S.sectionHeader}>TIMELINE & LOCATION</div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Triggered at</span>
                            <span style={S.infoValue}>
                              {e.createdAt
                                ? new Date(e.createdAt).toLocaleString()
                                : "—"}
                            </span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Resolved at</span>
                            <span style={S.infoValue}>
                              {e.resolvedAt
                                ? new Date(e.resolvedAt).toLocaleString()
                                : "—"}
                            </span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Location</span>
                            <span style={S.infoValue}>
                              {locationText || "No location recorded."}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={S.cardFooter}>
                      <button
                        type="button"
                        style={S.viewBtn}
                        onClick={() => setSelected(e)}
                      >
                        View details
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

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

      {/* Modal */}
      {selected && (
        <div style={S.modalBackdrop}>
          <div style={S.modal}>
            <div style={S.modalHeader}>
              <div style={S.modalTitle}>Emergency Details</div>
              <button
                type="button"
                style={S.modalClose}
                onClick={() => setSelected(null)}
              >
                <XIcon size={16} />
              </button>
            </div>

            <div style={S.modalBody}>
              <div style={S.modalFormGrid}>
                <div style={S.formColumn}>
                  <ModalField label="Bus" value={selected.busNumber || "—"} />
                  <ModalField
                    label="Driver"
                    value={selected.driverName || "Unknown driver"}
                  />
                  <ModalField label="Device ID" value={selected.deviceId || "—"} />
                </div>

                <div style={S.formColumn}>
                  <ModalField label="Status" value={selected.status || "RESOLVED"} />
                  <ModalField label="Severity" value={getSeverity(selected)} />
                  <ModalField label="Code" value={selected.code || "—"} />
                </div>
              </div>

              <div style={S.noteGroup}>
                <label style={S.fieldLabel}>Timeline</label>
                <textarea
                  readOnly
                  style={S.fieldTextarea}
                  value={
                    [
                      selected.createdAt
                        ? `Triggered at: ${new Date(selected.createdAt).toLocaleString()}`
                        : null,
                      selected.resolvedAt
                        ? `Resolved at: ${new Date(selected.resolvedAt).toLocaleString()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join("\n") || "No timestamps recorded."
                  }
                />
              </div>

              <div style={S.noteGroup}>
                <label style={S.fieldLabel}>Message</label>
                <textarea
                  readOnly
                  style={S.fieldTextarea}
                  value={
                    selected.message?.trim()
                      ? selected.message
                      : "No additional description provided."
                  }
                />
              </div>

              <div style={S.noteGroup}>
                <label style={S.fieldLabel}>Location</label>
                <textarea
                  readOnly
                  style={S.fieldTextarea}
                  value={getLocationText(selected) || "No location recorded."}
                />
              </div>

              <div style={S.modalActions}>
                <button
                  type="button"
                  style={S.modalCancel}
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ===========================
   TAB 2: Incident Reports (view-only)
=========================== */

function IncidentReportsTab() {
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState({ type: "", text: "" });

  const [incidents, setIncidents] = useState([]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const maxDate = todayInput();

  function showFlash(type, text) {
    setFlash({ type, text });
    setTimeout(() => setFlash({ type: "", text: "" }), 1600);
  }

  async function loadIncidents() {
    try {
      setLoading(true);
      const res = await listIncidents();
      const items = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res)
        ? res
        : [];
      setIncidents(items);
      setPage(1);
    } catch (err) {
      console.error("LOAD INCIDENTS ERROR:", err);
      showFlash("error", err.message || "Failed to load incidents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIncidents();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate, search]);

  function onFromChange(value) {
    if (value && value > maxDate) return;
    setFromDate(value);
  }
  function onToChange(value) {
    if (value && value > maxDate) return;
    setToDate(value);
  }

  const normalizedSearch = search.trim().toLowerCase();
  const fromObj = parseDate(fromDate);
  const toObj = parseDate(toDate);

  const filtered = useMemo(() => {
    let list = incidents;

    if (fromObj || toObj) {
      list = list.filter((item) => inRange(item.createdAt, fromObj, toObj));
    }

    if (normalizedSearch) {
      list = list.filter((i) => {
        const categoriesText = Array.isArray(i.categories)
          ? i.categories
              .map((c) => (c && (c.name || c)) || "")
              .filter(Boolean)
              .join(" ")
          : "";

        const target = [
          i.driverName,
          i.busNumber,
          i.status,
          i.note,
          i.reporterName,
          categoriesText,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return target.includes(normalizedSearch);
      });
    }

    return [...list].sort((a, b) => {
      const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bd - ad;
    });
  }, [incidents, normalizedSearch, fromObj, toObj]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  function resetFilters() {
    setFromDate("");
    setToDate("");
    setSearch("");
  }

  function exportExcel() {
    if (!filtered.length) {
      showFlash("error", "No incident reports to export.");
      return;
    }

    const header = [
      "Report ID",
      "Driver",
      "Bus Number",
      "Reporter",
      "Status",
      "Categories",
      "Created At",
      "Note",
    ];

    const rows = filtered.map((i) => {
      const categoriesText =
        Array.isArray(i.categories) && i.categories.length > 0
          ? i.categories
              .map((c) => (c && (c.name || c)) || "")
              .filter(Boolean)
              .join(" / ")
          : "";

      return [
        i.id || "",
        i.driverName || "",
        i.busNumber || "",
        i.reporterName || "",
        i.status || "",
        categoriesText,
        i.createdAt ? new Date(i.createdAt).toLocaleString() : "",
        (i.note || "").replace(/\r?\n/g, " "),
      ];
    });

    downloadCsv("incident-reports.csv", header, rows);
  }

  return (
    <>
      <section style={S.card}>
        <div style={S.filterRow}>
          <div style={S.searchWrapper}>
            <input
              style={S.searchInput}
              placeholder="Search incidents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={S.filterField}>
            <div style={S.filterLabel}>From</div>
            <input
              type="date"
              max={maxDate}
              value={fromDate}
              onChange={(e) => onFromChange(e.target.value)}
              style={S.dateInput}
            />
          </div>

          <div style={S.filterField}>
            <div style={S.filterLabel}>To</div>
            <input
              type="date"
              max={maxDate}
              value={toDate}
              onChange={(e) => onToChange(e.target.value)}
              style={S.dateInput}
            />
          </div>

          <button type="button" onClick={resetFilters} style={S.resetBtn}>
            Reset
          </button>

          <button type="button" style={S.exportBtn} onClick={exportExcel}>
            Export CSV
          </button>
        </div>
      </section>

      <section style={S.listCard}>
        {flash.text && (
          <div aria-live="polite" role="status" style={S.flash(flash.type)}>
            {flash.text}
          </div>
        )}

        {loading && incidents.length === 0 ? (
          <div style={S.emptyWrapper}>
            <div style={S.emptyTitle}>Loading incident reports…</div>
          </div>
        ) : pageItems.length === 0 ? (
          <div style={S.emptyWrapper}>
            <div style={S.emptyTitle}>No incident reports found</div>
            <div style={S.emptySub}>Try different filters.</div>
          </div>
        ) : (
          <>
            <div style={S.list}>
              {pageItems.map((r) => {
                const categoriesText =
                  Array.isArray(r.categories) && r.categories.length > 0
                    ? r.categories
                        .map((c) => (c && (c.name || c)) || "")
                        .filter(Boolean)
                        .join(" / ")
                    : "";

                return (
                  <article key={r.id} style={S.item}>
                    <div style={S.itemMain}>
                      <div style={S.itemHeaderRow}>
                        <div style={S.itemTitleRow}>
                          <span style={S.itemTitle}>
                            {r.driverName || "Unknown driver"}
                          </span>
                        </div>

                        <div style={S.statusPill(r.status || "PENDING")}>
                          {r.status || "PENDING"}
                        </div>
                      </div>

                      <div style={S.infoGrid}>
                        <div>
                          <div style={S.sectionHeader}>REPORT INFORMATION</div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Driver</span>
                            <span style={S.infoValue}>
                              {r.driverName || "Unknown driver"}
                            </span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Bus number</span>
                            <span style={S.infoValue}>{r.busNumber || "—"}</span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Reporter</span>
                            <span style={S.infoValue}>
                              {r.reporterName || "—"}
                            </span>
                          </div>
                        </div>

                        <div>
                          <div style={S.sectionHeader}>DETAILS</div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Filed at</span>
                            <span style={S.infoValue}>
                              {r.createdAt
                                ? new Date(r.createdAt).toLocaleString()
                                : "—"}
                            </span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Categories</span>
                            <span style={S.infoValue}>
                              {categoriesText || "None"}
                            </span>
                          </div>
                          <div style={S.infoRow}>
                            <span style={S.infoLabel}>Summary</span>
                            <span style={S.infoValue}>
                              {r.note && r.note.trim().length > 0
                                ? r.note
                                : "No note provided."}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

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
    </>
  );
}

/* ===========================
   Styles (shared)
=========================== */

const S = {
  page: {
    display: "grid",
    gap: 16,
    maxWidth: 1120,
    margin: "0 auto",
    padding: "0 16px 24px",
  },

  /* header + underline tabs */
  headerBlock: { display: "block" },
  title: { fontSize: 22, fontWeight: 800, margin: 0 },
  sub: { margin: "6px 0 0", color: "var(--muted)" },

  tabsRow: {
    display: "flex",
    alignItems: "center",
    gap: 22,
    marginTop: 10,
  },
  textTab: (active) => ({
    appearance: "none",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "10px 0",
    fontSize: 14,
    fontWeight: active ? 700 : 600,
    color: active ? "#0D658B" : "#6B7280",
    borderBottom: active ? "2px solid #0D658B" : "2px solid transparent",
  }),
  tabsLine: {
    width: "100%",
    height: 1,
    background: "#E5E7EB",
    marginTop: -1,
  },

  card: {
    background: "var(--card)",
    borderRadius: 16,
    border: "1px solid #9CA3AF",
    padding: 16,
  },
  filterRow: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr auto auto",
    gap: 10,
    alignItems: "end",
  },
  filterField: { display: "grid", gap: 4 },
  filterLabel: { fontSize: 12, color: "#6B7280", fontWeight: 600 },

  dateInput: {
    borderRadius: 8,
    border: "1px solid #D4DBE7",
    padding: "8px 10px",
    fontSize: 13,
    background: "#F9FBFF",
    color: "var(--text)",
    outline: "none",
  },
  searchWrapper: { width: "100%" },
  searchInput: {
    width: "100%",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,.45)",
    padding: "8px 12px",
    fontSize: 13,
    outline: "none",
    background: "#F9FBFF",
  },

  resetBtn: {
    borderRadius: 999,
    border: "1px solid #D4DBE7",
    padding: "8px 16px",
    fontSize: 13,
    background: "#FFFFFF",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  exportBtn: {
    borderRadius: 999,
    border: "1px solid #0D658B",
    padding: "8px 18px",
    fontSize: 13,
    background: "#FFFFFF",
    color: "#0D658B",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontWeight: 600,
  },

  listCard: {
    background: "var(--card)",
    borderRadius: 24,
    border: "1px solid var(--line)",
    padding: 20,
    minHeight: 260,
    boxShadow: "0 20px 45px rgba(15,23,42,0.06)",
  },

  flash: (type) => ({
    marginBottom: 8,
    padding: "8px 12px",
    borderRadius: 10,
    fontSize: 13,
    background:
      type === "error" ? "rgba(239,68,68,.08)" : "rgba(34,197,94,.08)",
    color: type === "error" ? "#b91c1c" : "#166534",
    border:
      type === "error"
        ? "1px solid rgba(248,113,113,.7)"
        : "1px solid rgba(74,222,128,.7)",
  }),

  emptyWrapper: {
    height: 240,
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
    maxHeight: 360,
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

  deviceTag: {
    padding: "3px 9px",
    borderRadius: 999,
    border: "1px solid #BFDBFE",
    background: "#EFF6FF",
    fontSize: 11,
    color: "#1D4ED8",
    fontWeight: 500,
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
  infoRow: { display: "flex", gap: 16, fontSize: 13, marginTop: 4 },
  infoLabel: { width: 110, color: "#6B7280" },
  infoValue: { color: "#111827", fontWeight: 500 },

  cardFooter: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 14,
  },
  viewBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 999,
    border: "1px solid #CBD5F5",
    background: "#FFFFFF",
    color: "#0F172A",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 500,
  },

  statusPill: (status) => {
    const s = (status || "PENDING").toUpperCase();
    let bg = "#E5E7EB";
    let border = "#CBD5F5";
    let color = "#4B5563";

    if (s === "PENDING") {
      bg = "#FEF3C7";
      border = "#FBBF24";
      color = "#92400E";
    } else if (s === "RESOLVED" || s === "CLOSED") {
      bg = "#E8F9F0";
      border = "#86EFAC";
      color = "#166534";
    } else if (s === "ACTIVE" || s === "OPEN" || s === "ONGOING") {
      bg = "#FEE2E2";
      border = "#FCA5A5";
      color = "#B91C1C";
    }

    return {
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      textTransform: "uppercase",
      background: bg,
      border: `1px solid ${border}`,
      color,
      whiteSpace: "nowrap",
    };
  },

  paginationBottom: {
    marginTop: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 14,
  },
  paginationLabel: { fontSize: 13, color: "#6B7280", fontWeight: 500 },
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

  /* modal */
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15,23,42,.45)",
    zIndex: 40,
  },
  modal: {
    width: "min(520px, 92vw)",
    borderRadius: 16,
    border: "1px solid rgba(203,213,225,.9)",
    background: "#ffffff",
    padding: 18,
    boxShadow: "0 20px 60px rgba(15,23,42,.28)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  modalTitle: { fontWeight: 700, fontSize: 16 },
  modalClose: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: 4,
    borderRadius: 999,
  },
  modalBody: {
    fontSize: 13,
    color: "#374151",
    display: "grid",
    gap: 12,
  },
  modalFormGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 16,
  },
  formColumn: { display: "grid", gap: 12 },

  fieldGroup: { display: "grid", gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: "#6B7280" },
  fieldInput: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid #E5E7EB",
    padding: "8px 10px",
    fontSize: 13,
    background: "#F9FAFB",
    color: "#111827",
    outline: "none",
  },
  fieldTextarea: {
    width: "100%",
    minHeight: 52,
    borderRadius: 10,
    border: "1px solid #E5E7EB",
    padding: "8px 10px",
    fontSize: 13,
    background: "#F9FAFB",
    color: "#111827",
    resize: "none",
    outline: "none",
  },
  noteGroup: { marginTop: 4, display: "grid", gap: 4 },

  modalActions: {
    marginTop: 8,
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalCancel: {
    borderRadius: 999,
    padding: "8px 16px",
    border: "1px solid #D4DBE7",
    background: "#FFFFFF",
    color: "#0F172A",
    cursor: "pointer",
    fontSize: 13,
  },
};

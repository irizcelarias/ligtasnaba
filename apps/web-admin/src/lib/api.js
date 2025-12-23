// apps/web-admin/src/lib/api.js
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API ||
  "http://localhost:4000";

/* ---------- AUTH ---------- */

export async function apiLogin({ email, password }) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(data.message || "Login failed");

  if (data.token) {
    localStorage.setItem("lc_token", data.token);
    localStorage.setItem(
      "lc_user",
      JSON.stringify({
        id: data.user?.id,
        email: data.user?.email || email,
        role: data.user?.role || data.role || "ADMIN",
      })
    );
  }

  return data;
}

export function apiLogout() {
  localStorage.removeItem("lc_token");
  localStorage.removeItem("lc_user");
}

export function authHeaders(extra = {}) {
  const token =
    (typeof window !== "undefined" && localStorage.getItem("lc_token")) || "";
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/* ---------- CORE REQUEST WRAPPER ---------- */

async function request(path, { method = "GET", headers, body } = {}) {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(headers || {}),
    },
    body: body && typeof body === "object" ? JSON.stringify(body) : body,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) apiLogout();
    const err = new Error(data.error || data.message || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return data;
}

export async function API(path, options = {}) {
  return request(path, options);
}

/* ---------- BUSES (ADMIN) ---------- */

export async function listBuses(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`/buses${qs ? `?${qs}` : ""}`);
}

export async function getBus(id) {
  return request(`/buses/${id}`);
}

export async function createBus(payload) {
  return request("/buses", {
    method: "POST",
    body: payload,
  });
}

export async function updateBus(id, payload) {
  return request(`/buses/${id}`, {
    method: "PUT",
    body: payload,
  });
}

export async function setBusStatus(id, status) {
  return updateBus(id, { status });
}

/* ---------- DRIVERS ---------- */

export async function listDrivers() {
  try {
    const data = await request("/admin/driver-profiles");
    return data?.items ?? [];
  } catch (err) {
    if (err.status === 404) {
      const data = await request("/admin/drivers");
      return Array.isArray(data?.items) ? data.items : data ?? [];
    }
    throw err;
  }
}

export async function getDriver(id) {
  try {
    return await request(`/admin/driver-profiles/${id}`);
  } catch (err) {
    if (err.status === 404) {
      return request(`/admin/drivers/${id}`);
    }
    throw err;
  }
}

export async function createDriver(payload) {
  try {
    return await request("/admin/driver-profiles", {
      method: "POST",
      body: payload,
    });
  } catch (err) {
    if (err.status !== 404) throw err;

    try {
      return await request("/admin/create-driver", {
        method: "POST",
        body: payload,
      });
    } catch (err2) {
      if (err2.status !== 404) throw err2;

      return request("/admin/drivers", {
        method: "POST",
        body: payload,
      });
    }
  }
}

export async function previewIdentifiers({ busNumber, plateNumber }) {
  return request("/admin/preview-identifiers", {
    method: "POST",
    body: { busNumber, plateNumber },
  });
}

export async function setDriverStatus({ driverId, status }) {
  try {
    return await request("/admin/driver-status", {
      method: "PATCH",
      body: { driverId, status },
    });
  } catch (err) {
    if (err.status === 404) {
      return request("/admin/drivers/status", {
        method: "PATCH",
        body: { driverId, status },
      });
    }
    throw err;
  }
}

/* ---------- FEEDBACK (ADMIN) ---------- */

export async function listFeedback(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/feedback${qs ? `?${qs}` : ""}`);
}

export async function getFeedback(id) {
  return request(`/admin/feedback/${id}`);
}

/* ---------- INCIDENTS (ADMIN) ---------- */

export async function listIncidents(params = {}) {
  const qs = new URLSearchParams(params).toString();

  try {
    return await request(`/admin/incidents${qs ? `?${qs}` : ""}`);
  } catch (err) {
    if (err.status === 404) {
      try {
        return await request(`/emergency-incidents${qs ? `?${qs}` : ""}`);
      } catch (err2) {
        if (err2.status === 404) return [];
        throw err2;
      }
    }
    throw err;
  }
}

export async function listEmergencies(params = {}) {
  const qs = new URLSearchParams(params).toString();

  try {
    const data = await request(`/iot/emergencies/history${qs ? `?${qs}` : ""}`);
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data)) return data;
    return [];
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  try {
    const data = await request(`/admin/emergencies${qs ? `?${qs}` : ""}`);
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data)) return data;
    return [];
  } catch (err2) {
    if (err2.status !== 404) throw err2;
  }

  try {
    const data2 = await request(`/emergency-incidents${qs ? `?${qs}` : ""}`);
    if (Array.isArray(data2?.items)) return data2.items;
    if (Array.isArray(data2)) return data2;
    return [];
  } catch (err3) {
    if (err3.status === 404) return [];
    throw err3;
  }
}

export async function listIotEmergencies(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const data = await request(`/iot/emergencies${qs ? `?${qs}` : ""}`);
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

/* ---------- ✅ IOT DEVICES + STATUS REPORTS (ADMIN MONITORING) ---------- */
/**
 * listIotDevices()
 * - used by web-admin monitoring page
 * - supports multiple possible backend paths
 * - always returns array
 */
export async function listIotDevices(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const pathsToTry = [
    `/admin/iot/devices${qs ? `?${qs}` : ""}`,
    `/iot/devices${qs ? `?${qs}` : ""}`,
    `/admin/devices${qs ? `?${qs}` : ""}`,
    `/devices${qs ? `?${qs}` : ""}`,
  ];

  let lastErr = null;

  for (const p of pathsToTry) {
    try {
      const data = await request(p);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
      if (Array.isArray(data?.devices)) return data.devices;
      return [];
    } catch (e) {
      lastErr = e;
      if (e?.status !== 404) throw e;
    }
  }

  if (lastErr && lastErr.status && lastErr.status !== 404) throw lastErr;
  return [];
}

/**
 * listIotStatusReports()
 * - driver submits: POST /driver/iot/report
 * - admin views here: GET /admin/iot/status-reports
 * - always returns array
 */
export async function listIotStatusReports(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const pathsToTry = [
    `/admin/iot/status-reports${qs ? `?${qs}` : ""}`,
    `/iot/status-reports${qs ? `?${qs}` : ""}`,
    `/admin/iot/reports${qs ? `?${qs}` : ""}`,
  ];

  let lastErr = null;

  for (const p of pathsToTry) {
    try {
      const data = await request(p);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
      return [];
    } catch (e) {
      lastErr = e;
      if (e?.status !== 404) throw e;
    }
  }

  if (lastErr && lastErr.status && lastErr.status !== 404) throw lastErr;
  return [];
}

/**
 * updateIotStatusReport(id, adminStatus)
 * - admin sets status: OK / PENDING / NEEDS_CHECK / RESOLVED etc.
 * - tries common paths
 */
export async function updateIotStatusReport(id, adminStatus) {
  const payload = { adminStatus };

  const pathsToTry = [
    `/admin/iot/status-reports/${id}`,
    `/iot/status-reports/${id}`,
    `/admin/iot/reports/${id}`,
  ];

  let lastErr = null;

  for (const p of pathsToTry) {
    try {
      return await request(p, {
        method: "PATCH",
        body: payload,
      });
    } catch (e) {
      lastErr = e;
      if (e?.status !== 404) throw e;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("Failed to update IoT status report (no matching route).");
}

/* ---------- TRIPS (ADMIN) ---------- */

export async function listTrips(params = {}) {
  const qs = new URLSearchParams(params).toString();

  try {
    const data = await request(`/admin/trips${qs ? `?${qs}` : ""}`);
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data)) return data;
    return [];
  } catch (err) {
    if (err.status === 404) {
      try {
        const data = await request(`/trips${qs ? `?${qs}` : ""}`);
        if (Array.isArray(data?.items)) return data.items;
        if (Array.isArray(data)) return data;
        return [];
      } catch (err2) {
        if (err2.status === 404) return [];
        throw err2;
      }
    }
    throw err;
  }
}

/* ---------- NOTIFICATIONS (ADMIN) ---------- */

export async function listNotifications(params = {}) {
  const qs = new URLSearchParams(params).toString();

  try {
    return await request(`/admin/notifications${qs ? `?${qs}` : ""}`);
  } catch (err) {
    if (err.status === 404) {
      try {
        return await request(`/notifications${qs ? `?${qs}` : ""}`);
      } catch (err2) {
        if (err2.status === 404) return [];
        throw err2;
      }
    }
    throw err;
  }
}

/* ---------- RESOLVE EMERGENCY (IOT) ---------- */

export async function resolveEmergency(id) {
  return request(`/iot/emergencies/${id}/resolve`, {
    method: "POST",
  });
}

// apps/mobile/screens/BusScanner.js
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Modal,
  StatusBar,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from "@expo-google-fonts/poppins";
import { API_URL } from "../constants/config";
import LCText from "../components/LCText";

const C = {
  bg: "#F3F4F6",
  card: "#FFFFFF",
  border: "#E5E7EB",
  text: "#111827",
  sub: "#6B7280",
  hint: "#9CA3AF",
  brand: "#0B132B",
  redDark: "#B91C1C",
  green: "#059669",
  amber: "#D97706",
};

const HEADER_H = 48;

async function getAuthToken() {
  const tokenKeys = [
    "authToken",
    "AUTH_TOKEN",
    "LC_COMMUTER_TOKEN",
    "token",
    "lc_user",
    "lc_token",
    "lc_admin",
    "LC_DRIVER_TOKEN",
    "driverToken",
  ];

  for (const key of tokenKeys) {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;

      console.log("[BusScanner] found something in AsyncStorage key =", key);

      const trimmed = String(raw).trim();

      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const obj = JSON.parse(trimmed);
          const candidate =
            obj.token || obj.jwt || obj.accessToken || obj.authToken;
          if (candidate) {
            console.log(
              "[BusScanner] using token from JSON under key =",
              key
            );
            return candidate;
          }
        } catch (err) {
          console.log(
            "[BusScanner] failed to parse JSON for key",
            key,
            err
          );
        }
      } else {
        console.log("[BusScanner] using raw token under key =", key);
        return trimmed;
      }
    } catch (err) {
      console.log("[BusScanner] error reading key", key, err);
    }
  }

  return null;
}

function prettyRouteLabel(forward, back, rawLabel) {
  if (rawLabel && String(rawLabel).trim()) return String(rawLabel).trim();

  const f = forward ? String(forward).trim() : "";
  const r = back ? String(back).trim() : "";

  if (!f && !r) return "—";
  if (f && !r) return f;
  if (!f && r) return r;

  const splitSegment = (seg) => {
    if (!seg) return [];
    if (seg.includes("→")) {
      return seg.split("→").map((s) => s.trim());
    }
    if (seg.includes("-")) {
      return seg.split("-").map((s) => s.trim());
    }
    return [seg.trim()];
  };

  const fParts = splitSegment(f);
  const rParts = splitSegment(r);

  if (fParts.length >= 2 && rParts.length >= 2) {
    const start = fParts[0];
    const mid = fParts[fParts.length - 1];
    const end = rParts[rParts.length - 1];

    if (start && mid && end) {
      return `${start} — ${mid} — ${end}`;
    }
  }

  return `${f} — ${r}`;
}

function prettyScanError(raw) {
  if (!raw) {
    return "We couldn’t read this QR code. Please try again.";
  }

  const lower = String(raw).toLowerCase();

  if (lower.includes("bus number missing")) {
    return "This QR code is missing the bus number. Please scan the official LigtasCommute QR sticker inside the registered bus.";
  }

  if (lower.includes("invalid qr") || lower.includes("qr is not a bus code")) {
    return "This QR code is not recognized by LigtasCommute. Please scan the bus QR provided by the system.";
  }

  if (lower.includes("bus is inactive") || lower.includes("inactive bus")) {
    return "This bus is currently marked as inactive in LigtasCommute. Please confirm the bus number or scan another bus.";
  }

  if (lower.includes("maintenance") || lower.includes("in maintenance")) {
    return "This bus is currently under maintenance and cannot be joined right now.";
  }

  if (lower.includes("unauthorized") || lower.includes("token")) {
    return "Your session expired. Please log in again and try scanning the bus QR once more.";
  }

  return raw;
}

function buildAvatarUrl(raw) {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  let base = API_URL.replace(/\/+$/, "");
  if (base.endsWith("/api")) base = base.slice(0, -4);

  return `${base}${raw.startsWith("/") ? raw : "/" + raw}`;
}

const busStatusLabel = (status) => {
  if (!status) return "—";
  const up = String(status).toUpperCase();
  if (up === "ACTIVE") return "Active";
  if (up === "IN_MAINTENANCE") return "In maintenance";
  if (up === "INACTIVE") return "Inactive";
  return status;
};

const busStatusColor = (status) => {
  if (!status) return C.sub;
  const up = String(status).toUpperCase();
  if (up === "ACTIVE") return C.green;
  if (up === "IN_MAINTENANCE") return C.amber;
  if (up === "INACTIVE") return C.redDark;
  return C.sub;
};

export default function BusScanner({ navigation }) {
  const insets = useSafeAreaInsets();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const [permission, requestPermission] = useCameraPermissions();
  const hasPermission = !!permission?.granted;

  const [scanning, setScanning] = useState(true);
  const scanLock = useRef(false);

  const [driver, setDriver] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [error, setError] = useState("");
  const [errorModalVisible, setErrorModalVisible] = useState(false);

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  const resetScan = useCallback(() => {
    scanLock.current = false;
    setScanning(true);
    setError("");
    setErrorModalVisible(false);
  }, []);

  const closeAndBack = useCallback(() => {
    setInfoOpen(false);
    setDriver(null);
    resetScan();
    navigation.goBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const corridorLabel = (c) => {
    if (!c) return "—";
    const up = String(c).toUpperCase();
    if (up === "EAST") return "EAST (via Oslob)";
    if (up === "WEST") return "WEST (via Barili)";
    return c;
  };

  const normalizeBusType = (out) => {
    const t =
      out.busType ??
      out.vehicleType ??
      out.bus?.type ??
      out.bus?.busType ??
      out.bus_type ??
      "";
    if (!t) return "—";
    if (String(t).toUpperCase() === "AIRCON") return "AIRCON";
    if (String(t).toUpperCase() === "NON_AIRCON") return "NON_AIRCON";
    return String(t);
  };

  const busTypeLabel = (t) => {
    if (!t) return "—";
    const up = String(t).toUpperCase();
    if (up === "AIRCON") return "Aircon";
    if (up === "NON_AIRCON") return "Non-aircon";
    return t;
  };

  const normalizeDriverFromApi = (out) => {
    const driverProfileId =
      out.driverProfileId ?? out.driverId ?? out.id ?? out.profileId ?? null;

    const busId = out.busId ?? out.bus?.id ?? null;

    const corridor =
      out.corridor ?? out.bus?.corridor ?? out.bus_corridor ?? null;

    const forwardRoute =
      out.forwardRoute ??
      out.bus?.forwardRoute ??
      out.routeForward ??
      out.route_forward ??
      null;

    const returnRoute =
      out.returnRoute ??
      out.bus?.returnRoute ??
      out.routeReturn ??
      out.route_return ??
      null;

    const routeLabel =
      out.routeLabel ??
      out.bus?.routeLabel ??
      out.bus?.route ??
      out.route ??
      null;

    // ----- DRIVER DUTY STATUS -----
    const dutyStatus =
      out.dutyStatus ??
      out.driverStatus ??
      out.onDutyStatus ??
      out.on_duty_status ??
      out.status ?? // backend sends driver status as `status`
      null;

    const onDuty =
      out.onDuty ??
      out.isOnDuty ??
      out.is_on_duty ??
      (dutyStatus === "ON_DUTY") ??
      false;

    const rawAvatar =
      out.driverAvatar ??
      out.profileUrl ??
      out.profile_url ??
      out.driver?.profileUrl ??
      out.driver?.profile_url ??
      null;

    const avatar = rawAvatar ? buildAvatarUrl(rawAvatar) : null;

    // ----- BUS STATUS (from backend) -----
    const rawBusStatus =
      out.busStatus ?? // <--- explicit from API
      out.bus_status ??
      out.bus_status_text ??
      out.bus?.status ??
      out.bus?.busStatus ??
      null;

    const rawBusIsActive =
      out.busIsActive ??
      out.bus_is_active ??
      out.isActive ??
      out.active ??
      out.bus?.isActive ??
      out.bus?.active ??
      null;

    let finalBusStatus = null;
    if (rawBusStatus) {
      const up = String(rawBusStatus).toUpperCase();
      if (["ACTIVE", "INACTIVE", "IN_MAINTENANCE"].includes(up)) {
        finalBusStatus = up;
      }
    }

    if (!finalBusStatus && typeof rawBusIsActive === "boolean") {
      finalBusStatus = rawBusIsActive ? "ACTIVE" : "INACTIVE";
    }

    const busIsActive = finalBusStatus === "ACTIVE" || rawBusIsActive === true;

    return {
      id: driverProfileId,
      driverProfileId,
      busId,

      name: out.name ?? out.fullName ?? out.driverName ?? "Unknown Driver",
      code:
        out.code ??
        out.driverCode ??
        out.driverId ??
        out.id ??
        out.empCode ??
        "N/A",

      busNumber: out.busNumber ?? out.bus?.number ?? out.bus_no ?? "—",
      plateNumber: out.plateNumber ?? out.bus?.plate ?? out.plate ?? "—",

      busType: normalizeBusType(out),
      vehicleType: normalizeBusType(out),

      corridor,
      forwardRoute,
      returnRoute,
      routeLabel,

      dutyStatus,
      status: dutyStatus,
      onDuty: !!onDuty,

      avatar,
      profileUrl: avatar,

      // ✅ bus status info
      busStatus: finalBusStatus, // "ACTIVE" | "INACTIVE" | "IN_MAINTENANCE" | null
      busIsActive,

      scannedAt: new Date(),
    };
  };

  const handlePayload = async (data) => {
    try {
      console.log("[BusScanner] scanned data =", data);

      let parsed = null;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        parsed = data;
      }

      setLoadingLookup(true);

      const token = await getAuthToken();

      if (!token) {
        setLoadingLookup(false);
        throw new Error(
          "No token found. Please log out and log in again in the commuter app."
        );
      }

      // ✅ CORRECT ENDPOINT
      const res = await fetch(`${API_URL}/commuter/scan-bus`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ payload: parsed }),
      });

      const out = await res.json().catch(() => ({}));
      setLoadingLookup(false);

      if (!res.ok) {
        console.log("[BusScanner] API ERROR:", out);
        throw new Error(out?.message || "Invalid QR code");
      }

      const obj = normalizeDriverFromApi(out);
      console.log("[BusScanner] Driver+Bus from API:", obj);

      setDriver(obj);
      setInfoOpen(true);
    } catch (err) {
      console.log("[BusScanner] handlePayload ERROR:", err?.message || err);

      const msg = prettyScanError(err?.message || "Scan failed. Try again.");
      setError(msg);
      setErrorModalVisible(true);

      scanLock.current = true;
      setScanning(false);
    }
  };

  const onBarcodeScanned = ({ data }) => {
    if (!scanning || scanLock.current || infoOpen) return;

    scanLock.current = true;
    setScanning(false);
    setError("");

    handlePayload(data);
  };

  const timeText = useMemo(() => {
    if (!driver?.scannedAt) return "";
    const d = driver.scannedAt;
    const date = d.toLocaleDateString();
    const time = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Scanned on ${date}, ${time}`;
  }, [driver]);

  const isOnDuty =
    !!driver?.onDuty || driver?.status === "ON_DUTY" || driver?.status === "ACTIVE";

  const routeLine = useMemo(() => {
    if (!driver) return "—";
    return prettyRouteLabel(
      driver.forwardRoute,
      driver.returnRoute,
      driver.routeLabel
    );
  }, [driver]);

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={[s.screen, s.center]}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (Platform.OS === "web") {
    return (
      <SafeAreaView style={[s.screen, s.center]}>
        <MaterialCommunityIcons name="web" size={34} color={C.hint} />
        <LCText variant="tiny" style={[s.hint, s.f400]}>
          Camera not available on web
        </LCText>
      </SafeAreaView>
    );
  }

  if (!permission) {
    return (
      <SafeAreaView style={[s.screen, s.center]}>
        <ActivityIndicator />
        <LCText variant="tiny" style={[s.hint, s.f400]}>
          Requesting camera permission…
        </LCText>
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={[s.screen, s.center]}>
        <LCText variant="tiny" style={[s.hint, s.f400]}>
          Camera permission required
        </LCText>
        <TouchableOpacity style={s.primaryBtn} onPress={requestPermission}>
          <LCText variant="label" style={[s.primaryBtnTxt, s.f600]}>
            Enable
          </LCText>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ✅ BLOCK START TRACKING WHEN BUS IS INACTIVE OR IN MAINTENANCE
  const startTrackingDisabled =
    driver?.busStatus === "INACTIVE" || driver?.busStatus === "IN_MAINTENANCE";

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View
        style={[
          s.topBar,
          { paddingTop: insets.top, height: HEADER_H + insets.top },
        ]}
      >
        <TouchableOpacity style={s.iconBtn} onPress={closeAndBack}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <LCText variant="label" style={[s.topTitle, s.f600]}>
          Scan Bus QR
        </LCText>
        <View style={{ width: 36 }} />
      </View>

      <View style={s.cameraWrap}>
        {scanning ? (
          <CameraView
            style={s.camera}
            onBarcodeScanned={onBarcodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            facing="back"
          />
        ) : (
          <View style={[s.camera, s.center]}>
            {loadingLookup ? (
              <>
                <ActivityIndicator />
                <LCText
                  variant="tiny"
                  style={[s.hint, s.f400, { marginTop: 8 }]}
                >
                  Looking up driver and bus…
                </LCText>
              </>
            ) : (
              <>
                <MaterialCommunityIcons
                  name="qrcode-scan"
                  size={34}
                  color={C.hint}
                />
                <LCText
                  variant="tiny"
                  style={[
                    s.hint,
                    s.f400,
                    { marginTop: 8, textAlign: "center" },
                  ]}
                >
                  {errorModalVisible ? "" : error || "Processing…"}
                </LCText>
              </>
            )}
          </View>
        )}

        <View pointerEvents="none" style={s.overlay}>
          <View style={s.frame} />
          <LCText variant="tiny" style={[s.overlayHint, s.f400]}>
            Align QR inside the frame
          </LCText>
        </View>
      </View>

      <View style={[s.actionsRow, { paddingBottom: 14 + insets.bottom }]}>
        <TouchableOpacity style={s.secondaryBtn} onPress={resetScan}>
          <MaterialCommunityIcons name="reload" size={18} color={C.brand} />
          <LCText variant="label" style={[s.secondaryBtnTxt, s.f600]}>
            Rescan
          </LCText>
        </TouchableOpacity>
      </View>

      {/* INFO MODAL */}
      <Modal
        visible={infoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setInfoOpen(false);
          resetScan();
        }}
      >
        <View style={s.modalBg} />
        <View style={s.infoCardWrap}>
          <View style={s.infoCard}>
            <View style={s.infoHeader}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flex: 1,
                }}
              >
                <View style={s.avatarCircle}>
                  {driver?.profileUrl ? (
                    <Image
                      source={{ uri: driver.profileUrl }}
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: 19,
                      }}
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="account"
                      size={22}
                      color={C.brand}
                    />
                  )}
                </View>
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <LCText variant="label" style={[s.infoTitle, s.f600]}>
                      {driver?.name ?? "Unknown Driver"}
                    </LCText>
                    <View
                      style={[
                        s.statusPill,
                        {
                          marginLeft: 8,
                          backgroundColor: isOnDuty ? "#DCFCE7" : "#F3F4F6",
                          borderColor: isOnDuty ? "#22C55E" : C.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          s.statusDot,
                          { backgroundColor: isOnDuty ? C.green : C.hint },
                        ]}
                      />
                      <LCText
                        variant="tiny"
                        style={[
                          s.statusPillTxt,
                          s.f600,
                          { color: isOnDuty ? C.green : C.sub },
                        ]}
                      >
                        {isOnDuty ? "On duty" : "Off duty"}
                      </LCText>
                    </View>
                  </View>

                  {!!timeText && (
                    <LCText variant="tiny" style={[s.infoSub, s.f400]}>
                      {timeText}
                    </LCText>
                  )}
                </View>
              </View>

              <TouchableOpacity
                onPress={() => {
                  setInfoOpen(false);
                  resetScan();
                }}
              >
                <MaterialCommunityIcons name="close" size={20} color={C.text} />
              </TouchableOpacity>
            </View>

            {/* ASSIGNED BUS */}
            <View style={[s.infoBox, { marginTop: 14 }]}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <MaterialCommunityIcons
                  name="bus-side"
                  size={20}
                  color={C.brand}
                />
                <LCText
                  variant="label"
                  style={[s.sectionTitle, s.f600, { marginLeft: 6 }]}
                >
                  Assigned Bus
                </LCText>
              </View>

              <View style={{ marginTop: 8 }}>
                <LCText variant="tiny" style={[s.label, s.f400]}>
                  Bus Number
                </LCText>
                <LCText variant="label" style={[s.value, s.f600]}>
                  {driver?.busNumber ?? "—"}
                </LCText>
              </View>

              <View style={{ marginTop: 8 }}>
                <LCText variant="tiny" style={[s.label, s.f400]}>
                  Plate Number
                </LCText>
                <LCText variant="label" style={[s.value, s.f600]}>
                  {driver?.plateNumber ?? "—"}
                </LCText>
              </View>

              <View style={{ marginTop: 8 }}>
                <LCText variant="tiny" style={[s.label, s.f400]}>
                  Bus Type
                </LCText>
                <LCText variant="label" style={[s.value, s.f600]}>
                  {busTypeLabel(driver?.busType) ?? "—"}
                </LCText>
              </View>
            </View>

            {/* ROUTE & CORRIDOR */}
            <View style={[s.infoBox, { marginTop: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <MaterialCommunityIcons
                  name="map-marker-path"
                  size={20}
                  color={C.brand}
                />
                <LCText
                  variant="label"
                  style={[s.sectionTitle, s.f600, { marginLeft: 6 }]}
                >
                  Route & Corridor
                </LCText>
              </View>

              <View style={{ marginTop: 8 }}>
                <LCText variant="tiny" style={[s.label, s.f400]}>
                  Corridor
                </LCText>
                <LCText variant="label" style={[s.value, s.f600]}>
                  {corridorLabel(driver?.corridor)}
                </LCText>
              </View>

              <View style={{ marginTop: 8 }}>
                <LCText variant="tiny" style={[s.label, s.f400]}>
                  Route
                </LCText>
                <LCText variant="label" style={[s.value, s.f600]}>
                  {routeLine}
                </LCText>
              </View>
            </View>

            {/* WARNINGS */}
            {driver?.busStatus === "INACTIVE" && (
              <View style={s.busWarningBox}>
                <MaterialCommunityIcons
                  name="bus-alert"
                  size={18}
                  color={C.redDark}
                  style={{ marginRight: 6 }}
                />
                <LCText variant="tiny" style={[s.busWarningText, s.f400]}>
                  This bus is marked as{" "}
                  <LCText
                    variant="tiny"
                    style={{ fontWeight: "700", color: C.redDark }}
                  >
                    inactive
                  </LCText>{" "}
                  in LigtasCommute. Old QR stickers should no longer be used by
                  commuters.
                </LCText>
              </View>
            )}

            {driver?.busStatus === "IN_MAINTENANCE" && (
              <View style={s.busWarningBox}>
                <MaterialCommunityIcons
                  name="wrench"
                  size={18}
                  color={C.amber}
                  style={{ marginRight: 6 }}
                />
                <LCText variant="tiny" style={[s.busWarningText, s.f400]}>
                  This bus is currently{" "}
                  <LCText
                    variant="tiny"
                    style={{ fontWeight: "700", color: C.amber }}
                  >
                    under maintenance
                  </LCText>
                  . If commuters scan this QR, the app should show that the bus
                  is temporarily unavailable.
                </LCText>
              </View>
            )}

            {!isOnDuty && (
              <View style={s.offDutyBox}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={18}
                  color={C.redDark}
                  style={{ marginRight: 6 }}
                />
                <LCText variant="tiny" style={[s.offDutyText, s.f400]}>
                  This driver is currently marked as{" "}
                  <LCText
                    variant="tiny"
                    style={{ fontWeight: "700", color: C.redDark }}
                  >
                    Off duty
                  </LCText>
                  . Are you sure you want to start tracking?
                </LCText>
              </View>
            )}

            <TouchableOpacity
              style={[
                s.primaryBtn,
                { marginTop: 14, opacity: startTrackingDisabled ? 0.5 : 1 },
              ]}
              onPress={() => {
                if (startTrackingDisabled) return;
                setInfoOpen(false);
                navigation.navigate("MapTracking", {
                  driver,
                  busNumber: driver?.busNumber,
                  plateNumber: driver?.plateNumber,
                });
              }}
            >
              <LCText variant="label" style={[s.primaryBtnTxt, s.f600]}>
                {startTrackingDisabled
                  ? "Tracking unavailable for this bus"
                  : "Start Tracking"}
              </LCText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ERROR MODAL */}
      <Modal
        visible={errorModalVisible}
        transparent
        animationType="fade"
        onRequestClose={resetScan}
      >
        <View style={s.modalBg} />
        <View style={s.infoCardWrap}>
          <View style={s.errorCard}>
            <View style={s.errorIconCircle}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={26}
                color={C.redDark}
              />
            </View>
            <LCText variant="label" style={[s.errorTitle, s.f700]}>
              Invalid QR code
            </LCText>
            <LCText variant="tiny" style={[s.errorMsg, s.f400]}>
              {error}
            </LCText>
            <LCText variant="tiny" style={[s.errorHint, s.f400]}>
              Only scan QR codes from buses registered in LigtasCommute.
            </LCText>

            <TouchableOpacity
              style={[s.primaryBtn, { marginTop: 16 }]}
              onPress={resetScan}
            >
              <LCText variant="label" style={[s.primaryBtnTxt, s.f600]}>
                Scan again
              </LCText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  f400: { fontFamily: "Poppins_400Regular" },
  f600: { fontFamily: "Poppins_600SemiBold" },
  f700: { fontFamily: "Poppins_700Bold" },

  screen: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: "center", justifyContent: "center" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 8,
    justifyContent: "space-between",
    backgroundColor: C.bg,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: { fontSize: 12, color: C.text },

  cameraWrap: {
    flex: 1,
    margin: 12,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },
  camera: { flex: 1 },

  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 14,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.8)",
  },
  overlayHint: {
    marginTop: 14,
    color: "#fff",
    fontSize: 12,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 6,
  },

  actionsRow: { paddingHorizontal: 14 },

  secondaryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryBtnTxt: { color: C.brand, fontSize: 10 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.18)" },

  infoCardWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  infoCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },

  infoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#E0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  infoTitle: { fontSize: 12, color: C.text },
  infoSub: { color: C.sub, fontSize: 10, marginTop: 2 },

  infoBox: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#FAFAFA",
  },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 6,
  },
  statusPillTxt: {
    fontSize: 10,
  },

  sectionTitle: { fontSize: 12, color: C.text },

  label: { fontSize: 10, color: C.sub, marginTop: 2 },
  value: { fontSize: 10, color: C.text, marginTop: 2 },

  offDutyBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 12,
    paddingHorizontal: 4,
  },
  offDutyText: {
    flex: 1,
    fontSize: 10,
    color: C.redDark,
  },

  busWarningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 10,
    paddingHorizontal: 4,
  },
  busWarningText: {
    flex: 1,
    fontSize: 10,
    color: C.redDark,
  },

  primaryBtn: {
    backgroundColor: C.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    paddingHorizontal: 18,
  },
  primaryBtnTxt: { color: "#fff", fontSize: 10 },

  hint: { color: C.hint, fontSize: 11, marginTop: 4 },

  errorCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
  },
  errorIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "rgba(185,28,28,0.18)",
    backgroundColor: "rgba(248,113,113,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 12,
    color: C.redDark,
    marginTop: 4,
  },
  errorMsg: {
    fontSize: 11,
    color: C.text,
    textAlign: "center",
    marginTop: 8,
  },
  errorHint: {
    fontSize: 10,
    color: C.sub,
    textAlign: "center",
    marginTop: 6,
  },
});

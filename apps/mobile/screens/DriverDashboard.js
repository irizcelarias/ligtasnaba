/* eslint-disable react/no-unescaped-entities */
// apps/mobile/screens/DriverDashboard.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from "@expo-google-fonts/poppins";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "../constants/config";
import LCText from "../components/LCText";

const STORAGE_KEYS = {
  ratingLastSeen: "DRIVER_RATING_LAST_SEEN_COUNT",
  reportLastSeen: "DRIVER_REPORT_LAST_SEEN_COUNT",
  tripLastSeen: "DRIVER_TRIP_LAST_SEEN_COUNT",
};

const TRIP_HISTORY_KEY = "driverTrips";

const C = {
  bg: "#F3F4F6",
  card: "#FFFFFF",
  border: "#E5E7EB",
  text: "#111827",
  sub: "#6B7280",
  brand: "#0B132B",
  star: "#F59E0B",
  danger: "#B91C1C",
  success: "#10B981",
};

const QuickBox = ({
  icon,
  title,
  subtitle,
  variant = "default",
  onPress,
  badgeCount,
}) => {
  let bg = "#F9FAFB";
  let border = C.border;
  let iconColor = C.sub;
  let titleColor = C.text;
  let isPrimary = false;

  if (variant === "primary") {
    bg = C.brand;
    border = C.brand;
    iconColor = "#E5E7EB";
    titleColor = "#FFFFFF";
    isPrimary = true;
  } else if (variant === "danger") {
    bg = "#FEE2E2";
    border = "#FCA5A5";
    iconColor = "#B91C1C";
    titleColor = "#B91C1C";
  } else if (variant === "accent") {
    bg = "#DBEAFE";
    border = "#93C5FD";
    iconColor = "#1D4ED8";
    titleColor = "#1D4ED8";
  } else if (variant === "success") {
    bg = "#DCFCE7";
    border = "#6EE7B7";
    iconColor = "#047857";
    titleColor = "#047857";
  }

  const hasBadge = !!badgeCount && badgeCount > 0;

  return (
    <TouchableOpacity
      style={[
        styles.quickBox,
        { backgroundColor: bg, borderColor: border },
        isPrimary && styles.quickBoxPrimary,
      ]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      {hasBadge && (
        <View style={styles.badge}>
          <LCText style={styles.badgeText}>
            {badgeCount > 99 ? "99+" : badgeCount}
          </LCText>
        </View>
      )}

      <View
        style={[
          styles.quickBoxIconWrap,
          isPrimary && styles.quickBoxIconWrapPrimary,
        ]}
      >
        <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
      </View>

      <LCText
        style={[styles.quickBoxTitle, { color: titleColor }]}
        numberOfLines={1}
      >
        {title}
      </LCText>

      {!!subtitle && (
        <LCText style={styles.quickBoxSubtitle} numberOfLines={2}>
          {subtitle}
        </LCText>
      )}
    </TouchableOpacity>
  );
};

function buildLoopRouteLabel(forward, back) {
  if (!forward && !back) return null;

  const splitParts = (s) =>
    (s || "")
      .split(/→|->/g)
      .map((t) => t.trim())
      .filter(Boolean);

  const fParts = splitParts(forward);
  const rParts = splitParts(back);

  const start = fParts[0] || rParts[0] || null;
  const mid = fParts[1] || rParts[0] || null;
  const end =
    (rParts.length > 1 && rParts[rParts.length - 1]) || fParts[0] || null;

  const seq = [start, mid, end].filter(Boolean);

  if (!seq.length) return null;
  return seq.join(" → ");
}

function buildAbsoluteAvatarUrl(raw) {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = (API_URL || "").replace(/\/+$/, "");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${base}${path}`;
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export default function DriverDashboard({ navigation }) {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const [driver, setDriver] = useState({
    fullName: "Driver",
    avatar: null,
    email: "",
    phone: "",
  });
  const [driverId, setDriverId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [totalReports, setTotalReports] = useState(0);
  const [totalTrips, setTotalTrips] = useState(0);

  const [ratingUnread, setRatingUnread] = useState(0);
  const [reportUnread, setReportUnread] = useState(0);
  const [tripUnread, setTripUnread] = useState(0);

  const [refreshing, setRefreshing] = useState(false);

  const [isOnDuty, setIsOnDuty] = useState(false);
  const [dutyUpdating, setDutyUpdating] = useState(false);

  const [busInfo, setBusInfo] = useState({
    number: null,
    plate: null,
    routeLabel: null,
    presetDest: null,
  });

  const [currentTrip, setCurrentTrip] = useState(null);

  // ✅ IoT state (prevents crash)
  const [iot, setIot] = useState({
    status: "UNKNOWN", // ONLINE | OFFLINE | MAINTENANCE | UNKNOWN
    deviceId: null,
    lastSeenAt: null,
  });

  // ✅ Enhanced IoT modal UI state
  const [iotModalOpen, setIotModalOpen] = useState(false);
  const [iotSending, setIotSending] = useState(false);

  const openIotReportChoices = () => setIotModalOpen(true);
  const closeIotModal = () => setIotModalOpen(false);

  // ✅ submit IoT report to backend (with DEBUG)
const reportIotStatus = async (status) => {
  try {
    setIotSending(true);

    const token =
      (await AsyncStorage.getItem("driverToken")) ||
      (await AsyncStorage.getItem("token"));

    const url = `${API_URL}/driver/iot/report`;
    console.log("IOT REPORT URL:", url);
    console.log("IOT REPORT STATUS TO SEND:", status);
    console.log("IOT REPORT HAS TOKEN:", !!token);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ status }),
    });

    // ✅ read raw response first (so we can see server error text)
    const raw = await res.text();
    console.log("IOT REPORT HTTP STATUS:", res.status);
    console.log("IOT REPORT RAW BODY:", raw);

    // try parse JSON if possible
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      Alert.alert(
        "Error",
        data?.message ||
          data?.error ||
          `Failed to send IoT report. (HTTP ${res.status})`
      );
      return;
    }

    // ✅ Update label instantly (optional)
    setIot((prev) => ({
      ...prev,
      status:
        status === "WORKING"
          ? "ONLINE"
          : status === "NOT_WORKING"
          ? "OFFLINE"
          : "MAINTENANCE",
    }));

    setIotModalOpen(false);
    Alert.alert("Sent", "IoT report sent to admin.");
  } catch (e) {
    console.log("[DriverDashboard] reportIotStatus exception:", e);
    Alert.alert("Error", e?.message || "Failed to send IoT report.");
  } finally {
    setIotSending(false);
  }
};


  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const token =
        (await AsyncStorage.getItem("driverToken")) ||
        (await AsyncStorage.getItem("token"));

      const headers = {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      };

      try {
        const res = await fetch(`${API_URL}/driver/ratings`, { headers });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || "Failed to load ratings");
        }

        const avg = data.averageScore || 0;
        const total = data.totalRatings || 0;

        setAvgRating(avg);
        setTotalRatings(total);

        const stored = await AsyncStorage.getItem(STORAGE_KEYS.ratingLastSeen);
        const lastSeen = stored ? parseInt(stored, 10) || 0 : 0;
        setRatingUnread(Math.max(total - lastSeen, 0));
      } catch (e) {
        console.log("[DriverDashboard] load ratings error", e);
        setAvgRating(0);
        setTotalRatings(0);
        setRatingUnread(0);
      }

      try {
        const res = await fetch(`${API_URL}/driver/reports`, { headers });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || "Failed to load reports");
        }

        const list = Array.isArray(data.items) ? data.items : [];
        const total =
          typeof data.totalReports === "number"
            ? data.totalReports
            : list.length;

        setTotalReports(total);

        const stored = await AsyncStorage.getItem(STORAGE_KEYS.reportLastSeen);
        const lastSeen = stored ? parseInt(stored, 10) || 0 : 0;
        setReportUnread(Math.max(total - lastSeen, 0));
      } catch (e) {
        console.log("[DriverDashboard] load reports error", e);
        setTotalReports(0);
        setReportUnread(0);
      }

      try {
        const raw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        const total = Array.isArray(arr) ? arr.length : 0;

        setTotalTrips(total);

        const stored = await AsyncStorage.getItem(STORAGE_KEYS.tripLastSeen);
        const lastSeen = stored ? parseInt(stored, 10) || 0 : 0;
        setTripUnread(Math.max(total - lastSeen, 0));
      } catch (e) {
        console.log("[DriverDashboard] trip history load error", e);
        setTotalTrips(0);
        setTripUnread(0);
      }

      try {
        const r = await fetch(`${API_URL}/users/me`, { headers });
        if (!r.ok) {
          console.log("[DriverDashboard] /users/me not ok", r.status);
          throw new Error("Failed to load profile");
        }
        const profileData = await r.json().catch(() => ({}));

        const driverProfileFromUser =
          profileData.driver || profileData.driverProfile || {};

        let extraDriver = {};
        try {
          const r1 = await fetch(`${API_URL}/driver/profile`, { headers });
          if (r1.ok) {
            const js = await r1.json().catch(() => ({}));
            extraDriver = js?.data ?? js ?? {};
          }
        } catch {}
        if (!Object.keys(extraDriver || {}).length) {
          try {
            const r2 = await fetch(`${API_URL}/driver/me`, { headers });
            if (r2.ok) {
              const js = await r2.json().catch(() => ({}));
              extraDriver = js?.data ?? js ?? {};
            }
          } catch {}
        }

        const mergedDriver = {
          ...extraDriver,
          ...driverProfileFromUser,
        };

        const fullName =
          mergedDriver.fullName || profileData.fullName || "Driver";

        const rawAvatar =
          pick(mergedDriver, [
            "profileUrl",
            "avatarUrl",
            "photoUrl",
            "profile_url",
            "avatar_url",
          ]) ??
          pick(profileData, [
            "profileUrl",
            "avatarUrl",
            "photoUrl",
            "profile_url",
            "avatar_url",
          ]) ??
          null;

        const email = profileData.email || mergedDriver.email || "";
        const phone = profileData.phone || mergedDriver.phone || "";

        const avatar = buildAbsoluteAvatarUrl(rawAvatar);

        setDriver({ fullName, avatar, email, phone });

        setDriverId(
          driverProfileFromUser.driverId ||
            driverProfileFromUser.id ||
            mergedDriver.id ||
            profileData.id ||
            null
        );

        const rawStatus = (
          driverProfileFromUser.status ||
          mergedDriver.status ||
          ""
        ).toUpperCase();
        const onDutyFromApi =
          rawStatus === "ON_DUTY" || rawStatus === "ACTIVE";
        setIsOnDuty(onDutyFromApi);

        const bus = driverProfileFromUser.bus || profileData.bus || null;

        let number = null;
        let plate = null;
        let routeLabel = null;
        let presetDest = null;

        if (bus) {
          number = bus.number || bus.busNumber || null;
          plate = bus.plate || bus.plateNumber || null;

          routeLabel =
            bus.routeLabel ||
            bus.route ||
            buildLoopRouteLabel(bus.forwardRoute, bus.returnRoute);

          const rawLat =
            typeof bus.destLat === "number"
              ? bus.destLat
              : typeof bus.destLatitude === "number"
              ? bus.destLatitude
              : null;
          const rawLng =
            typeof bus.destLng === "number"
              ? bus.destLng
              : typeof bus.destLongitude === "number"
              ? bus.destLongitude
              : null;

          if (
            typeof rawLat === "number" &&
            typeof rawLng === "number" &&
            !Number.isNaN(rawLat) &&
            !Number.isNaN(rawLng)
          ) {
            presetDest = {
              latitude: rawLat,
              longitude: rawLng,
              name:
                bus.destName ||
                bus.destinationName ||
                routeLabel ||
                "Assigned destination",
            };
          }
        }

        setBusInfo({
          number,
          plate,
          routeLabel,
          presetDest,
        });

        // ✅ keep IoT stable even if backend not implemented
        setIot((prev) => ({
          ...prev,
          status: prev.status || "UNKNOWN",
        }));
      } catch (e) {
        console.log("[DriverDashboard] load driver profile error", e);
        setBusInfo({
          number: null,
          plate: null,
          routeLabel: null,
          presetDest: null,
        });
      }
    } catch (e) {
      console.log("[DriverDashboard] reload error", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mounted) await reload();
    })();
    return () => {
      mounted = false;
    };
  }, [reload]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const updateDutyOnServer = async (nextStatusBool) => {
    if (dutyUpdating) return;
    setDutyUpdating(true);
    const previous = isOnDuty;

    try {
      const token =
        (await AsyncStorage.getItem("driverToken")) ||
        (await AsyncStorage.getItem("token"));

      const res = await fetch(`${API_URL}/driver/duty`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          status: nextStatusBool ? "ON_DUTY" : "OFF_DUTY",
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.log("[DriverDashboard] duty update error", data);
        setIsOnDuty(previous);
        Alert.alert("Error", data.message || "Failed to update duty status.");
        return;
      }

      setIsOnDuty(nextStatusBool);

      if (!nextStatusBool) {
        setCurrentTrip(null);
      }
    } catch (err) {
      console.log("[DriverDashboard] duty update exception", err);
      setIsOnDuty(previous);
      Alert.alert("Error", "Failed to update duty status.");
    } finally {
      setDutyUpdating(false);
    }
  };

  const confirmDutyChange = (nextStatus) => {
    if (nextStatus === isOnDuty || dutyUpdating) return;

    const goingOn = nextStatus === true;

    Alert.alert(
      goingOn ? "Start duty?" : "End duty?",
      goingOn
        ? "You will be marked ON duty and can start trips."
        : "You will go OFF duty. Any ongoing trip will be closed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: goingOn ? "default" : "destructive",
          onPress: () => {
            updateDutyOnServer(nextStatus);
          },
        },
      ]
    );
  };

  const startTripSession = () => {
    if (!busInfo.routeLabel) {
      Alert.alert("No route", "Ask the admin to set up your bus route first.");
      return;
    }

    const now = new Date();
    const id = `${now.getTime()}`;

    const trip = {
      id,
      routeLabel: busInfo.routeLabel,
      startedAt: now.toISOString(),
      passengers: 0,
      driverId,
    };

    setCurrentTrip(trip);

    navigation?.navigate?.("DriverTracking", {
      trip,
      busInfo,
      presetDest: busInfo.presetDest || null,
      driver: {
        id: driverId,
        name: driver?.fullName || "Driver",
      },
    });
  };

  const endTripSession = () => {
    if (!currentTrip) return;

    Alert.alert("End trip?", "This will close your current trip session.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End trip",
        style: "destructive",
        onPress: async () => {
          setCurrentTrip(null);
        },
      },
    ]);
  };

  const handleTripAction = () => {
    if (!isOnDuty) {
      Alert.alert("Off duty", "Start duty first before starting a trip.");
      return;
    }
    if (currentTrip) {
      endTripSession();
    } else {
      startTripSession();
    }
  };

  const openReports = async () => {
    try {
      const total = totalReports || 0;
      setReportUnread(0);
      await AsyncStorage.setItem(STORAGE_KEYS.reportLastSeen, String(total));
    } catch (e) {
      console.log("[DriverDashboard] store report lastSeen error", e);
    } finally {
      navigation?.navigate?.("DriverReports");
    }
  };

  const openRatings = async () => {
    try {
      const total = totalRatings || 0;
      setRatingUnread(0);
      await AsyncStorage.setItem(STORAGE_KEYS.ratingLastSeen, String(total));
    } catch (e) {
      console.log("[DriverDashboard] store ratingLastSeen error", e);
    } finally {
      navigation?.navigate?.("DriverRatings");
    }
  };

  const openTripHistory = async () => {
    try {
      const total = totalTrips || 0;
      setTripUnread(0);
      await AsyncStorage.setItem(STORAGE_KEYS.tripLastSeen, String(total));
    } catch (e) {
      console.log("[DriverDashboard] store tripLastSeen error", e);
    } finally {
      navigation?.navigate?.("DriverTripHistory");
    }
  };

  const hasRatings = totalRatings > 0 && (avgRating || 0) > 0;

  let avgDisplay = "No ratings yet";

  if (hasRatings) {
    const rounded = Math.round((avgRating || 0) * 10) / 10;
    const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.001;
    const scoreStr = isWhole ? `${Math.round(rounded)}` : rounded.toFixed(1);
    avgDisplay = `${scoreStr} / 5`;
  }

  const ratingCountLabel =
    totalRatings === 1 ? "1 rating" : `${totalRatings} ratings`;
  const ratingSubtitle = hasRatings
    ? `${avgDisplay} • ${ratingCountLabel}`
    : "No ratings yet";

  if (!fontsLoaded) {
    return (
      <SafeAreaView
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
      >
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const busLine =
    busInfo.number || busInfo.plate
      ? `Bus ${busInfo.number || "—"} · ${busInfo.plate || "—"}`
      : "No bus assigned";

  const routeLine = busInfo.routeLabel || "Route not set";
  const hasActiveTrip = !!currentTrip;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]}>
      <StatusBar style="dark" />

      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <View style={styles.headerCard}>
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <View style={styles.avatar}>
                  {driver?.avatar ? (
                    <Image
                      source={{ uri: driver.avatar }}
                      style={styles.avatarImg}
                    />
                  ) : (
                    <LCText style={styles.avatarLetter}>
                      {(driver?.fullName?.[0] || "D").toUpperCase()}
                    </LCText>
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  <LCText style={styles.driverName} numberOfLines={1}>
                    {driver?.fullName || "—"}
                  </LCText>

                  <LCText style={styles.busLine} numberOfLines={1}>
                    {busLine}
                  </LCText>

                  <LCText style={styles.routeLine} numberOfLines={2}>
                    {routeLine}
                  </LCText>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <MaterialCommunityIcons name="radar" size={18} color={C.text} />
                <LCText style={styles.sectionTitle}>  Live status</LCText>
              </View>
            </View>

            <View style={styles.liveCard}>
              {!isOnDuty && (
                <>
                  <LCText style={styles.liveLabel}>You are OFF duty</LCText>
                  <LCText
                    style={[styles.liveMeta, { marginLeft: 0, marginTop: 4 }]}
                  >
                    Tap{" "}
                    <LCText style={{ fontWeight: "600" }}>"Start duty"</LCText>{" "}
                    below to make yourself available for trips.
                  </LCText>
                </>
              )}

              {isOnDuty && !hasActiveTrip && (
                <>
                  <View style={styles.dutyPill}>
                    <View style={styles.dutyDot} />
                    <LCText style={styles.dutyPillText}>On duty</LCText>
                  </View>

                  <LCText
                    style={[styles.liveMeta, { marginLeft: 0, marginTop: 8 }]}
                  >
                    You are available for trips.
                  </LCText>

                  {routeLine !== "Route not set" && (
                    <LCText
                      style={[
                        styles.liveMeta,
                        { marginLeft: 0, marginTop: 2 },
                      ]}
                      numberOfLines={2}
                    >
                      Route: {routeLine}
                    </LCText>
                  )}
                </>
              )}

              {isOnDuty && hasActiveTrip && (
                <>
                  <View
                    style={[
                      styles.dutyPill,
                      { backgroundColor: "#EEF2FF", borderColor: "#E0E7FF" },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="navigation-variant"
                      size={14}
                      color={C.brand}
                      style={{ marginRight: 6 }}
                    />
                    <LCText style={[styles.dutyPillText, { color: C.brand }]}>
                      Trip in progress
                    </LCText>
                  </View>

                  <LCText
                    style={[styles.liveMeta, { marginLeft: 0, marginTop: 8 }]}
                  >
                    {currentTrip.routeLabel || routeLine || "Route not set"}
                  </LCText>

                  <LCText
                    style={[styles.liveMeta, { marginLeft: 0, marginTop: 2 }]}
                  >
                    Keep the app open while driving so tracking stays accurate.
                  </LCText>
                </>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <MaterialCommunityIcons
                  name="lightning-bolt"
                  size={18}
                  color={C.text}
                />
                <LCText style={styles.sectionTitle}>  Quick actions</LCText>
              </View>
              {loading || dutyUpdating ? (
                <ActivityIndicator size="small" color={C.sub} />
              ) : null}
            </View>

            <View style={styles.quickGrid}>
              <QuickBox
                icon={isOnDuty ? "power" : "play-circle-outline"}
                title={isOnDuty ? "End duty" : "Start duty"}
                subtitle={
                  isOnDuty
                    ? "Tap when you're done driving for the day."
                    : "REQUIRED: Start duty before any trip."
                }
                variant={isOnDuty ? "danger" : "success"}
                onPress={() => confirmDutyChange(!isOnDuty)}
              />

              <QuickBox
                icon={
                  hasActiveTrip ? "stop-circle-outline" : "navigation-variant"
                }
                title={hasActiveTrip ? "End trip" : "Start trip"}
                subtitle={
                  !isOnDuty
                    ? "Start duty first"
                    : hasActiveTrip
                    ? "Finish current trip"
                    : "Open map and set route"
                }
                variant="accent"
                onPress={handleTripAction}
              />

              <QuickBox
                icon="alert-circle-outline"
                title="Reports"
                subtitle="View issues reported by commuters"
                onPress={openReports}
                badgeCount={reportUnread}
              />

              <QuickBox
                icon="history"
                title="Trip History"
                subtitle="View completed trips"
                onPress={openTripHistory}
                badgeCount={tripUnread}
              />

              <QuickBox
                icon="star-circle-outline"
                title="Ratings"
                subtitle={ratingSubtitle}
                onPress={openRatings}
                badgeCount={ratingUnread}
              />

              {/* ✅ IoT quick box (NOT BLUE) */}
              <QuickBox
                icon="access-point"
                title="IoT Device"
                subtitle={
                  iot?.status === "ONLINE"
                    ? "Device is online"
                    : iot?.status === "OFFLINE"
                    ? "Device is offline"
                    : iot?.status === "MAINTENANCE"
                    ? "Needs maintenance"
                    : "Check device status"
                }
                variant={
                  iot?.status === "ONLINE"
                    ? "success"
                    : iot?.status === "OFFLINE"
                    ? "danger"
                    : "default"
                }
                onPress={openIotReportChoices}
              />

              <QuickBox
                icon="account-circle-outline"
                title="Profile"
                subtitle="View & edit profile"
                onPress={() => navigation?.navigate?.("DriverSettings")}
              />
            </View>
          </View>
        </ScrollView>

        {/* ✅ Enhanced IoT Modal (replaces Alert UI) */}
        <Modal
          visible={iotModalOpen}
          transparent
          animationType="fade"
          onRequestClose={closeIotModal}
        >
          <Pressable style={styles.modalOverlay} onPress={closeIotModal}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <View style={styles.modalIconWrap}>
                  <MaterialCommunityIcons
                    name="access-point"
                    size={20}
                    color={C.brand}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <LCText style={styles.modalTitle}>IoT Device</LCText>
                  <LCText style={styles.modalSub}>
                    Report current device condition so admin can check it.
                  </LCText>
                </View>

                <TouchableOpacity
                  onPress={closeIotModal}
                  style={styles.modalCloseBtn}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={18}
                    color={C.sub}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.modalDivider} />

              <View style={styles.modalBody}>
                <TouchableOpacity
                  disabled={iotSending}
                  activeOpacity={0.85}
                  onPress={() => reportIotStatus("WORKING")}
                  style={[styles.modalAction, styles.modalActionSuccess]}
                >
                  <View
                    style={[
                      styles.actionPillIcon,
                      { backgroundColor: "rgba(16,185,129,0.14)" },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="check-circle"
                      size={18}
                      color={C.success}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <LCText style={styles.actionTitle}>Working</LCText>
                    <LCText style={styles.actionDesc}>
                      Device is functioning normally.
                    </LCText>
                  </View>
                  {iotSending ? (
                    <ActivityIndicator size="small" color={C.sub} />
                  ) : null}
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={iotSending}
                  activeOpacity={0.85}
                  onPress={() => reportIotStatus("NEEDS_MAINTENANCE")}
                  style={[styles.modalAction, styles.modalActionWarn]}
                >
                  <View
                    style={[
                      styles.actionPillIcon,
                      { backgroundColor: "rgba(245,158,11,0.14)" },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="alert"
                      size={18}
                      color={C.star}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <LCText style={styles.actionTitle}>Needs Maintenance</LCText>
                    <LCText style={styles.actionDesc}>
                      Intermittent / weak signal / check wiring.
                    </LCText>
                  </View>
                  {iotSending ? (
                    <ActivityIndicator size="small" color={C.sub} />
                  ) : null}
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={iotSending}
                  activeOpacity={0.85}
                  onPress={() => reportIotStatus("NOT_WORKING")}
                  style={[styles.modalAction, styles.modalActionDanger]}
                >
                  <View
                    style={[
                      styles.actionPillIcon,
                      { backgroundColor: "rgba(185,28,28,0.12)" },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="close-circle"
                      size={18}
                      color={C.danger}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <LCText style={styles.actionTitle}>Not Working</LCText>
                    <LCText style={styles.actionDesc}>
                      No power / not sending alerts / totally down.
                    </LCText>
                  </View>
                  {iotSending ? (
                    <ActivityIndicator size="small" color={C.sub} />
                  ) : null}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={closeIotModal}
                  disabled={iotSending}
                  activeOpacity={0.85}
                  style={styles.modalCancelBtn}
                >
                  <LCText style={styles.modalCancelText}>Cancel</LCText>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  headerCard: {
    margin: 16,
    padding: 16,
    backgroundColor: C.brand,
    borderRadius: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: "#1F2937",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarImg: { width: 48, height: 48, borderRadius: 999 },
  avatarLetter: {
    color: "#fff",
    fontFamily: "Poppins_700Bold",
    fontSize: 16,
  },
  driverName: {
    color: "#fff",
    fontFamily: "Poppins_700Bold",
    fontSize: 18,
  },
  busLine: {
    color: "#D1D5DB",
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    marginTop: 6,
  },
  routeLine: {
    color: "#9CA3AF",
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    marginTop: 2,
  },

  section: { marginHorizontal: 16, marginTop: 18 },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: "Poppins_700Bold",
    color: C.text,
    fontSize: 16,
  },

  liveCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  liveLabel: {
    fontFamily: "Poppins_700Bold",
    fontSize: 13,
    color: C.text,
    marginBottom: 4,
  },
  liveSubheading: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 12,
    color: C.text,
    marginBottom: 2,
  },
  liveValue: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 13,
    color: C.text,
    marginBottom: 8,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  liveMeta: {
    marginLeft: 6,
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    color: C.sub,
  },

  dutyPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(16,185,129,0.10)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.35)",
  },
  dutyDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: C.success,
    marginRight: 6,
  },
  dutyPillText: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 11,
    color: C.success,
  },

  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickBox: {
    width: "48%",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    position: "relative",
  },
  quickBoxPrimary: {
    borderWidth: 0,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  quickBoxIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 999,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  quickBoxIconWrapPrimary: {
    width: 36,
    height: 36,
    backgroundColor: "rgba(15,23,42,0.65)",
  },
  quickBoxTitle: {
    fontFamily: "Poppins_700Bold",
    fontSize: 13,
    marginBottom: 2,
  },
  quickBoxSubtitle: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    color: C.sub,
  },

  badge: {
    position: "absolute",
    top: 8,
    right: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: "Poppins_700Bold",
    fontSize: 10,
    color: "#FFFFFF",
  },

  // ✅ Enhanced IoT Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
  },
  modalIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontFamily: "Poppins_700Bold",
    fontSize: 16,
    color: C.text,
  },
  modalSub: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    color: C.sub,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  modalDivider: {
    height: 1,
    backgroundColor: C.border,
  },
  modalBody: {
    padding: 14,
    gap: 10,
  },
  modalAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: "#F9FAFB",
  },
  modalActionSuccess: {
    backgroundColor: "rgba(16,185,129,0.06)",
    borderColor: "rgba(16,185,129,0.25)",
  },
  modalActionWarn: {
    backgroundColor: "rgba(245,158,11,0.06)",
    borderColor: "rgba(245,158,11,0.25)",
  },
  modalActionDanger: {
    backgroundColor: "rgba(185,28,28,0.05)",
    borderColor: "rgba(185,28,28,0.20)",
  },
  actionPillIcon: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: {
    fontFamily: "Poppins_700Bold",
    fontSize: 13,
    color: C.text,
  },
  actionDesc: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    color: C.sub,
    marginTop: 2,
  },
  modalCancelBtn: {
    marginTop: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: "#fff",
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCancelText: {
    fontFamily: "Poppins_700Bold",
    fontSize: 12,
    color: C.sub,
  },
});
  
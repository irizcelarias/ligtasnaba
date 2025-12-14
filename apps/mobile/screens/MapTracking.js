// apps/mobile/screens/MapTracking.js
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Keyboard,
  Modal,
  TextInput as RNTextInput,
  Platform,
  Animated,
  Easing,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { API_URL } from "../constants/config";
import { WebView } from "react-native-webview";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { addIncidentSubmitted } from "../lib/notify";
import LCText from "../components/LCText";

const C = {
  brand: "#0B132B",
  text: "#111827",
  sub: "#6B7280",
  hint: "#9CA3AF",
  white: "#FFFFFF",
  card: "#FFFFFF",
  page: "#FFFFFF",
  border: "#E5E7EB",
  tealDot: "#22C55E",
  destPin: "#F43F5E",
  blue: "#1D4ED8",
  blueTrail: "#38BDF8",
  breadcrumb: "rgba(59,130,246,0.9)",
  routeLine: "#0EA5E9",
};

const GMAPS_JS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_JS_KEY || "";

const BG_TASK = "LC_TRACK_TASK";
let BG_TASK_DEFINED = false;

try {
  if (!BG_TASK_DEFINED) {
    TaskManager.defineTask(BG_TASK, ({ error }) => {
      if (error) return;
    });
    BG_TASK_DEFINED = true;
  }
} catch {}

async function startBackgroundTracking() {
  try {
    const bgPerm = await Location.getBackgroundPermissionsAsync();
    if (bgPerm.status !== "granted") {
      const req = await Location.requestBackgroundPermissionsAsync();
      if (req.status !== "granted") return;
    }
    const started = await Location.hasStartedLocationUpdatesAsync(BG_TASK);
    if (!started) {
      await Location.startLocationUpdatesAsync(BG_TASK, {
        accuracy: Location.Accuracy.Highest,
        timeInterval: 1500,
        distanceInterval: 3,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: "LigtasCommute",
          notificationBody: "Tracking your trip in the background",
        },
      });
    }
  } catch {}
}

async function stopBackgroundTracking() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BG_TASK);
    if (started) await Location.stopLocationUpdatesAsync(BG_TASK);
  } catch {}
}

function decodePolyline(str) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords = [];

  while (index < str.length) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

const haversine = (a, b) => {
  const R = 6371e3;
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const dφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dλ = ((b.longitude - a.longitude) * Math.PI) / 180;

  const x =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const cleanPlaceName = (s) => {
  if (!s) return "";
  return s
    .replace(/[+]/g, " ")
    .replace(/^[\s+–—-]+/, "")
    .replace(/\b\d+[A-Za-z-]*\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^,|,$/g, "")
    .trim();
};

function bearingTo(a, b) {
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  let θ = (Math.atan2(y, x) * 180) / Math.PI;
  return θ < 0 ? θ + 360 : θ;
}

async function authFetch(path, options = {}) {
  let token =
    (await AsyncStorage.getItem("authToken")) ||
    (await AsyncStorage.getItem("token")) ||
    (await AsyncStorage.getItem("commuter_token"));

  if (!token) {
    throw new Error("No commuter token stored");
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
}

function streetViewHTML(apiKey) {
  return `
<!doctype html>
<html>
<head>
<meta name="viewport" content="initial-scale=1, maximum-scale=1, user-scalable=no, width=device-width">
<style>
html,body,#p{height:100%;margin:0}
#hud{position:absolute;left:12px;bottom:12px;right:12px;display:flex;gap:8px;justify-content:space-between;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.chip{background:rgba(0,0,0,.5);padding:8px 10px;border-radius:10px;font-weight:700}
</style>
<script src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=quarterly"></script>
</head>
<body>
<div id="p"></div>
<div id="hud"><div id="pos" class="chip">Locating…</div><div id="dir" class="chip">Heading: —°</div></div>
<script>
let pano=null;
function init(lat,lng,heading){
  const sv=new google.maps.StreetViewService();
  const loc={lat,lng};
  const create=(position)=>{
    pano=new google.maps.StreetViewPanorama(document.getElementById('p'),{
      position, pov:{heading:heading||0,pitch:0}, zoom:1,
      motionTracking:false,motionTrackingControl:false,addressControl:false,
      linksControl:true,panControl:false,fullscreenControl:false,enableCloseButton:false
    });
    document.getElementById('pos').textContent=position.lat.toFixed(5)+", "+position.lng.toFixed(5);
    document.getElementById('dir').textContent="Heading: "+Math.round(heading||0)+"°";
  };
  sv.getPanorama({location:loc,radius:100,source:'outdoor'},(data,status)=>{
    if(status==='OK'&&data&&data.location&&data.location.latLng){
      const p=data.location.latLng; create({lat:p.lat(),lng:p.lng()});
    }else create(loc);
  });
}
function update(lat,lng,heading){
  if(!pano){init(lat,lng,heading);return;}
  const pos={lat,lng}; pano.setPosition(pos);
  if(typeof heading==='number'&&!Number.isNaN(heading)){const pov=pano.getPov(); pov.heading=heading; pano.setPov(pov);}
  document.getElementById('pos').textContent=pos.lat.toFixed(5)+", "+pos.lng.toFixed(5);
  document.getElementById('dir').textContent="Heading: "+Math.round(heading||0)+"°";
}
document.addEventListener('message',e=>{try{const m=JSON.parse(e.data||'{}');if(m.type==='init')init(m.lat,m.lng,m.heading||0);if(m.type==='update')update(m.lat,m.lng,m.heading||0);}catch(e){}});</script>
</body>
</html>`;
}

export default function MapTracking({ route }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [driver, setDriver] = useState(route?.params?.driver || null);

  useEffect(() => {
    (async () => {
      try {
        if (route?.params?.driver) {
          const d = route.params.driver;

          const driverProfileId =
            d.driverProfileId ||
            d.driverId ||
            d.id ||
            d.driver?.driverId ||
            d.driver?.id ||
            null;

          const busId = d.busId || d.bus?.id || d.busId || null;

          const normalized = {
            ...d,
            driverProfileId,
            busId,
          };

          setDriver(normalized);
          await AsyncStorage.setItem(
            "LC_CURRENT_DRIVER",
            JSON.stringify(normalized)
          );
        } else {
          const cached = await AsyncStorage.getItem("LC_CURRENT_DRIVER");
          if (cached) {
            const parsed = JSON.parse(cached);
            setDriver(parsed);
          }
        }
      } catch (e) {
        console.log("[MapTracking] driver load/save error", e);
      }
    })();
  }, [route?.params?.driver]);

  const mapRef = useRef(null);
  const watchRef = useRef(null);

  const [pickupSearch, setPickupSearch] = useState("");
  const [destSearch, setDestSearch] = useState("");
  const [activeField, setActiveField] = useState("dest");
  const [suggestions, setSuggestions] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [recents, setRecents] = useState([]);

  const [origin, setOrigin] = useState(null);
  const [originText, setOriginText] = useState("Getting location…");
  const [dest, setDest] = useState(null);
  const showRoutePins = !!dest;

  const [devicePos, setDevicePos] = useState(null);
  const [heading, setHeading] = useState(0);
  const [routeCoords, setRouteCoords] = useState([]);
  const [eta, setEta] = useState(null);
  const [navMode, setNavMode] = useState(false);
  const [, setSteps] = useState([]);
  const [, setStepIdx] = useState(0);
  const [error, setError] = useState("");

  const [speedKmh, setSpeedKmh] = useState(null);

  // ---- TRIP STATS (accurate) ----
  const tripStatsRef = useRef({
    startedAt: null,
    lastPoint: null,
    distance: 0, // meters
  });

  const [arrivalStats, setArrivalStats] = useState({
    durationMins: 0,
    distanceKm: 0,
    avgSpeed: 0,
  });

  const [lastUpdateAt, setLastUpdateAt] = useState(null);
  const [lastPointState, setLastPointState] = useState(null);
  // -------------------------------

  const [tripId, setTripId] = useState(null);

  const [arrivedSheet, setArrivedSheet] = useState(false);

  const CATEGORY_OPTIONS = [
    "Reckless Driving",
    "Overloading",
    "Overcharging",
    "Harassment",
    "Other",
  ];
  const [reportCats, setReportCats] = useState([]);
  const [reportNotes, setReportNotes] = useState("");
  const [reportOpen, setReportOpen] = useState(false);

  const [thanksOpen, setThanksOpen] = useState(false);
  const [lastReportCats, setLastReportCats] = useState([]);

  const [showStreet, setShowStreet] = useState(false);
  const webRef = useRef(null);
  const streetHTML = streetViewHTML(GMAPS_JS_KEY);
  const sendToStreet = (payload) => {
    try {
      webRef.current?.postMessage(JSON.stringify(payload));
    } catch {}
  };

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [pulse]);

  const pulseStyle = {
    transform: [
      { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) },
    ],
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
  };

  const lastCameraAt = useRef(0);
  const lastCamCenter = useRef(null);
  function animateCameraFollow(center, hdg = 0, zoom = 18.2) {
    const now = Date.now();
    if (now - lastCameraAt.current < 600) return;
    const movedEnough =
      !lastCamCenter.current || haversine(lastCamCenter.current, center) > 6;
    const headingDiff =
      typeof hdg === "number" && typeof animateCameraFollow._h === "number"
        ? Math.abs(hdg - animateCameraFollow._h)
        : 999;
    if (!movedEnough && headingDiff < 10) return;

    mapRef.current?.animateCamera(
      {
        center,
        heading: Number.isFinite(hdg) ? hdg : 0,
        pitch: 65,
        zoom,
      },
      { duration: 450 }
    );
    lastCamCenter.current = center;
    animateCameraFollow._h = hdg;
    lastCameraAt.current = now;
  }
  animateCameraFollow._h = 0;

  const animateTo = (
    coord,
    opts = { latitudeDelta: 0.04, longitudeDelta: 0.04 }
  ) => {
    if (!coord) return;
    setTimeout(
      () => mapRef.current?.animateToRegion({ ...coord, ...opts }, 500),
      60
    );
  };

  const reverseGeocode = async (coord) => {
    try {
      const list = await Location.reverseGeocodeAsync(coord);
      if (!list?.length) return null;
      const a = list[0];
      return [a.name, a.street, a.subregion, a.city].filter(Boolean).join(", ");
    } catch {
      return null;
    }
  };

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission denied.");
        setOriginText("Permission required");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const cur = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      setDevicePos(cur);
      setHeading(pos.coords.heading ?? 0);
      const label = (await reverseGeocode(cur)) || "Current location";
      setOrigin({ ...cur, name: label });
      setOriginText(label);
      setPickupSearch(label);
      animateTo(cur);
    })();
  }, []);

  useEffect(() => {
    if (!showSuggest) return;

    const query = activeField === "pickup" ? pickupSearch : destSearch;

    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setFetching(true);
        const r = await fetch(
          `${API_URL}/maps/autocomplete?q=${encodeURIComponent(query)}`
        );
        const j = await r.json();
        if (j?.status && j.status !== "OK")
          setError(j?.error_message || j?.status);
        setSuggestions(j?.predictions || []);
      } catch {
        setError("Autocomplete failed.");
      } finally {
        setFetching(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [pickupSearch, destSearch, activeField, showSuggest]);

  const fetchPlace = async (place) => {
    try {
      const r = await fetch(
        `${API_URL}/maps/place?id=${encodeURIComponent(place.place_id)}`
      );
      const j = await r.json();
      const l = j?.location;
      if (!l) return null;
      return {
        latitude: l.lat,
        longitude: l.lng,
        name: j?.name || place.description,
      };
    } catch {
      setError("Failed to fetch location details.");
      return null;
    }
  };

  const fitRoute = (o, d, coords) => {
    if (!o || !d) return;
    const pts = coords?.length ? coords : [o, d];
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: 160, right: 60, bottom: 260, left: 60 },
      animated: true,
    });
  };

  const lastDirectionsAt = useRef(0);
  const fetchDirections = async (o, d, force = false) => {
    const now = Date.now();
    if (!force && now - lastDirectionsAt.current < 5000) return;
    lastDirectionsAt.current = now;

    try {
      const r = await fetch(
        `${API_URL}/maps/directions?origin=${o.latitude},${o.longitude}&destination=${d.latitude},${d.longitude}&mode=driving`
      );
      const data = await r.json();

      if (data?.status && data.status !== "OK") {
        let msg =
          "Directions are not available for this route right now. Please adjust your starting point or destination.";

        switch (data.status) {
          case "ZERO_RESULTS":
            msg =
              "We couldn’t find a driving route between your selected starting point and destination. Try choosing locations that are closer together or adjust your route.";
            break;
          case "NOT_FOUND":
            msg =
              "We couldn’t find one of the locations you entered. Please try searching again.";
            break;
          case "OVER_QUERY_LIMIT":
          case "RESOURCE_EXHAUSTED":
            msg =
              "Map requests are temporarily limited. Please try again in a few moments.";
            break;
          case "REQUEST_DENIED":
            msg =
              "The maps request was denied. Please contact the LigtasCommute team if this keeps happening.";
            break;
          case "INVALID_REQUEST":
            msg =
              "Something is wrong with the route request. Please try again.";
            break;
          default:
            if (data.error_message) msg = data.error_message;
            break;
        }

        setError(msg);
        setRouteCoords([]);
        setEta(null);
        setSteps([]);
        setStepIdx(0);
        return;
      }

      const route0 = data?.routes?.[0];
      const leg0 = route0?.legs?.[0];
      const encoded = route0?.overview_polyline?.points;
      const coords = encoded ? decodePolyline(encoded) : [];
      setRouteCoords(coords);
      setEta({
        durationText: leg0?.duration?.text || "—",
        distanceText: leg0?.distance?.text || "—",
      });

      const rawSteps = leg0?.steps || [];
      const simple = rawSteps.map((s) => ({
        start_location: s.start_location
          ? {
              latitude: s.start_location.lat,
              longitude: s.start_location.lng,
            }
          : null,
        end_location: s.end_location
          ? {
              latitude: s.end_location.lat,
              longitude: s.end_location.lng,
            }
          : null,
        distanceText: s.distance?.text || "",
        html: s.html_instructions || "",
        maneuver: s.maneuver || "",
        road: s?.name || s?.summary || "",
      }));
      setSteps(simple);
      setStepIdx(0);

      if (!navMode) fitRoute(o, d, coords);
    } catch {
      setError(
        "Directions failed. Please check your internet connection and try again."
      );
    }
  };

  const startTripOnServer = async (startFrom) => {
    try {
      const resolvedDriverId =
        driver?.driverProfileId ||
        driver?.driverId ||
        driver?.id ||
        driver?.driver?.driverId ||
        driver?.driver?.id ||
        null;

      const resolvedBusId = driver?.busId || driver?.bus?.id || null;

      const snapshotDriverName =
        driver?.name ||
        driver?.fullName ||
        driver?.driver?.name ||
        driver?.driver?.fullName ||
        null;

      const snapshotBusNumber =
        driver?.busNumber || driver?.bus?.number || null;

      const snapshotBusPlate =
        driver?.plateNumber || driver?.bus?.plate || null;

      const payload = {
        driverProfileId: resolvedDriverId,
        busId: resolvedBusId,
        originLat: startFrom.latitude,
        originLng: startFrom.longitude,
        originLabel: origin?.name || originText || "Current location",
        driverName: snapshotDriverName,
        busNumber: snapshotBusNumber,
        busPlate: snapshotBusPlate,
      };

      const res = await authFetch("/commuter/trips/start", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          body.error ||
            "Failed to start trip. Please make sure a driver & bus are selected."
        );
        return null;
      }

      const id = body?.trip?.id || body?.id || null;
      return id;
    } catch (e) {
      console.log("[trip] startTrip exception:", e);
      setError("Network error while starting trip.");
      return null;
    }
  };

  const completeTripOnServer = async () => {
    try {
      const res = await authFetch("/commuter/trips/complete", {
        method: "POST",
        body: JSON.stringify({
          tripId: tripId || undefined,
          destLat: dest?.latitude ?? null,
          destLng: dest?.longitude ?? null,
          destLabel: dest?.name || null,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error || "Could not complete trip.");
        return;
      }

      const id = body?.trip?.id || body?.id || null;
      setTripId(id);
    } catch (e) {
      console.log("[trip] completeTrip exception:", e);
      setError("Network error while completing trip.");
    }
  };

  const startNavigation = async () => {
    if (!dest) return;

    setError("");

    let startFrom = origin || devicePos;

    if (!startFrom) {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      startFrom = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      setDevicePos(startFrom);
      setHeading(pos.coords.heading ?? 0);
      const label = (await reverseGeocode(startFrom)) || "Current location";
      setOrigin({ ...startFrom, name: label });
      setOriginText(label);
      setPickupSearch(label);
    }

    let newTripId = tripId;
    if (!newTripId) {
      newTripId = await startTripOnServer(startFrom);
      if (!newTripId) {
        return;
      }
      setTripId(newTripId);
    }

    animateCameraFollow(startFrom, heading, 18.2);

    await fetchDirections(startFrom, dest, true);

    // Reset + start trip stats
    setNavMode(true);
    setSpeedKmh(null);

    tripStatsRef.current = {
      startedAt: Date.now(),
      lastPoint: startFrom,
      distance: 0,
    };

    setLastPointState(startFrom);
    setLastUpdateAt(Date.now());

    startBackgroundTracking().catch(() => {});

    if (watchRef.current) watchRef.current.remove?.();
    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 1400,
        distanceInterval: 3,
      },
      async (pos) => {
        const cur = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        const hdg =
          typeof pos.coords.heading === "number"
            ? pos.coords.heading
            : heading ?? 0;

        let s = pos.coords.speed;
        const now = Date.now();
        if (
          (!Number.isFinite(s) || s === null) &&
          lastPointState &&
          lastUpdateAt
        ) {
          const dt = (now - lastUpdateAt) / 1000;
          if (dt > 0) s = haversine(lastPointState, cur) / dt;
        }
        const kmh =
          Number.isFinite(s) && s !== null
            ? Math.max(0, Math.round(s * 3.6))
            : null;
        setSpeedKmh(kmh);
        setLastUpdateAt(now);

        setDevicePos(cur);
        setHeading(hdg);
        setLastPointState(cur);

        // --- update trip stats accurately ---
        const stats = tripStatsRef.current;
        if (!stats.startedAt) stats.startedAt = now;
        if (stats.lastPoint) {
          const seg = haversine(stats.lastPoint, cur); // meters
          if (seg > 0.5) {
            stats.distance += seg;
          }
        }
        stats.lastPoint = cur;

        const stopped = kmh !== null ? kmh < 2 : false;
        animateCameraFollow(cur, hdg, stopped ? 18.0 : 18.2);

        fetchDirections(cur, dest);

        if (showStreet && dest) {
          const hdgToDest = bearingTo(cur, dest);
          sendToStreet({
            type: "update",
            lat: cur.latitude,
            lng: cur.longitude,
            heading: hdgToDest,
          });
        }

        const d = haversine(cur, dest);
        if (d < 50) endNavigation(true);
      }
    );
  };

  const endNavigation = (arrived = false) => {
    setNavMode(false);
    if (watchRef.current) watchRef.current.remove?.();
    watchRef.current = null;
    stopBackgroundTracking().catch(() => {});
    if (arrived) {
      // compute final stats for arrival sheet
      const stats = tripStatsRef.current;
      const endTime = Date.now();
      const durationMs = stats.startedAt ? endTime - stats.startedAt : 0;

      const durationMins =
        durationMs > 0 ? Math.max(1, Math.round(durationMs / 60000)) : 0;

      const distanceKmRaw = stats.distance / 1000;
      const distanceKm =
        distanceKmRaw < 0.05
          ? 0
          : Number(distanceKmRaw.toFixed(1)); // ignore <50m

      const avgSpeed =
        durationMs > 0 && distanceKmRaw > 0
          ? Math.round(distanceKmRaw / (durationMs / 3600000))
          : 0;

      setArrivalStats({
        durationMins,
        distanceKm,
        avgSpeed,
      });

      completeTripOnServer().catch(() => {});
      setArrivedSheet(true);
    }
    setShowStreet(false);
  };

  const resetTrackingState = () => {
    try {
      watchRef.current?.remove?.();
    } catch {}
    watchRef.current = null;
    stopBackgroundTracking().catch(() => {});
    setNavMode(false);
    setShowStreet(false);
    setReportOpen(false);
    setDest(null);
    setDestSearch("");
    setRouteCoords([]);
    setEta(null);
    setSteps([]);
    setStepIdx(0);

    // reset trip stats + arrival stats
    tripStatsRef.current = {
      startedAt: null,
      lastPoint: null,
      distance: 0,
    };
    setArrivalStats({
      durationMins: 0,
      distanceKm: 0,
      avgSpeed: 0,
    });
    setLastPointState(null);
    setLastUpdateAt(null);

    setTripId(null);
  };
  const goDashboard = () => {
    resetTrackingState();
    navigation.reset({
      index: 0,
      routes: [{ name: "CommuterDashboard" }],
    });
  };

  const recenterToUser = async () => {
    let cur = devicePos;
    if (!cur) {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      cur = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      setDevicePos(cur);
      setHeading(pos.coords.heading ?? heading ?? 0);
    }
    const label = (await reverseGeocode(cur)) || "Current location";
    setOrigin({ ...cur, name: label });
    setOriginText(label);
    setPickupSearch(label);
    if (navMode) animateCameraFollow(cur, heading, 18.2);
    else animateTo(cur);

    if (showStreet && dest) {
      const hdgToDest = bearingTo(cur, dest);
      sendToStreet({
        type: "update",
        lat: cur.latitude,
        lng: cur.longitude,
        heading: hdgToDest,
      });
    }
  };

  const setCurrentLocationAsOrigin = async () => {
    await recenterToUser();
    setShowSuggest(false);
  };

  useEffect(
    () => () => {
      if (watchRef.current) watchRef.current.remove?.();
    },
    []
  );

  const onLongPress = (e) => {
    const coord = e.nativeEvent.coordinate;
    const pinned = { ...coord, name: "Pinned destination" };
    setDest(pinned);
    setDestSearch(pinned.name);
    setShowSuggest(false);
    fetchDirections(origin || devicePos || pinned, pinned, true);
  };

  const onSelectSuggestion = async (item) => {
    setSuggestions([]);
    setShowSuggest(false);
    Keyboard.dismiss();

    const chosen = await fetchPlace(item);
    if (!chosen) return;

    if (activeField === "pickup") {
      const label = chosen.name || item.description;
      setOrigin(chosen);
      setOriginText(label);
      setPickupSearch(label);

      animateTo(chosen, {
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      });

      if (dest) {
        await fetchDirections(chosen, dest, true);
      }
    } else {
      const label = chosen.name || item.description;
      setDest(chosen);
      setDestSearch(label);
      setRecents((prev) => {
        const next = [item, ...prev.filter((x) => x.place_id !== item.place_id)];
        return next.slice(0, 6);
      });

      animateTo(chosen, {
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      });

      if (origin || devicePos) {
        await fetchDirections(origin || devicePos, chosen, true);
      }
    }
  };

  const clearDestination = () => {
    setDest(null);
    setDestSearch("");
    setSuggestions([]);
    setShowSuggest(false);
    setRouteCoords([]);
    setEta(null);
    setSteps([]);
    setStepIdx(0);
    setNavMode(false);
    if (watchRef.current) {
      watchRef.current.remove?.();
      watchRef.current = null;
    }
    setShowStreet(false);
    stopBackgroundTracking().catch(() => {});
  };

  const clearOrigin = () => {
    setOrigin(null);
    setOriginText("Starting point");
    setPickupSearch("");
    setSuggestions([]);
    setShowSuggest(false);
  };

  const openSuggest = () => {
    setShowSuggest(true);
  };

  const routeTitle = (() => {
    const a = cleanPlaceName(origin?.name || originText);
    const b = cleanPlaceName(dest?.name);
    if (!a || !b) return null;
    if (a.toLowerCase() === b.toLowerCase()) return "Your route";
    const pickShort = (t) => {
      const parts = t
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      return parts.length > 1 ? parts[0] : t;
    };
    return `${pickShort(a)} \u2192 ${pickShort(b)}`;
  })();

  const submitIncident = async () => {
    if (!reportCats.length) {
      setError("Choose at least one category.");
      return;
    }
    try {
      const payload = {
        category: reportCats.join(", "),
        categories: reportCats,
        notes: reportNotes,
        time: new Date().toISOString(),
        coords: devicePos,
        bus:
          driver?.plateNumber ||
          driver?.plate ||
          driver?.busNumber ||
          driver?.busNo ||
          null,
        driver: driver?.name || null,
        route: routeTitle,
        destination: dest?.name || null,
      };
      await fetch(`${API_URL}/incidents/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } finally {
      setReportOpen(false);
      setLastReportCats(reportCats);
      setReportCats([]);
      setReportNotes("");
      setThanksOpen(true);
    }
  };

  const query = activeField === "pickup" ? pickupSearch : destSearch;

  return (
    <SafeAreaView style={[s.safe, { paddingTop: insets.top }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        showsUserLocation={false}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        zoomControlEnabled={false}
        showsTraffic={true}
        onLongPress={onLongPress}
        initialRegion={{
          latitude: origin?.latitude || 10.3157,
          longitude: origin?.longitude || 123.8854,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
      >
        {origin &&
          !navMode &&
          !(devicePos && haversine(origin, devicePos) < 20) && (
            <Marker
              coordinate={origin}
              title={origin.name || "Start point"}
              description="Pickup location"
            >
              <View style={{ alignItems: "center" }}>
                <MaterialCommunityIcons
                  name="map-marker"
                  size={30}
                  color={C.tealDot}
                />
              </View>
            </Marker>
          )}

        {showRoutePins && dest && (
          <Marker
            coordinate={dest}
            title={dest.name || "Destination"}
            description="Pinned destination"
          >
            <MaterialCommunityIcons
              name="map-marker"
              size={32}
              color={C.destPin}
            />
          </Marker>
        )}

        {devicePos && (
          <Marker
            coordinate={devicePos}
            title="Current location"
            description={originText}
            anchor={{ x: 0.5, y: 0.5 }} // always centered for circle
          >
            <View style={s.deviceMarker}>
              <Animated.View style={[s.pulse, pulseStyle]} />
              <View style={s.blueDot} />
            </View>
          </Marker>
        )}

        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeWidth={6}
            strokeColor={C.routeLine}
          />
        )}
      </MapView>

      {!navMode && (
        <View style={[s.searchWrap, { top: 10 + insets.top }]}>
          <View style={s.searchCard}>
            <View style={s.timeline}>
              <View style={s.circleOuter}>
                <View style={s.circleInner} />
              </View>
              <View style={s.line} />
              <View
                style={[
                  s.circleOuter,
                  { borderColor: C.destPin },
                ]}
              >
                <View
                  style={[
                    s.circleInnerSmall,
                    { backgroundColor: C.destPin },
                  ]}
                />
              </View>
            </View>

            <View style={{ flex: 1 }}>
              <View style={s.row}>
                <LCText style={s.rowLabel}>Starting point</LCText>
                <View style={s.inputWrap}>
                  <TextInput
                    style={s.input}
                    placeholder="Search starting point"
                    placeholderTextColor={C.hint}
                    value={pickupSearch}
                    onFocus={() => {
                      setActiveField("pickup");
                      setShowSuggest(true);
                    }}
                    onChangeText={(txt) => {
                      setActiveField("pickup");
                      setPickupSearch(txt);
                    }}
                    returnKeyType="search"
                  />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {pickupSearch.length > 0 && (
                      <TouchableOpacity
                        onPress={clearOrigin}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialCommunityIcons
                          name="close-circle"
                          size={18}
                          color={C.hint}
                        />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={setCurrentLocationAsOrigin}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <MaterialCommunityIcons
                        name="crosshairs-gps"
                        size={20}
                        color={C.brand}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View style={s.rowDivider} />

              <View style={s.row}>
                <LCText style={s.rowLabel}>Where to go?</LCText>
                <View style={s.inputWrap}>
                  <TextInput
                    style={s.input}
                    placeholder="Search destination"
                    placeholderTextColor={C.hint}
                    value={destSearch}
                    onFocus={() => {
                      setActiveField("dest");
                      openSuggest();
                    }}
                    onChangeText={(txt) => {
                      setActiveField("dest");
                      setDestSearch(txt);
                    }}
                    returnKeyType="search"
                  />
                  {(destSearch.length > 0 || dest) && (
                    <TouchableOpacity
                      onPress={clearDestination}
                      hitSlop={{
                        top: 10,
                        bottom: 10,
                        left: 10,
                        right: 10,
                      }}
                    >
                      <MaterialCommunityIcons
                        name="close-circle"
                        size={18}
                        color={C.hint}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {showSuggest && (
                <View style={s.suggestBox}>
                  {activeField === "dest" &&
                  query.trim().length < 2 &&
                  recents.length > 0 ? (
                    <View>
                      <View style={s.suggestHdr}>
                        <LCText style={s.suggestHdrTxt}>Recent</LCText>
                      </View>
                      {recents.map((r) => (
                        <TouchableOpacity
                          key={r.place_id}
                          style={s.suggestRow}
                          onPress={() => onSelectSuggestion(r)}
                        >
                          <MaterialCommunityIcons
                            name="history"
                            size={18}
                            color={C.text}
                          />
                          <LCText
                            numberOfLines={2}
                            style={s.suggestText}
                          >
                            {r.description}
                          </LCText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <FlatList
                      keyboardShouldPersistTaps="handled"
                      data={suggestions}
                      keyExtractor={(it) => String(it.place_id)}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={s.suggestRow}
                          onPress={() => onSelectSuggestion(item)}
                        >
                          <MaterialCommunityIcons
                            name="map-marker-outline"
                            size={18}
                            color={C.text}
                          />
                          <LCText
                            numberOfLines={2}
                            style={s.suggestText}
                          >
                            {item.description}
                          </LCText>
                        </TouchableOpacity>
                      )}
                      ListEmptyComponent={
                        fetching ? (
                          <View
                            style={{
                              padding: 12,
                              alignItems: "center",
                            }}
                          >
                            <ActivityIndicator size="small" />
                          </View>
                        ) : query.trim().length >= 2 ? (
                          <View style={{ padding: 12 }}>
                            <LCText
                              style={{
                                color: C.sub,
                                textAlign: "center",
                              }}
                            >
                              No results
                            </LCText>
                          </View>
                        ) : null
                      }
                    />
                  )}
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      {!navMode && dest && routeCoords.length > 0 && eta && (
        <View
          style={[
            s.sheetWrap,
            { paddingBottom: 12 + insets.bottom },
          ]}
        >
          <View style={s.sheetCard}>
            <View style={{ flex: 1 }}>
              <LCText
                style={s.routeTitle}
                numberOfLines={1}
              >
                {routeTitle || "Your route"}
              </LCText>
              <LCText style={s.sheetEta}>
                {eta.durationText} • {eta.distanceText}
              </LCText>
              {!!(driver?.name || driver?.routeName) && (
                <View style={s.sheetLine}>
                  <MaterialCommunityIcons
                    name="car-clock"
                    size={16}
                    color={C.sub}
                  />
                  <LCText
                    numberOfLines={1}
                    style={s.sheetSub}
                  >
                    {driver?.routeName
                      ? `Taken by ${
                          driver?.name || "driver"
                        } • ${driver.routeName}`
                      : `Taken by ${driver?.name}`}
                  </LCText>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={s.startPill}
              onPress={startNavigation}
              activeOpacity={0.9}
            >
              <MaterialCommunityIcons
                name="navigation-variant"
                size={20}
                color={C.white}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {navMode && (
        <View
          style={[
            s.bottomBar,
            { paddingBottom: 12 + insets.bottom },
          ]}
        >
          <View style={s.navBottom}>
            <View style={{ flex: 1 }}>
              <LCText style={s.arriveEtaTitle}>Arrive in</LCText>
              <LCText style={s.arriveEtaValue}>
                {eta?.durationText || "—"} •{" "}
                {eta?.distanceText || "—"}
              </LCText>
            </View>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[
          s.locFab,
          { bottom: (navMode ? 170 : 148) + insets.bottom },
        ]}
        onPress={recenterToUser}
        activeOpacity={0.9}
      >
        <MaterialCommunityIcons
          name="crosshairs-gps"
          size={22}
          color={C.brand}
        />
      </TouchableOpacity>

      {navMode && (
        <View
          style={[
            s.speedBubble,
            { bottom: 96 + insets.bottom },
          ]}
        >
          <LCText style={s.speedValue}>
            {speedKmh === null ? "--" : String(speedKmh)}
          </LCText>
          <LCText style={s.speedUnit}>km/h</LCText>
        </View>
      )}

      {arrivedSheet && (
        <View
          style={[
            s.arrivedWrap,
            { paddingBottom: 16 + insets.bottom },
          ]}
        >
          <View style={s.arrivedCard}>
            <View style={s.arrivedPin}>
              <MaterialCommunityIcons
                name="map-marker"
                size={18}
                color="#fff"
              />
            </View>

            <LCText style={s.arrivedTitle}>
              Destination Reached
            </LCText>
            <LCText
              style={s.arrivedPlace}
              numberOfLines={2}
            >
              {cleanPlaceName(dest?.name) || "Destination"}
            </LCText>

            <View style={s.statsRow}>
              <View style={s.statBox}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={18}
                  color={C.sub}
                />
                <LCText style={s.statVal}>
                  {arrivalStats.durationMins} mins
                </LCText>
                <LCText style={s.statLbl}>Duration</LCText>
              </View>
              <View style={s.statBox}>
                <MaterialCommunityIcons
                  name="map-marker-distance"
                  size={18}
                  color={C.sub}
                />
                <LCText style={s.statVal}>
                  {arrivalStats.distanceKm} km
                </LCText>
                <LCText style={s.statLbl}>Distance</LCText>
              </View>
              <View style={s.statBox}>
                <MaterialCommunityIcons
                  name="speedometer"
                  size={18}
                  color={C.sub}
                />
                <LCText style={s.statVal}>
                  {arrivalStats.avgSpeed} km/h
                </LCText>
                <LCText style={s.statLbl}>Avg Speed</LCText>
              </View>
            </View>

            <View style={s.arrivedActions}>
              <TouchableOpacity
                style={s.primaryBtn}
                onPress={() => {
                  setArrivedSheet(false);
                  goDashboard();
                }}
                activeOpacity={0.9}
              >
                <LCText style={s.primaryBtnTxt}>Done</LCText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <Modal
        visible={reportOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setReportOpen(false)}
      >
        <View style={s.sheetOverlay}>
          <View style={s.reportSheet}>
            <View style={s.sheetHeader}>
              <LCText style={s.sheetTitle}>Report Incident</LCText>
              <TouchableOpacity
                onPress={() => setReportOpen(false)}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={20}
                  color={C.text}
                />
              </TouchableOpacity>
            </View>

            <LCText style={s.sheetLabel}>Quick categories</LCText>
            <View style={s.catWrap}>
              {CATEGORY_OPTIONS.map((cat) => {
                const active = reportCats.includes(cat);
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      s.catChip,
                      active && s.catChipActive,
                    ]}
                    onPress={() =>
                      setReportCats((prev) =>
                        prev.includes(cat)
                          ? prev.filter((c) => c !== cat)
                          : [...prev, cat]
                      )
                    }
                  >
                    <LCText
                      style={[
                        s.catTxt,
                        active && s.catTxtActive,
                      ]}
                    >
                      {cat}
                    </LCText>
                  </TouchableOpacity>
                );
              })}
            </View>

            <LCText
              style={[s.sheetLabel, { marginTop: 10 }]}
            >
              Notes (optional)
            </LCText>
            <RNTextInput
              multiline
              numberOfLines={4}
              placeholder="Describe what happened…"
              placeholderTextColor={C.hint}
              value={reportNotes}
              onChangeText={setReportNotes}
              style={s.notes}
            />

            <View style={{ height: 6 }} />

            <TouchableOpacity
              style={[
                s.submitBtn,
                { opacity: reportCats.length ? 1 : 0.6 },
              ]}
              disabled={!reportCats.length}
              onPress={submitIncident}
            >
              <LCText style={s.submitTxt}>Submit Report</LCText>
            </TouchableOpacity>

            <View style={s.attachInfo}>
              <MaterialCommunityIcons
                name="information-outline"
                size={16}
                color={C.sub}
              />
              <LCText style={s.attachTxt}>
                Time, GPS, bus/driver and route will be attached
                automatically.
              </LCText>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showStreet}
        animationType="slide"
        onRequestClose={() => setShowStreet(false)}
      >
        <SafeAreaView
          style={{ flex: 1, backgroundColor: "#000" }}
        >
          <View
            style={{
              position: "absolute",
              zIndex: 10,
              top: 8 + insets.top,
              left: 12,
              right: 12,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: "rgba(0,0,0,0.45)",
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 10,
              }}
            >
              <MaterialCommunityIcons
                name="street-view"
                size={18}
                color="#fff"
              />
              <LCText
                style={{
                  color: "#fff",
                  fontWeight: "800",
                }}
                numberOfLines={1}
              >
                {cleanPlaceName(dest?.name) ||
                  "Street View"}
              </LCText>
            </View>
            <TouchableOpacity
              onPress={() => setShowStreet(false)}
              style={{
                backgroundColor: "rgba(0,0,0,0.45)",
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 999,
              }}
            >
              <MaterialCommunityIcons
                name="chevron-down"
                size={22}
                color="#fff"
              />
            </TouchableOpacity>
          </View>

          {GMAPS_JS_KEY ? (
            <WebView
              ref={webRef}
              originWhitelist={["*"]}
              source={{ html: streetHTML }}
              javaScriptEnabled
              allowFileAccess
              allowUniversalAccessFromFileURLs
              onMessage={() => {}}
              androidLayerType={
                Platform.OS === "android" ? "hardware" : "none"
              }
              style={{ flex: 1, backgroundColor: "#000" }}
            />
          ) : (
            <View
              style={{
                flex: 1,
                backgroundColor: "#000",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
              }}
            >
              <LCText
                style={{
                  color: "#fff",
                  textAlign: "center",
                }}
              >
                Set EXPO_PUBLIC_GOOGLE_MAPS_JS_KEY to enable
                Street View.
              </LCText>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      <Modal
        visible={thanksOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setThanksOpen(false);
        }}
      >
        <View style={s.thanksOverlay}>
          <View style={s.thanksCard}>
            <View style={s.checkCircle}>
              <MaterialCommunityIcons
                name="check"
                size={26}
                color="#fff"
              />
            </View>
            <LCText style={s.thanksTitle}>Report sent</LCText>
            <LCText style={s.thanksMsg}>
              Your report has been submitted. Stay safe.
            </LCText>
            <TouchableOpacity
              style={s.okBtn}
              onPress={async () => {
                try {
                  await addIncidentSubmitted({
                    categories: lastReportCats,
                  });
                } finally {
                  setThanksOpen(false);
                }
              }}
            >
              <LCText style={s.okTxt}>Continue</LCText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {!!error && (
        <View
          style={[s.errToast, { bottom: 72 + insets.bottom }]}
        >
          <LCText style={s.errTxt}>{error}</LCText>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.page },
  pulse: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(37,99,235,0.18)",
    borderWidth: 1.5,
    borderColor: "rgba(37,99,235,0.6)",
  },
  deviceMarker: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  blueDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.blue,
    borderWidth: 2,
    borderColor: "#fff",
    position: "absolute",
  },
  searchWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 20,
  },
  searchCard: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  timeline: { width: 28, alignItems: "center", paddingTop: 6 },
  circleOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: C.tealDot,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ECFDF5",
  },
  circleInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.tealDot,
  },
  circleInnerSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.destPin,
  },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: C.border,
    marginVertical: 6,
    borderRadius: 999,
  },
  row: { paddingHorizontal: 8, paddingVertical: 6 },
  rowLabel: {
    color: C.sub,
    fontWeight: "600",
    fontSize: 12,
    marginBottom: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: C.border,
    marginHorizontal: 8,
  },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, color: C.text, paddingVertical: 0, minHeight: 20 },
  suggestBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.white,
    maxHeight: 260,
    overflow: "hidden",
    zIndex: 25,
    elevation: 8,
  },
  suggestHdr: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  suggestHdrTxt: {
    color: C.sub,
    fontWeight: "700",
    fontSize: 12,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  suggestText: { color: C.text, flex: 1 },
  sheetWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 10,
  },
  sheetCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    borderWidth: 1.25,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  routeTitle: { color: C.text, fontWeight: "800" },
  sheetEta: { color: C.text, marginTop: 2, fontWeight: "700" },
  sheetLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  sheetSub: { color: C.sub, flex: 1 },
  startPill: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  bottomBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 10,
  },
  navBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  arriveEtaTitle: { color: C.sub, fontSize: 12 },
  arriveEtaValue: { color: C.text, fontWeight: "800" },
  locFab: {
    position: "absolute",
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    zIndex: 15,
  },
  speedBubble: {
    position: "absolute",
    left: 16,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    zIndex: 15,
  },
  speedValue: {
    fontSize: 18,
    fontWeight: "800",
    color: C.text,
    marginBottom: 2,
  },
  speedUnit: { fontSize: 12, fontWeight: "700", color: C.sub },
  arrivedWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 20,
  },
  arrivedCard: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  arrivedPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  arrivedTitle: { color: C.text, fontWeight: "800", fontSize: 18 },
  arrivedPlace: { color: C.sub, textAlign: "center", marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 14, marginTop: 14 },
  statBox: {
    width: 96,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 10,
    backgroundColor: "#FAFAFA",
  },
  statVal: { color: C.text, fontWeight: "800", marginTop: 4 },
  statLbl: { color: C.sub, fontSize: 12 },
  arrivedActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: C.brand,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  primaryBtnTxt: { color: "#fff", fontWeight: "800" },
  notes: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    minHeight: 80,
    textAlignVertical: "top",
    color: C.text,
  },
  submitBtn: {
    marginTop: 14,
    backgroundColor: C.brand,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitTxt: { color: "#fff", fontWeight: "700" },
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  reportSheet: {
    backgroundColor: "#fff",
    padding: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderColor: C.border,
    borderWidth: 1,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sheetTitle: { fontWeight: "800", fontSize: 16, color: C.text },
  sheetLabel: { color: C.sub, fontWeight: "700", marginTop: 6 },
  catWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  catChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F9FAFB",
  },
  catChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  catTxt: { color: C.text, fontWeight: "600" },
  catTxtActive: { color: "#fff" },
  attachInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  attachTxt: { color: C.sub, flex: 1, fontSize: 12 },
  thanksOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  thanksCard: {
    width: "82%",
    backgroundColor: "#fff",
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
  },
  checkCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#0EA5E9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  thanksTitle: { fontSize: 18, fontWeight: "800", color: C.text },
  thanksMsg: {
    textAlign: "center",
    color: C.text,
    marginTop: 4,
    fontWeight: "600",
  },
  okBtn: {
    marginTop: 16,
    backgroundColor: "#0EA5E9",
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 999,
  },
  okTxt: { color: "#fff", fontWeight: "800" },
  errToast: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: "#FEE2E2",
    borderColor: "#FCA5A5",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  errTxt: { color: "#991B1B", textAlign: "center" },
});

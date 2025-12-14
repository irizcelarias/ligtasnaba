/* eslint-disable react-hooks/exhaustive-deps */
// apps/mobile/screens/DriverTracking.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Keyboard,
  Modal,
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

const C = {
  bg: "#F3F4F6",
  card: "#FFFFFF",
  border: "#E5E7EB",
  text: "#111827",
  sub: "#6B7280",
  hint: "#9CA3AF",
  white: "#FFFFFF",
  darkGlass: "rgba(17,24,39,0.92)",
  tealDot: "#38BDF8",
  destPin: "#E11D48",
  blue: "#2563EB",
  routeLine: "#0EA5E9",
  brand: "#0B132B",
  page: "#FFFFFF",
};

const TRIP_HISTORY_KEY = "driverTrips";

const GMAPS_JS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_JS_KEY || "";
const ENABLE_STREET_VIEW = false;

const BG_TASK = "LC_TRACK_TASK_DRIVER";
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
          notificationBody: "Driver navigation in progress",
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
  const coordinates = [];
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
    coordinates.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coordinates;
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
  let t = s
    .replace(/[+]/g, " ")
    .replace(/^[\s+–—-]+/, "")
    .replace(/\b\d+[A-Za-z-]*\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^,|,$/g, "")
    .trim();
  return t;
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
  if (θ < 0) θ += 360;
  return θ;
}

const cleanInstruction = (html) =>
  (html || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

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
document.addEventListener('message',e=>{try{const m=JSON.parse(e.data||'{}');if(m.type==='init')init(m.lat,m.lng,m.heading||0);if(m.type==='update')update(m.lat,m.lng,m.heading||0);}catch(e){}});
</script>
</body>
</html>`;
}

export default function DriverTracking({ route }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const params = route?.params || {};
  const presetDestFromRoute = params?.presetDest || null;
  const busRouteLabel =
    params?.busInfo?.routeLabel || params?.trip?.routeLabel || null;

  const mapRef = useRef(null);
  const watchRef = useRef(null);

  const [originInput, setOriginInput] = useState("");
  const [destInput, setDestInput] = useState("");
  const [activeField, setActiveField] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [recents, setRecents] = useState([]);
  const [origin, setOrigin] = useState(null);
  const [originText, setOriginText] = useState("Getting location…");
  const [dest, setDest] = useState(null);
  const [devicePos, setDevicePos] = useState(null);
  const [heading, setHeading] = useState(0);
  const [routeCoords, setRouteCoords] = useState([]);
  const [eta, setEta] = useState(null);
  const [navMode, setNavMode] = useState(false);
  const [steps, setSteps] = useState([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState("");
  const [speedKmh, setSpeedKmh] = useState(null);
  const [tripStartAt, setTripStartAt] = useState(null);
  const [tripDistance, setTripDistance] = useState(0);
  const [lastPoint, setLastPoint] = useState(null);
  const [lastUpdateAt, setLastUpdateAt] = useState(null);
  const [arrivedSheet, setArrivedSheet] = useState(false);
  const [showStreet, setShowStreet] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);

  const webRef = useRef(null);
  const streetHTML = useMemo(() => streetViewHTML(GMAPS_JS_KEY), []);

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
      {
        scale: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 2.4],
        }),
      },
    ],
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
  };

  const lastCameraAt = useRef(0);
  const lastCamCenter = useRef(null);

  function animateCameraFollow(center, hdg = 0, zoom = 18.5) {
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
        pitch: navMode ? 70 : 50,
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
        setError(data?.error_message || data?.status);
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
        seconds: leg0?.duration?.value || null,
      });

      const rawSteps = leg0?.steps || [];
      const simple = rawSteps.map((s) => ({
        start_location: s.start_location
          ? { latitude: s.start_location.lat, longitude: s.start_location.lng }
          : null,
        end_location: s.end_location
          ? { latitude: s.end_location.lat, longitude: s.end_location.lng }
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
      setError("Directions failed.");
    }
  };

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission denied.");
        setOriginText("Permission required");
        setOriginInput("Permission required");
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
      setOriginInput(label);
      animateCameraFollow(cur, pos.coords.heading ?? 0, 17.8);

      const preset = presetDestFromRoute;
      if (
        preset &&
        typeof preset.latitude === "number" &&
        typeof preset.longitude === "number"
      ) {
        const destObj = {
          latitude: preset.latitude,
          longitude: preset.longitude,
          name: preset.name || "Assigned destination",
        };
        setDest(destObj);

        const cleanedName = cleanPlaceName(destObj.name) || destObj.name || "";
        setDestInput(cleanedName);
        setSearchQuery("");

        await fetchDirections(cur, destObj, true);
      }
    })();
  }, [presetDestFromRoute]);

  useEffect(() => {
    if (!showSuggest) return;
    const q = (searchQuery || "").trim();

    if (q.length < 2) {
      setSuggestions([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setFetching(true);
        const r = await fetch(
          `${API_URL}/maps/autocomplete?q=${encodeURIComponent(q)}`
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
  }, [searchQuery, showSuggest, activeField, recents.length]);

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

  const startNavigation = async (overrideDest = null) => {
    const target = overrideDest || dest;
    if (!target) return;

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
    }
    const label =
      origin?.name ||
      (await reverseGeocode(startFrom)) ||
      originInput ||
      "Current location";
    const originObj = { ...startFrom, name: label };
    setOrigin(originObj);
    setOriginText(label);
    if (!originInput) setOriginInput(label);

    animateCameraFollow(startFrom, heading, 18.5);

    await fetchDirections(startFrom, target, true);
    setNavMode(true);
    setTripStartAt(Date.now());
    setTripDistance(0);
    setLastPoint(startFrom);
    setLastUpdateAt(Date.now());
    setSpeedKmh(null);

    startBackgroundTracking().catch(() => {});

    if (ENABLE_STREET_VIEW && GMAPS_JS_KEY) {
      setShowStreet(true);
      setTimeout(() => {
        const hdgToDest = target ? bearingTo(startFrom, target) : heading || 0;
        sendToStreet({
          type: "init",
          lat: startFrom.latitude,
          lng: startFrom.longitude,
          heading: hdgToDest,
        });
      }, 300);
    }

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
        if ((!Number.isFinite(s) || s === null) && lastPoint && lastUpdateAt) {
          const dt = (now - lastUpdateAt) / 1000;
          if (dt > 0) s = haversine(lastPoint, cur) / dt;
        }
        const kmh =
          Number.isFinite(s) && s !== null
            ? Math.max(0, Math.round(s * 3.6))
            : null;
        setSpeedKmh(kmh);
        setLastUpdateAt(now);

        setDevicePos(cur);
        setHeading(hdg);

        if (lastPoint) setTripDistance((d) => d + haversine(lastPoint, cur));
        setLastPoint(cur);

        const stopped = kmh !== null ? kmh < 2 : false;
        animateCameraFollow(cur, hdg, stopped ? 18.2 : 18.8);

        fetchDirections(cur, target);

        if (showStreet && target) {
          const hdgToDest = bearingTo(cur, target);
          sendToStreet({
            type: "update",
            lat: cur.latitude,
            lng: cur.longitude,
            heading: hdgToDest,
          });
        }

        const d = haversine(cur, target);
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
      setArrivedSheet(true);
    }
    setShowStreet(false);
  };

  const durationMins = tripStartAt
    ? Math.max(0, Math.round((Date.now() - tripStartAt) / 60000))
    : 0;
  const distanceKm = (tripDistance / 1000).toFixed(1);
  const avgSpeed =
    durationMins > 0
      ? Math.round((tripDistance / 1000) / (durationMins / 60))
      : 0;

  const arrivalTimeStr = (() => {
    if (!eta?.seconds) return null;
    const dt = new Date(Date.now() + eta.seconds * 1000);
    let h = dt.getHours();
    const m = dt.getMinutes();
    const ampm = h >= 12 ? "pm" : "am";
    h = h % 12;
    if (h === 0) h = 12;
    const mm = m < 10 ? `0${m}` : String(m);
    return `${h}:${mm} ${ampm}`;
  })();

  const saveTripHistory = async () => {
    if (!tripStartAt || !dest || savingHistory) return;

    try {
      setSavingHistory(true);
      const token = await AsyncStorage.getItem("token");

      const nowIso = new Date().toISOString();
      const baseTrip = params?.trip || {};

      const finishedTripLocal = {
        id: baseTrip.id || `${Date.now()}`,
        routeLabel: busRouteLabel || baseTrip.routeLabel || "Completed trip",
        startedAt: baseTrip.startedAt || new Date(tripStartAt).toISOString(),
        endedAt: nowIso,
        driverId: baseTrip.driverId || null,
      };

      try {
        await fetch(`${API_URL}/driver/trips/history`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            tripId: finishedTripLocal.id,
            routeLabel: finishedTripLocal.routeLabel,
            destinationName: dest.name || null,
            durationMinutes: durationMins,
            distanceKm: Number(distanceKm),
            avgSpeedKmh: avgSpeed,
            startedAt: finishedTripLocal.startedAt,
            endedAt: finishedTripLocal.endedAt,
          }),
        });
      } catch {}

      try {
        const raw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        arr.unshift(finishedTripLocal);
        await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(arr));
      } catch (e) {
        console.log("[DriverTracking] failed to update local trip history", e);
      }
    } catch {} finally {
      setSavingHistory(false);
    }
  };

  const resetTrackingState = () => {
    try {
      watchRef.current?.remove?.();
    } catch {}
    watchRef.current = null;
    stopBackgroundTracking().catch(() => {});
    setNavMode(false);
    setShowStreet(false);
    setDest(null);
    setDestInput("");
    setRouteCoords([]);
    setEta(null);
    setSteps([]);
    setStepIdx(0);
    setTripStartAt(null);
    setTripDistance(0);
    setLastPoint(null);
    setLastUpdateAt(null);
    setSpeedKmh(null);
  };

  const goDashboard = () => {
    resetTrackingState();
    navigation.reset({ index: 0, routes: [{ name: "DriverDashboard" }] });
  };

  const recenterToUser = async () => {
    let cur = devicePos;
    let hdg = heading;
    if (!cur) {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      cur = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      hdg = pos.coords.heading ?? heading ?? 0;
      setDevicePos(cur);
      setHeading(hdg);
    }
    const label = (await reverseGeocode(cur)) || "Current location";
    setOrigin({ ...cur, name: label });
    setOriginText(label);
    if (!originInput) setOriginInput(label);

    animateCameraFollow(cur, hdg, 18.8);

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
    setDestInput(pinned.name);
    setShowSuggest(false);
    setSearchQuery("");
    fetchDirections(origin || devicePos || pinned, pinned, true);
  };

  const onSelectStartSuggestion = async (item) => {
    setSuggestions([]);
    setShowSuggest(false);
    setActiveField(null);
    Keyboard.dismiss();
    const chosen = await fetchPlace(item);
    if (!chosen) return;
    const name = cleanPlaceName(chosen.name) || chosen.name || item.description;
    const originObj = { ...chosen, name };
    setOrigin(originObj);
    setOriginText(name);
    setOriginInput(name);

    animateTo(chosen, { latitudeDelta: 0.06, longitudeDelta: 0.06 });

    if (dest) await fetchDirections(originObj, dest, true);
  };

  const onSelectDestSuggestion = async (item) => {
    setSuggestions([]);
    setShowSuggest(false);
    setActiveField(null);
    Keyboard.dismiss();
    const chosen = await fetchPlace(item);
    if (!chosen) return;
    const name = cleanPlaceName(chosen.name) || chosen.name || item.description;
    setDest({ ...chosen, name });
    setDestInput(name);
    setRecents((prev) => {
      const next = [
        item,
        ...prev.filter((x) => x.place_id !== item.place_id),
      ];
      return next.slice(0, 6);
    });
    animateTo(chosen, { latitudeDelta: 0.06, longitudeDelta: 0.06 });
    if (origin || devicePos) {
      await fetchDirections(origin || devicePos, { ...chosen, name }, true);
    }
  };

  const clearOrigin = () => {
    setOrigin(null);
    setOriginText("Choose start point");
    setOriginInput("");
    setSearchQuery("");
    setShowSuggest(false);
  };

  const clearDestination = () => {
    setDest(null);
    setDestInput("");
    setSuggestions([]);
    setShowSuggest(false);
    setSearchQuery("");
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

  const openSuggest = () => {
    setShowSuggest(true);
    if ((searchQuery || "").trim().length < 2) setSuggestions([]);
  };

  const nextStep = steps[stepIdx] || null;
  const currentManeuver = nextStep?.maneuver || "";

  const banner = (() => {
    if (!nextStep) return null;
    const m = nextStep.maneuver || "";
    const title = m.includes("left")
      ? "Turn left"
      : m.includes("right")
      ? "Turn right"
      : m.includes("straight")
      ? "Go straight"
      : m.includes("roundabout")
      ? "At roundabout"
      : "Continue";
    return {
      distance: nextStep.distanceText || eta?.distanceText || "",
      primary: cleanInstruction(nextStep.html) || title,
      road: nextStep.road || "",
    };
  })();

  const routeTitle = (() => {
    const a = cleanPlaceName(origin?.name || originText);
    const b = cleanPlaceName(dest?.name);
    if (!a || !b) {
      return busRouteLabel || "Your route";
    }
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

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: insets.top }]}>
      {navMode && banner && (
        <View style={[styles.banner, { top: 10 + insets.top }]}>
          <MaterialCommunityIcons
            name={
              currentManeuver.includes("left")
                ? "arrow-left"
                : currentManeuver.includes("right")
                ? "arrow-right"
                : "arrow-up"
            }
            size={26}
            color={C.white}
            style={{ marginRight: 10 }}
          />
          <View style={{ flex: 1 }}>
            {!!banner.distance && (
              <Text style={styles.bannerDistance}>{banner.distance}</Text>
            )}
            <Text style={styles.bannerTitle} numberOfLines={2}>
              {banner.primary}
            </Text>
            {!!banner.road && (
              <Text style={styles.bannerSub} numberOfLines={1}>
                {banner.road}
              </Text>
            )}
          </View>
        </View>
      )}

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        mapType="standard"
        pitchEnabled
        rotateEnabled
        showsUserLocation={false}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        zoomControlEnabled={false}
        showsTraffic={true}
        onLongPress={onLongPress}
        mapPadding={{
          top: navMode ? 120 : 120,
          bottom: navMode ? 130 : 180,
          left: 0,
          right: 0,
        }}
        initialRegion={{
          latitude: origin?.latitude || 10.3157,
          longitude: origin?.longitude || 123.8854,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
      >
        {origin && !(devicePos && haversine(origin, devicePos) < 20) && (
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

        {dest && (
          <Marker coordinate={dest} title={dest.name || "Destination"}>
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
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.deviceMarker}>
              <Animated.View style={[styles.pulse, pulseStyle]} />
              <View style={styles.blueDot} />
            </View>
          </Marker>
        )}

        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeWidth={7}
            strokeColor={C.routeLine}
          />
        )}
      </MapView>

      {!navMode && (
        <View style={[styles.searchWrap, { top: 10 + insets.top }]}>
          <View style={styles.searchCard}>
            <View style={styles.timeline}>
              <View style={styles.circleOuter}>
                <View style={styles.circleInner} />
              </View>
              <View style={styles.line} />
              <View style={[styles.circleOuter, { borderColor: C.destPin }]}>
                <View
                  style={[
                    styles.circleInnerSmall,
                    { backgroundColor: C.destPin },
                  ]}
                />
              </View>
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Start point</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    placeholder="Choose start location"
                    placeholderTextColor={C.hint}
                    value={originInput}
                    onFocus={() => {
                      setActiveField("start");
                      setSearchQuery(originInput || "");
                      openSuggest();
                    }}
                    onChangeText={(txt) => {
                      setOriginInput(txt);
                      setActiveField("start");
                      setSearchQuery(txt);
                    }}
                    returnKeyType="search"
                  />
                  {originInput.length > 0 && (
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
                </View>
              </View>

              <View style={styles.rowDivider} />

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Destination</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    placeholder="Search destination"
                    placeholderTextColor={C.hint}
                    value={destInput}
                    onFocus={() => {
                      setActiveField("dest");
                      setSearchQuery(destInput || "");
                      openSuggest();
                    }}
                    onChangeText={(txt) => {
                      setDestInput(txt);
                      setActiveField("dest");
                      setSearchQuery(txt);
                    }}
                    returnKeyType="search"
                  />
                  {(destInput.length > 0 || dest) && (
                    <TouchableOpacity
                      onPress={clearDestination}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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
                <View style={styles.suggestBox}>
                  <FlatList
                    keyboardShouldPersistTaps="handled"
                    data={suggestions}
                    keyExtractor={(it) => String(it.place_id)}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.suggestRow}
                        onPress={() =>
                          activeField === "start"
                            ? onSelectStartSuggestion(item)
                            : onSelectDestSuggestion(item)
                        }
                      >
                        <MaterialCommunityIcons
                          name="map-marker-outline"
                          size={18}
                          color={C.text}
                        />
                        <Text numberOfLines={2} style={styles.suggestText}>
                          {item.description}
                        </Text>
                      </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                      fetching ? (
                        <View style={{ padding: 12, alignItems: "center" }}>
                          <ActivityIndicator size="small" />
                        </View>
                      ) : (
                        <View style={{ padding: 12 }}>
                          <Text
                            style={{
                              color: C.sub,
                              textAlign: "center",
                            }}
                          >
                            No results
                          </Text>
                        </View>
                      )
                    }
                  />
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      {!navMode && dest && routeCoords.length > 0 && eta && (
        <View
          style={[styles.sheetWrap, { paddingBottom: 12 + insets.bottom }]}
        >
          <View style={styles.sheetCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeTitle} numberOfLines={1}>
                {routeTitle || "Your route"}
              </Text>
              <Text style={styles.sheetEta}>
                {eta.durationText} • {eta.distanceText}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.startPill}
              onPress={() => startNavigation()}
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
          style={[styles.bottomBar, { paddingBottom: 12 + insets.bottom }]}
        >
          <View style={styles.navBottom}>
            <View style={{ flex: 1 }}>
              {arrivalTimeStr && (
                <>
                  <Text style={styles.arriveEtaTitle}>Arrive at</Text>
                  <Text style={styles.arriveEtaClock}>{arrivalTimeStr}</Text>
                </>
              )}
              <Text style={styles.arriveEtaSub}>
                {eta?.durationText || "—"} • {eta?.distanceText || "—"}
              </Text>
              {!!dest && (
                <Text style={styles.arriveEtaDest} numberOfLines={1}>
                  {cleanPlaceName(dest.name) || "Destination"}
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.locFab,
          { bottom: (navMode ? 155 : 148) + insets.bottom },
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
            styles.speedBubble,
            { bottom: (navMode ? 150 : 132) + insets.bottom },
          ]}
        >
          <Text style={styles.speedValue}>
            {speedKmh === null ? "--" : String(speedKmh)}
          </Text>
          <Text style={styles.speedUnit}>km/h</Text>
        </View>
      )}

      {arrivedSheet && (
        <View
          style={[styles.arrivedWrap, { paddingBottom: 16 + insets.bottom }]}
        >
          <View style={styles.arrivedCard}>
            <View style={styles.arrivedPin}>
              <MaterialCommunityIcons
                name="map-marker"
                size={18}
                color="#fff"
              />
            </View>

            <Text style={styles.arrivedTitle}>Destination Reached</Text>
            <Text style={styles.arrivedPlace} numberOfLines={2}>
              {cleanPlaceName(dest?.name) || "Destination"}
            </Text>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={18}
                  color={C.sub}
                />
                <Text style={styles.statVal}>{durationMins} mins</Text>
                <Text style={styles.statLbl}>Duration</Text>
              </View>
              <View style={styles.statBox}>
                <MaterialCommunityIcons
                  name="map-marker-distance"
                  size={18}
                  color={C.sub}
                />
                <Text style={styles.statVal}>{distanceKm} km</Text>
                <Text style={styles.statLbl}>Distance</Text>
              </View>
              <View style={styles.statBox}>
                <MaterialCommunityIcons
                  name="speedometer"
                  size={18}
                  color={C.sub}
                />
                <Text style={styles.statVal}>{avgSpeed} km/h</Text>
                <Text style={styles.statLbl}>Avg Speed</Text>
              </View>
            </View>

            <View style={styles.arrivedActions}>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  savingHistory && { opacity: 0.7 },
                ]}
                onPress={async () => {
                  await saveTripHistory();
                  setArrivedSheet(false);
                  goDashboard();
                }}
                activeOpacity={0.9}
                disabled={savingHistory}
              >
                <Text style={styles.primaryBtnTxt}>
                  {savingHistory ? "Saving..." : "Close"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {ENABLE_STREET_VIEW && (
        <Modal
          visible={showStreet}
          animationType="slide"
          onRequestClose={() => setShowStreet(false)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
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
                <Text
                  style={{ color: "#fff", fontWeight: "800" }}
                  numberOfLines={1}
                >
                  {cleanPlaceName(dest?.name) || "Street View"}
                </Text>
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
                <Text style={{ color: "#fff", textAlign: "center" }}>
                  Set EXPO_PUBLIC_GOOGLE_MAPS_JS_KEY to enable Street View.
                </Text>
              </View>
            )}
          </SafeAreaView>
        </Modal>
      )}

      {!!error && (
        <View style={[styles.errToast, { bottom: 72 + insets.bottom }]}>
          <Text style={styles.errTxt}>{error}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  searchWrap: { position: "absolute", left: 12, right: 12, zIndex: 20 },
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
    backgroundColor: "#EFF6FF",
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
  rowLabel: { color: C.sub, fontWeight: "600", fontSize: 12, marginBottom: 2 },
  rowDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 8 },
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
    backgroundColor: "rgba(11,19,43,0.94)",
    borderWidth: 0,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  arriveEtaTitle: { color: "#E5E7EB", fontSize: 12 },
  arriveEtaClock: {
    color: "#F9FAFB",
    fontWeight: "800",
    fontSize: 16,
    marginTop: 2,
  },
  arriveEtaSub: {
    color: "#CBD5F5",
    fontSize: 12,
    marginTop: 2,
    fontWeight: "600",
  },
  arriveEtaDest: {
    color: "#E5E7EB",
    fontSize: 12,
    marginTop: 2,
  },
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: "rgba(11,19,43,0.94)",
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 25,
  },
  bannerDistance: {
    color: "#F9FAFB",
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 2,
  },
  bannerTitle: { color: C.white, fontWeight: "800", fontSize: 14 },
  bannerSub: { color: "#D1D5DB", fontSize: 12, marginTop: 2 },
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
    backgroundColor: "#FFFFFF",
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

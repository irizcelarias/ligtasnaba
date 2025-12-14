// apps/mobile/screens/DriverTripHistory.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "../constants/config";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from "@expo-google-fonts/poppins";
import LCText from "../components/LCText";

const TRIP_HISTORY_KEY = "driverTrips";

const C = {
  bg: "#F3F4F6",
  card: "#FFFFFF",
  border: "#E5E7EB",
  text: "#111827",
  sub: "#6B7280",
  brand: "#0B132B",
};

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function DriverTripHistory({ navigation }) {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [driverId, setDriverId] = useState(null);
  const [sortOrder, setSortOrder] = useState("newest");

  const loadTrips = useCallback(async (activeDriverId) => {
    try {
      const raw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];

      const filtered = Array.isArray(arr)
        ? arr.filter(
            (t) =>
              t.driverId && (!activeDriverId || t.driverId === activeDriverId)
          )
        : [];

      setTrips(filtered);
    } catch (e) {
      console.log("[DriverTripHistory] Failed to load trips", e);
      setTrips([]);
    }
  }, []);

  const init = useCallback(async () => {
    setLoading(true);
    try {
      let activeDriverId = null;

      try {
        const token =
          (await AsyncStorage.getItem("driverToken")) ||
          (await AsyncStorage.getItem("token"));

        if (token) {
          const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          };
          const res = await fetch(`${API_URL}/users/me`, { headers });
          const data = await res.json().catch(() => ({}));

          if (res.ok) {
            const driverProfile = data.driver || data.driverProfile || {};
            activeDriverId = driverProfile.id || data.id || null;
          } else {
            console.log("[DriverTripHistory] /users/me not ok", res.status);
          }
        }
      } catch (err) {
        console.log("[DriverTripHistory] Failed to load profile", err);
      }

      setDriverId(activeDriverId);
      await loadTrips(activeDriverId);
    } finally {
      setLoading(false);
    }
  }, [loadTrips]);

  useEffect(() => {
    init();
  }, [init]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTrips(driverId);
    setRefreshing(false);
  }, [loadTrips, driverId]);

  // Sorting trips based on order
  const sortedTrips = [...trips].sort((a, b) => {
    const getTime = (t) => {
      const d = new Date(t.startedAt || 0);
      const n = d.getTime();
      return Number.isNaN(n) ? 0 : n;
    };
    const at = getTime(a);
    const bt = getTime(b);
    if (sortOrder === "newest") return bt - at;
    return at - bt;
  });

  const sortLabel =
    sortOrder === "newest" ? "Newest to oldest" : "Oldest to newest";

  const toggleSortOrder = () => {
    setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"));
  };

  const renderItem = ({ item }) => {
    const dateLabel = formatDate(item.startedAt);
    const startLabel = formatTime(item.startedAt);
    const endLabel = formatTime(item.endedAt);

    return (
      <View style={styles.card}>
        <View style={styles.routeRow}>
          <MaterialCommunityIcons
            name="navigation-variant"
            size={18}
            color={C.brand}
            style={{ marginRight: 6 }}
          />
          <LCText style={styles.routeText} numberOfLines={1}>
            {item.routeLabel || "Route"}
          </LCText>
        </View>

        <LCText style={styles.dateText}>{dateLabel}</LCText>

        <View style={styles.timeRow}>
          <MaterialCommunityIcons
            name="clock-outline"
            size={16}
            color={C.sub}
          />
          <LCText style={styles.timeText}>
            {startLabel} – {endLabel}
          </LCText>
        </View>
      </View>
    );
  };

  const totalTrips = trips.length;

  // Function to save trips to AsyncStorage
  const saveTrips = async (newTrips) => {
    try {
      await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(newTrips));
    } catch (e) {
      console.log("[DriverTripHistory] Failed to save trips", e);
    }
  };

  // Add a new trip
  const addTrip = async (newTrip) => {
    const updatedTrips = [...trips, newTrip];
    setTrips(updatedTrips);
    await saveTrips(updatedTrips);  // Save trips after adding the new one
  };

  // Example function to simulate adding a new trip (replace this with your actual logic for a new trip)
  const handleAddNewTrip = () => {
    const newTrip = {
      id: `${new Date().getTime()}`,  // Unique ID based on current time
      driverId: driverId,            // Assuming `driverId` is already set
      startedAt: new Date().toISOString(), // Current time as the start time
      endedAt: null,                  // End time is null initially
      routeLabel: "Route A",          // Example route
    };

    // Call the addTrip function to add the new trip and save it
    addTrip(newTrip);
  };

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation?.goBack?.()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialCommunityIcons
            name="chevron-left"
            size={26}
            color={C.text}
          />
        </TouchableOpacity>
        <LCText style={styles.topTitle}>Trip history</LCText>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.summaryWrapper}>
        <View style={styles.summaryCard}>
          <View>
            <LCText style={styles.summaryLabel}>Trip summary</LCText>
            <LCText style={styles.summaryValue}>
              {totalTrips === 0 ? "—" : totalTrips}
            </LCText>
          </View>
          <View style={styles.summaryRight}>
            <MaterialCommunityIcons
              name="bus-clock"
              size={30}
              color="#FBBF24"
            />
          </View>
        </View>
      </View>

      <View style={styles.sortWrapper}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={toggleSortOrder}
          style={styles.sortPill}
        >
          <MaterialCommunityIcons
            name="filter-variant"
            size={16}
            color={C.text}
            style={{ marginRight: 6 }}
          />
          <LCText style={styles.sortText}>{sortLabel}</LCText>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={C.sub} />
        </View>
      ) : sortedTrips.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons
            name="clipboard-text-outline"
            size={42}
            color={C.sub}
            style={{ marginBottom: 10 }}
          />
          <LCText style={styles.emptyTitle}>No trip history</LCText>
          <LCText style={styles.emptySubtitle}>
            You currently have no recorded trips. Keep driving safely!
          </LCText>
        </View>
      ) : (
        <FlatList
          data={sortedTrips}
          keyExtractor={(item, idx) => item.id || `${item.startedAt}-${idx}`}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}

      {/* Example button to add a trip */}
      <TouchableOpacity onPress={handleAddNewTrip}>
        <LCText>Add New Trip</LCText>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    color: C.text,
    fontFamily: "Poppins_600SemiBold",
  },

  summaryWrapper: {
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  summaryCard: {
    backgroundColor: C.brand,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryLabel: {
    color: "#E5E7EB",
    fontSize: 12,
    fontFamily: "Poppins_600SemiBold",
  },
  summaryValue: {
    marginTop: 6,
    color: "#FFFFFF",
    fontSize: 22,
    fontFamily: "Poppins_700Bold",
  },
  summaryRight: {
    alignItems: "center",
    justifyContent: "center",
  },

  sortWrapper: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  sortPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sortText: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    color: C.text,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyTitle: {
    fontSize: 15,
    color: C.text,
    fontFamily: "Poppins_600SemiBold",
  },
  emptySubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: C.sub,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
  },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  routeText: {
    fontSize: 14,
    color: C.text,
    flex: 1,
    fontFamily: "Poppins_600SemiBold",
  },
  dateText: {
    fontSize: 12,
    color: C.sub,
    marginBottom: 4,
    fontFamily: "Poppins_400Regular",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  timeText: {
    marginLeft: 6,
    fontSize: 12,
    color: C.text,
    fontFamily: "Poppins_400Regular",
  },
});

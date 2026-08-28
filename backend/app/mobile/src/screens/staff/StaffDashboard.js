import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { getPickups } from "../../api/jobs";
import { getToken, getUser, removeToken, removeUser } from "../../utils/authStorage";

export default function StaffDashboard({ navigation }) {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ scheduled: 0, completed: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [storedUser, token] = await Promise.all([getUser(), getToken()]);
      setUser(storedUser);

      if (token) {
        try {
          const pickups = await getPickups(token);
          if (Array.isArray(pickups)) {
            let scheduled = 0;
            let active = 0;
            let completed = 0;
            pickups.forEach((p) => {
              if (p.status === "completed") completed += 1;
              else if (p.status === "in_progress") active += 1;
              else scheduled += 1;
            });
            setStats({ scheduled, completed, active });
          }
        } catch {
          // Non-critical telemetry fallback
        }
      }
    } catch (err) {
      console.error("Failed to load staff dashboard data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  const handleLogout = async () => {
    try {
      await removeToken();
      await removeUser();
      navigation.replace("Login");
    } catch (err) {
      console.error("Logout error:", err);
      Alert.alert("Logout Error", "Unable to log out. Please try again.");
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1B7A35" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#1B7A35"
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>GreenWave</Text>
            <Text style={styles.subtitle}>Recycling Operations</Text>
          </View>

          <TouchableOpacity
            onPress={handleLogout}
            style={styles.logoutHeaderBtn}
            activeOpacity={0.7}
            accessibilityLabel="Log out"
          >
            <Ionicons name="log-out-outline" size={24} color="#E53935" />
          </TouchableOpacity>
        </View>

        {/* Greeting */}
        <View style={styles.greeting}>
          <Text style={styles.greetingSmall}>Welcome back</Text>
          <Text style={styles.greetingName}>
            {user?.fullName || user?.username || "Staff"} 👋
          </Text>
        </View>

        {/* Create Pickup */}
        <TouchableOpacity
          style={styles.createCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("CreatePickup")}
        >
          <View style={styles.createIcon}>
            <Text style={styles.iconText}>📦</Text>
          </View>

          <View style={styles.createContent}>
            <Text style={styles.createTitle}>Create Pickup</Text>
            <Text style={styles.createSubtitle}>
              Schedule a new collection
            </Text>
          </View>

          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>

        {/* Today's Activity */}
        <Text style={styles.sectionTitle}>Today&apos;s Activity</Text>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>📅</Text>
            <Text style={styles.statNumber}>{stats.scheduled}</Text>
            <Text style={styles.statLabel}>Scheduled</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statIcon}>✓</Text>
            <Text style={styles.statNumber}>{stats.completed}</Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statIcon}>🚚</Text>
            <Text style={styles.statNumber}>{stats.active}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
        </View>

        {/* Menu */}
        <Text style={styles.sectionTitle}>Quick Access</Text>

        {/* Pickup History */}
        <TouchableOpacity
          style={styles.menuCard}
          activeOpacity={0.8}
          onPress={() => navigation.navigate("PickupHistory")}
        >
          <View style={styles.menuIcon}>
            <Text>📋</Text>
          </View>

          <View style={styles.menuContent}>
            <Text style={styles.menuTitle}>Pickup History</Text>
            <Text style={styles.menuSubtitle}>
              View previous collections
            </Text>
          </View>

          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        {/* Account Details */}
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Full Name</Text>
            <Text style={styles.detailValue}>{user?.fullName || "—"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Username</Text>
            <Text style={styles.detailValue}>{user?.username || "—"}</Text>
          </View>
          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Role</Text>
            <Text style={[styles.detailValue, styles.roleValue]}>
              {user?.role || "staff"}
            </Text>
          </View>
        </View>

        {/* Bottom Logout Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          activeOpacity={0.8}
          onPress={handleLogout}
        >
          <Ionicons
            name="log-out-outline"
            size={20}
            color="#E53935"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>

        {/* Bottom spacing */}
        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F4F8F5",
  },

  container: {
    flex: 1,
  },

  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  brand: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1B7A35",
  },

  subtitle: {
    fontSize: 13,
    color: "#718078",
    marginTop: 2,
  },

  notification: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    elevation: 2,
  },

  notificationText: {
    fontSize: 20,
  },

  greeting: {
    marginTop: 30,
    marginBottom: 20,
  },

  greetingSmall: {
    fontSize: 15,
    color: "#718078",
  },

  greetingName: {
    fontSize: 30,
    fontWeight: "800",
    color: "#17221A",
    marginTop: 4,
  },

  createCard: {
    backgroundColor: "#1B7A35",
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    elevation: 4,
  },

  createIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
    alignItems: "center",
  },

  iconText: {
    fontSize: 25,
  },

  createContent: {
    flex: 1,
    marginLeft: 15,
  },

  createTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },

  createSubtitle: {
    color: "#DCEFE1",
    fontSize: 13,
    marginTop: 4,
  },

  arrow: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "300",
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#17221A",
    marginTop: 28,
    marginBottom: 13,
  },

  statsRow: {
    flexDirection: "row",
    gap: 10,
  },

  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 15,
    elevation: 2,
  },

  statIcon: {
    fontSize: 18,
    marginBottom: 8,
  },

  statNumber: {
    fontSize: 24,
    fontWeight: "800",
    color: "#17221A",
  },

  statLabel: {
    fontSize: 12,
    color: "#718078",
    marginTop: 3,
  },

  menuCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    elevation: 2,
  },

  menuIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#EAF5EC",
    justifyContent: "center",
    alignItems: "center",
  },

  menuContent: {
    flex: 1,
    marginLeft: 14,
  },

  menuTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#17221A",
  },

  menuSubtitle: {
    fontSize: 12,
    color: "#718078",
    marginTop: 3,
  },

  menuArrow: {
    fontSize: 28,
    color: "#A0AAA3",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F4F8F5",
  },
  logoutHeaderBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    elevation: 2,
    borderWidth: 1,
    borderColor: "#FEE2E2",
  },
  detailsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    elevation: 2,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2EF",
  },
  detailLabel: {
    fontSize: 14,
    color: "#718078",
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#17221A",
  },
  roleValue: {
    textTransform: "capitalize",
    color: "#1B7A35",
  },
  logoutButton: {
    flexDirection: "row",
    height: 52,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FEE2E2",
    elevation: 1,
  },
  logoutButtonText: {
    color: "#E53935",
    fontSize: 16,
    fontWeight: "700",
  },
});
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

export default function AdminDashboard({ navigation }) {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ total: 0, pending: 0, inProgress: 0, completed: 0 });
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
            let pending = 0;
            let inProgress = 0;
            let completed = 0;
            pickups.forEach((p) => {
              if (p.status === "completed") completed += 1;
              else if (p.status === "in_progress") inProgress += 1;
              else pending += 1;
            });
            setStats({
              total: pickups.length,
              pending,
              inProgress,
              completed,
            });
          }
        } catch {
          // Telemetry fallback
        }
      }
    } catch (err) {
      console.error("Failed to load admin dashboard data:", err);
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
            <Text style={styles.brand}>GreenWave V2 • OTA LIVE</Text>
            <Text style={styles.subtitle}>Client Operations Administration</Text>
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

        {/* Greeting Banner */}
        <View style={styles.greeting}>
          <Text style={styles.greetingSmall}>Welcome back,</Text>
          <Text style={styles.greetingName}>
            {user?.fullName || user?.username || "Admin"} 👋
          </Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {(user?.role || "ADMIN").toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Operational Stats Grid */}
        <Text style={styles.sectionTitle}>Operations Overview</Text>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>📦</Text>
            <Text style={styles.statNumber}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total Pickups</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statIcon}>⏳</Text>
            <Text style={styles.statNumber}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statIcon}>🚚</Text>
            <Text style={styles.statNumber}>{stats.inProgress}</Text>
            <Text style={styles.statLabel}>In Progress</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statIcon}>✓</Text>
            <Text style={styles.statNumber}>{stats.completed}</Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>
        </View>

        {/* Action Hub */}
        <Text style={styles.sectionTitle}>Operational Hub</Text>

        {/* Create Pickup */}
        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("CreatePickup")}
        >
          <View style={[styles.actionIcon, { backgroundColor: "#EAF5EC" }]}>
            <Ionicons name="add-circle-outline" size={26} color="#1B7A35" />
          </View>
          <View style={styles.actionContent}>
            <Text style={styles.actionTitle}>Create Collection / Pickup</Text>
            <Text style={styles.actionSubtitle}>
              Schedule and dispatch a new material collection
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#A0AAA3" />
        </TouchableOpacity>

        {/* Pickup History */}
        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("PickupHistory")}
        >
          <View style={[styles.actionIcon, { backgroundColor: "#EBF3FF" }]}>
            <Ionicons name="list-outline" size={26} color="#2563EB" />
          </View>
          <View style={styles.actionContent}>
            <Text style={styles.actionTitle}>Pickup & Dispatch History</Text>
            <Text style={styles.actionSubtitle}>
              View and audit all scheduled, active, and completed jobs
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#A0AAA3" />
        </TouchableOpacity>

        {/* Driver Fleet View */}
        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("TodayJobs")}
        >
          <View style={[styles.actionIcon, { backgroundColor: "#FEF3C7" }]}>
            <Ionicons name="car-outline" size={26} color="#D97706" />
          </View>
          <View style={styles.actionContent}>
            <Text style={styles.actionTitle}>Driver Queue & Weight Entry</Text>
            <Text style={styles.actionSubtitle}>
              Access the driver job queue and submit collection weights
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#A0AAA3" />
        </TouchableOpacity>

        {/* Dispatcher Portal */}
        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("ManagerDashboard")}
        >
          <View style={[styles.actionIcon, { backgroundColor: "#F3E8FF" }]}>
            <Ionicons name="grid-outline" size={26} color="#7C3AED" />
          </View>
          <View style={styles.actionContent}>
            <Text style={styles.actionTitle}>Manager & Dispatcher Portal</Text>
            <Text style={styles.actionSubtitle}>
              Real-time Firestore warehouse, chat, and activity logs
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#A0AAA3" />
        </TouchableOpacity>

        {/* Account Details */}
        <Text style={styles.sectionTitle}>Account & System Status</Text>
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Admin Name</Text>
            <Text style={styles.detailValue}>{user?.fullName || "Ansh Rohit"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Email / Account</Text>
            <Text style={styles.detailValue}>{user?.username || user?.email || "—"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Assigned Role</Text>
            <Text style={[styles.detailValue, styles.roleValue]}>
              {user?.role || "admin"}
            </Text>
          </View>
          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Production REST API</Text>
            <Text style={styles.apiUrlValue}>gwgcservers.ca/api/v1</Text>
          </View>
        </View>

        {/* Logout Button */}
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
        <View style={{ height: 40 }} />
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F4F8F5",
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
  greeting: {
    marginTop: 24,
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
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  roleBadgeText: {
    color: "#16A34A",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#17221A",
    marginTop: 24,
    marginBottom: 14,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#EEF2EF",
  },
  statIcon: {
    fontSize: 20,
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
    marginTop: 4,
  },
  actionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#EEF2EF",
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  actionContent: {
    flex: 1,
    marginLeft: 14,
    marginRight: 8,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#17221A",
  },
  actionSubtitle: {
    fontSize: 12,
    color: "#718078",
    marginTop: 3,
    lineHeight: 16,
  },
  detailsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    elevation: 2,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#EEF2EF",
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
  apiUrlValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2563EB",
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
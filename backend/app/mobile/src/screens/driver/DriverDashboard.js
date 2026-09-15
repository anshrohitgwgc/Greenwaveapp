import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { getUser, removeToken, removeUser } from "../../utils/authStorage";

export default function DriverDashboard({ navigation }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const storedUser = await getUser();
        setUser(storedUser);
      } catch (error) {
        console.error("Failed to load driver profile:", error);
      } finally {
        setLoading(false);
      }
    };

    loadUserData();
  }, []);

  const handleLogout = async () => {
    try {
      await removeToken();
      await removeUser();
      navigation.replace("Login");
    } catch (error) {
      console.error("Logout error:", error);
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
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandSubtitle}>GREENWAVE</Text>
            <Text style={styles.headerTitle}>Driver Portal</Text>
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

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={28} color="#1B7A35" />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.userName}>{user?.fullName || "Driver"}</Text>
            <Text style={styles.userEmail}>{user?.email || "—"}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{user?.role || "driver"}</Text>
            </View>
          </View>
        </View>

        {/* Operations Section */}
        <Text style={styles.sectionTitle}>Operations</Text>

        {/* Today's Jobs Button */}
        <TouchableOpacity
          style={styles.jobsCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("TodayJobs")}
        >
          <View style={styles.jobsIconContainer}>
            <Ionicons name="calendar-outline" size={26} color="#FFFFFF" />
          </View>
          <View style={styles.jobsContent}>
            <Text style={styles.jobsTitle}>Today&apos;s Jobs</Text>
            <Text style={styles.jobsSubtitle}>
              View and manage your assigned pickups
            </Text>
          </View>
          <Text style={styles.jobsArrow}>›</Text>
        </TouchableOpacity>

        {/* Account Details Section */}
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Full Name</Text>
            <Text style={styles.detailValue}>{user?.fullName || "—"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Email</Text>
            <Text style={styles.detailValue}>{user?.email || "—"}</Text>
          </View>
          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Role</Text>
            <Text style={[styles.detailValue, styles.roleValue]}>
              {user?.role || "driver"}
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
    paddingBottom: 20,
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
    marginBottom: 20,
  },
  brandSubtitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#718078",
    letterSpacing: 2,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1B7A35",
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
  profileCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    elevation: 2,
    marginBottom: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: "#EAF5EC",
    justifyContent: "center",
    alignItems: "center",
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  greeting: {
    fontSize: 13,
    color: "#718078",
  },
  userName: {
    fontSize: 20,
    fontWeight: "800",
    color: "#17221A",
    marginTop: 2,
  },
  userEmail: {
    fontSize: 13,
    color: "#718078",
    marginTop: 2,
  },
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#EAF5EC",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 6,
  },
  roleText: {
    color: "#1B7A35",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#17221A",
    marginTop: 24,
    marginBottom: 12,
  },
  jobsCard: {
    backgroundColor: "#1B7A35",
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    elevation: 4,
  },
  jobsIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    justifyContent: "center",
    alignItems: "center",
  },
  jobsContent: {
    flex: 1,
    marginLeft: 14,
  },
  jobsTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  jobsSubtitle: {
    color: "#DCEFE1",
    fontSize: 13,
    marginTop: 3,
  },
  jobsArrow: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "300",
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
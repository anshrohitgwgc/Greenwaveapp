import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { getPickupById } from "../../api/jobs";
import { getToken, getUser } from "../../utils/authStorage";

export default function PickupDetails({ route, navigation }) {
  const { pickupId } = route.params;

  const [pickup, setPickup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const [error, setError] = useState("");

  const loadPickup = useCallback(async () => {
    try {
      setError("");
      const [token, currentUser] = await Promise.all([
        getToken(),
        getUser(),
      ]);

      if (currentUser?.role) {
        setUserRole(currentUser.role);
      }

      const data = await getPickupById(pickupId, token);
      setPickup(data);
    } catch (err) {
      console.error("Pickup details error:", err);
      const msg = err.message || "Something went wrong.";
      setError(msg);
      Alert.alert("Unable to Load Pickup", msg);
    } finally {
      setLoading(false);
    }
  }, [pickupId]);

  useEffect(() => {
    loadPickup();
  }, [loadPickup]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1B7A35" />
        <Text style={styles.loadingText}>
          Loading pickup details...
        </Text>
      </View>
    );
  }

  if (!pickup) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Pickup Not Found</Text>
        <Text style={styles.errorText}>
          {error || "We couldn't load this pickup."}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setLoading(true);
            loadPickup();
          }}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.backLinkButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backLinkText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Pickup #{pickup.id}</Text>
          <Text style={styles.subtitle}>
            Pickup information
          </Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            pickup.status === "completed"
              ? styles.completedBadge
              : styles.pendingBadge,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              pickup.status === "completed"
                ? styles.completedText
                : styles.pendingText,
            ]}
          >
            {pickup.status || "pending"}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Customer</Text>

        <Text style={styles.customerName}>
          {pickup.customerName}
        </Text>

        <Text style={styles.address}>
          📍 {pickup.address}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pickup Details</Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Material</Text>
          <Text style={styles.detailValue}>
            {pickup.materialType}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Estimated Weight
          </Text>
          <Text style={styles.detailValue}>
            {pickup.estimatedWeight
              ? `${pickup.estimatedWeight} kg`
              : "Not specified"}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Status</Text>
          <Text style={styles.detailValue}>
            {pickup.status || "pending"}
          </Text>
        </View>
      </View>

      {pickup.notes ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Notes</Text>

          <Text style={styles.notes}>
            {pickup.notes}
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Created</Text>

        <Text style={styles.date}>
          {new Date(pickup.createdAt).toLocaleString()}
        </Text>
      </View>

      {userRole === "driver" ? (
        <TouchableOpacity
          style={styles.driverActionButton}
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate("WeightEntry", {
              pickupId: pickup.id,
              pickup: pickup,
            })
          }
        >
          <Ionicons
            name="scale-outline"
            size={22}
            color="#FFFFFF"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.driverActionButtonText}>
            Update Weight & Status
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F8F5",
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  center: {
    flex: 1,
    backgroundColor: "#F4F8F5",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },

  loadingText: {
    marginTop: 12,
    color: "#718078",
    fontSize: 14,
  },

  errorTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#17221A",
  },

  errorText: {
    fontSize: 14,
    color: "#718078",
    marginTop: 6,
    textAlign: "center",
    marginBottom: 10,
  },

  retryButton: {
    backgroundColor: "#1B7A35",
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
    marginTop: 12,
  },

  retryText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  backLinkButton: {
    paddingVertical: 10,
    marginTop: 6,
  },

  backLinkText: {
    color: "#1B7A35",
    fontWeight: "600",
    fontSize: 14,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },

  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1B7A35",
  },

  subtitle: {
    fontSize: 13,
    color: "#718078",
    marginTop: 3,
  },

  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },

  pendingBadge: {
    backgroundColor: "#FFF4D6",
  },

  completedBadge: {
    backgroundColor: "#E5F5E9",
  },

  statusText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "capitalize",
  },

  pendingText: {
    color: "#9A6A00",
  },

  completedText: {
    color: "#1B7A35",
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    marginBottom: 14,
    elevation: 2,
  },

  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#718078",
    marginBottom: 12,
  },

  customerName: {
    fontSize: 21,
    fontWeight: "800",
    color: "#17221A",
    marginBottom: 8,
  },

  address: {
    fontSize: 15,
    color: "#536158",
  },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 11,
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

  notes: {
    fontSize: 15,
    lineHeight: 22,
    color: "#536158",
  },

  date: {
    fontSize: 14,
    color: "#536158",
  },

  bottomSpace: {
    height: 20,
  },

  driverActionButton: {
    flexDirection: "row",
    height: 54,
    backgroundColor: "#1B7A35",
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 10,
    elevation: 3,
  },

  driverActionButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});

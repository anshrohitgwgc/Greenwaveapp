import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { getPickups } from "../../api/jobs";
import { getToken } from "../../utils/authStorage";

export default function PickupHistory({ navigation }) {
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadPickups = useCallback(async () => {
    try {
      setError("");
      const token = await getToken();
      const data = await getPickups(token);
      setPickups(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Pickup history error:", err);
      const msg = err.message || "Unable to load pickups.";
      setError(msg);
      Alert.alert("Unable to Load Pickups", msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPickups();
  };

  const handleRetry = () => {
    setLoading(true);
    loadPickups();
  };

  useEffect(() => {
    loadPickups();
  }, [loadPickups]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1B7A35" />
        <Text style={styles.loadingText}>Loading pickups...</Text>
      </View>
    );
  }

  if (error && pickups.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Unable to Load Pickups</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor="#1B7A35"
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Pickup History</Text>

      <Text style={styles.subtitle}>
        All pickups created by GreenWave staff.
      </Text>

      {pickups.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📦</Text>

          <Text style={styles.emptyTitle}>No Pickups Yet</Text>

          <Text style={styles.emptyText}>
            Pickups created by staff will appear here.
          </Text>
        </View>
      ) : (
        pickups.map((pickup) => (
          <TouchableOpacity
            style={styles.card}
            key={pickup.id}
            activeOpacity={0.8}
            onPress={() =>
              navigation.navigate("PickupDetails", {
                pickupId: pickup.id,
              })
            }
          >
            <View style={styles.cardHeader}>
              <Text style={styles.pickupNumber}>
                Pickup #{pickup.id}
              </Text>

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

            <View style={styles.customerRow}>
              <View style={styles.customerContent}>
                <Text style={styles.customerName}>
                  {pickup.customerName}
                </Text>

                <Text style={styles.address}>
                  📍 {pickup.address}
                </Text>
              </View>

              <Text style={styles.cardArrow}>›</Text>
            </View>

            <View style={styles.detailsRow}>
              <View style={styles.detail}>
                <Text style={styles.detailLabel}>Material</Text>

                <Text style={styles.detailValue}>
                  {pickup.materialType}
                </Text>
              </View>

              <View style={styles.detail}>
                <Text style={styles.detailLabel}>Weight</Text>

                <Text style={styles.detailValue}>
                  {pickup.estimatedWeight
                    ? `${pickup.estimatedWeight} kg`
                    : "Not specified"}
                </Text>
              </View>
            </View>

            {pickup.notes ? (
              <View style={styles.notesBox}>
                <Text style={styles.notesLabel}>Notes</Text>

                <Text style={styles.notesText}>
                  {pickup.notes}
                </Text>
              </View>
            ) : null}

            <Text style={styles.date}>
              Created {new Date(pickup.createdAt).toLocaleString()}
            </Text>
          </TouchableOpacity>
        ))
      )}
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
    padding: 24,
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
    color: "#718078",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },

  retryButton: {
    backgroundColor: "#1B7A35",
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 13,
    marginTop: 20,
  },

  retryText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#1B7A35",
    marginBottom: 6,
  },

  subtitle: {
    fontSize: 14,
    color: "#718078",
    marginBottom: 24,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    elevation: 2,
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  pickupNumber: {
    fontSize: 14,
    fontWeight: "700",
    color: "#718078",
  },

  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
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

  customerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },

  customerContent: {
    flex: 1,
  },

  customerName: {
    fontSize: 19,
    fontWeight: "800",
    color: "#17221A",
    marginBottom: 8,
  },

  address: {
    fontSize: 14,
    color: "#536158",
  },

  cardArrow: {
    fontSize: 32,
    color: "#A0AAA3",
    marginLeft: 10,
  },

  detailsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#EEF2EF",
    paddingTop: 14,
  },

  detail: {
    flex: 1,
  },

  detailLabel: {
    fontSize: 12,
    color: "#8A948D",
    marginBottom: 4,
  },

  detailValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#17221A",
  },

  notesBox: {
    backgroundColor: "#F7FAF7",
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },

  notesLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#718078",
    marginBottom: 4,
  },

  notesText: {
    fontSize: 13,
    color: "#536158",
  },

  date: {
    fontSize: 11,
    color: "#9AA39D",
    marginTop: 14,
  },

  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 35,
    alignItems: "center",
    marginTop: 20,
  },

  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },

  emptyTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#17221A",
    marginBottom: 6,
  },

  emptyText: {
    fontSize: 14,
    color: "#718078",
    textAlign: "center",
  },
}); 

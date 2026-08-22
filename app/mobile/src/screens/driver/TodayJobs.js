import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { getMyDriverPickups } from "../../api/jobs";
import { getToken } from "../../utils/authStorage";

export default function TodayJobs({ navigation }) {
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      setError("");
      const token = await getToken();
      const jobs = await getMyDriverPickups(token);
      setPickups(jobs);
    } catch (requestError) {
      setError(requestError.message || "Unable to load your assigned jobs.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const retry = () => {
    setLoading(true);
    loadJobs();
  };

  const refresh = () => {
    setRefreshing(true);
    loadJobs();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1B7A35" />
        <Text style={styles.loadingText}>Loading your jobs...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Unable to Load Jobs</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={retry}>
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
          onRefresh={refresh}
          tintColor="#1B7A35"
        />
      }
    >
      <Text style={styles.title}>Today&apos;s Jobs</Text>
      <Text style={styles.subtitle}>Your assigned GreenWave pickups.</Text>

      {pickups.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyTitle}>No Assigned Jobs</Text>
          <Text style={styles.emptyText}>
            You do not have any pickups assigned right now.
          </Text>
        </View>
      ) : (
        pickups.map((pickup) => (
          <TouchableOpacity
            key={pickup.id}
            style={styles.card}
            activeOpacity={0.8}
            onPress={() =>
              navigation.navigate("PickupDetails", { pickupId: pickup.id })
            }
          >
            <View style={styles.cardHeader}>
              <Text style={styles.pickupNumber}>Pickup #{pickup.id}</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>{pickup.status || "pending"}</Text>
              </View>
            </View>
            <Text style={styles.customerName}>{pickup.customerName}</Text>
            <Text style={styles.address}>📍 {pickup.address}</Text>
            <View style={styles.detailsRow}>
              <View style={styles.detail}>
                <Text style={styles.detailLabel}>Material</Text>
                <Text style={styles.detailValue}>{pickup.materialType}</Text>
              </View>
              <View style={styles.detail}>
                <Text style={styles.detailLabel}>Estimated weight</Text>
                <Text style={styles.detailValue}>
                  {pickup.estimatedWeight ? `${pickup.estimatedWeight} kg` : "Not specified"}
                </Text>
              </View>
            </View>
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
  container: { flex: 1, backgroundColor: "#F4F8F5" },
  content: { padding: 20, paddingBottom: 40, flexGrow: 1 },
  center: { flex: 1, backgroundColor: "#F4F8F5", justifyContent: "center", alignItems: "center", padding: 24 },
  loadingText: { marginTop: 12, color: "#718078", fontSize: 14 },
  title: { fontSize: 30, fontWeight: "800", color: "#1B7A35", marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#718078", marginBottom: 24 },
  errorTitle: { fontSize: 22, fontWeight: "800", color: "#17221A" },
  errorText: { color: "#718078", textAlign: "center", marginTop: 8, lineHeight: 20 },
  retryButton: { backgroundColor: "#1B7A35", borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13, marginTop: 20 },
  retryText: { color: "#FFFFFF", fontWeight: "700" },
  emptyCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 28, alignItems: "center", marginTop: 10, elevation: 2 },
  emptyIcon: { fontSize: 34, color: "#1B7A35", marginBottom: 8 },
  emptyTitle: { fontSize: 19, fontWeight: "800", color: "#17221A" },
  emptyText: { color: "#718078", textAlign: "center", marginTop: 7, lineHeight: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18, marginBottom: 14, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  pickupNumber: { fontSize: 14, fontWeight: "700", color: "#718078" },
  statusBadge: { backgroundColor: "#FFF4D6", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusText: { color: "#9A6A00", fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  customerName: { fontSize: 19, fontWeight: "800", color: "#17221A", marginBottom: 8 },
  address: { fontSize: 14, color: "#536158", marginBottom: 16 },
  detailsRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#EEF2EF", paddingTop: 14 },
  detail: { flex: 1 },
  detailLabel: { fontSize: 12, color: "#718078", marginBottom: 4 },
  detailValue: { fontSize: 14, fontWeight: "700", color: "#17221A" },
  date: { color: "#8A948D", fontSize: 12, marginTop: 16 },
});

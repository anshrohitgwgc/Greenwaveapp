import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { getPickupById, updatePickup } from "../../api/jobs";
import { getToken } from "../../utils/authStorage";

export default function WeightEntry({ route, navigation }) {
  const pickupParam = route?.params?.pickup;
  const pickupId =
    route?.params?.pickupId ||
    route?.params?.id ||
    route?.params?.jobId ||
    pickupParam?.id;

  const [pickup, setPickup] = useState(pickupParam || null);
  const [actualWeight, setActualWeight] = useState(
    pickupParam?.actualWeight ? String(pickupParam.actualWeight) : ""
  );
  const [loading, setLoading] = useState(!pickupParam);
  const [submittingAction, setSubmittingAction] = useState(null);
  const [error, setError] = useState("");

  const loadPickup = useCallback(async () => {
    if (!pickupId) {
      setError("No valid pickup ID was provided.");
      setLoading(false);
      return;
    }

    try {
      setError("");
      const token = await getToken();
      if (!token) {
        setError("You must be signed in to view pickup details.");
        return;
      }

      const data = await getPickupById(pickupId, token);
      setPickup(data);
      if (data.actualWeight && !actualWeight) {
        setActualWeight(String(data.actualWeight));
      }
    } catch (err) {
      setError(err.message || "Unable to load pickup details.");
    } finally {
      setLoading(false);
    }
  }, [pickupId, actualWeight]);

  useEffect(() => {
    if (!pickupParam) {
      loadPickup();
    }
  }, [loadPickup, pickupParam]);

  const handleStartPickup = async () => {
    if (submittingAction) return;

    try {
      setSubmittingAction("start");
      const token = await getToken();
      if (!token) {
        Alert.alert("Authentication Required", "Please sign in again to continue.");
        return;
      }

      await updatePickup(pickupId, { status: "in_progress" }, token);
      setPickup((prev) => (prev ? { ...prev, status: "in_progress" } : prev));
      Alert.alert("Pickup Started", "Pickup status has been updated to in progress.");
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to start pickup.");
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleCompletePickup = async () => {
    if (submittingAction) return;

    const trimmedWeight = actualWeight.trim();
    const weightNum = parseFloat(trimmedWeight);

    if (!trimmedWeight || isNaN(weightNum) || weightNum <= 0) {
      Alert.alert(
        "Invalid Weight",
        "Please enter a valid weight greater than 0 kg before completing the pickup."
      );
      return;
    }

    try {
      setSubmittingAction("complete");
      const token = await getToken();
      if (!token) {
        Alert.alert("Authentication Required", "Please sign in again to continue.");
        return;
      }

      await updatePickup(
        pickupId,
        {
          actualWeight: weightNum,
          status: "completed",
        },
        token
      );

      Alert.alert(
        "Pickup Completed",
        `Pickup #${pickupId} has been successfully completed with ${weightNum} kg.`,
        [
          {
            text: "OK",
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to complete pickup.");
    } finally {
      setSubmittingAction(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1B7A35" />
        <Text style={styles.loadingText}>Loading pickup details...</Text>
      </View>
    );
  }

  if (error || !pickup) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Unable to Load Pickup</Text>
        <Text style={styles.errorText}>
          {error || "Pickup details could not be found."}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => (pickupId ? loadPickup() : navigation.goBack())}
        >
          <Text style={styles.retryText}>{pickupId ? "Try Again" : "Go Back"}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isCompleted = pickup.status === "completed";
  const isInProgress = pickup.status === "in_progress";
  const isPending = !isInProgress && !isCompleted;

  const statusBadgeStyle = isCompleted
    ? styles.completedBadge
    : isInProgress
    ? styles.inProgressBadge
    : styles.pendingBadge;

  const statusTextStyle = isCompleted
    ? styles.completedText
    : isInProgress
    ? styles.inProgressText
    : styles.pendingText;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerSubtitle}>GREENWAVE DRIVER</Text>
            <Text style={styles.headerTitle}>Pickup #{pickup.id}</Text>
          </View>
          <View style={[styles.statusBadge, statusBadgeStyle]}>
            <Text style={[styles.statusText, statusTextStyle]}>
              {pickup.status || "pending"}
            </Text>
          </View>
        </View>

        {/* Customer Information Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Customer &amp; Location</Text>
          <Text style={styles.customerName}>{pickup.customerName || "—"}</Text>
          <Text style={styles.address}>📍 {pickup.address || "No address provided"}</Text>
        </View>

        {/* Pickup Details Card (Read-Only) */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pickup Specifications</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Material Type</Text>
            <Text style={styles.detailValue}>{pickup.materialType || "—"}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Estimated Weight</Text>
            <Text style={styles.detailValue}>
              {pickup.estimatedWeight ? `${pickup.estimatedWeight} kg` : "Not specified"}
            </Text>
          </View>

          {pickup.notes ? (
            <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.detailLabel}>Notes</Text>
              <Text style={[styles.detailValue, styles.notesText]}>{pickup.notes}</Text>
            </View>
          ) : null}
        </View>

        {/* Actions / Weight Entry Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pickup Execution</Text>

          {/* Start Pickup Action */}
          {isPending ? (
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.startButton,
                submittingAction && styles.buttonDisabled,
              ]}
              onPress={handleStartPickup}
              disabled={!!submittingAction}
              activeOpacity={0.8}
            >
              {submittingAction === "start" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons
                    name="play-outline"
                    size={20}
                    color="#FFFFFF"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.actionButtonText}>Start Pickup</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}

          {/* Actual Weight Input */}
          <Text style={styles.inputLabel}>Actual Weight (kg)</Text>
          <TextInput
            style={[styles.input, isCompleted && styles.inputDisabled]}
            placeholder="Enter measured weight (e.g. 25.5)"
            placeholderTextColor="#8A8A8A"
            value={actualWeight}
            onChangeText={setActualWeight}
            keyboardType="numeric"
            editable={!isCompleted && !submittingAction}
            returnKeyType="done"
          />

          {/* Complete Pickup Action */}
          {!isCompleted ? (
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.completeButton,
                submittingAction && styles.buttonDisabled,
              ]}
              onPress={handleCompletePickup}
              disabled={!!submittingAction}
              activeOpacity={0.8}
            >
              {submittingAction === "complete" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={20}
                    color="#FFFFFF"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.actionButtonText}>Complete Pickup</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.completedNotice}>
              <Ionicons
                name="checkmark-circle"
                size={22}
                color="#1B7A35"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.completedNoticeText}>
                This pickup has been completed.
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F8F5",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#718078",
    letterSpacing: 1.5,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1B7A35",
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pendingBadge: {
    backgroundColor: "#FFF4D6",
  },
  inProgressBadge: {
    backgroundColor: "#DBEAFE",
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
  inProgressText: {
    color: "#1D4ED8",
  },
  completedText: {
    color: "#1B7A35",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#718078",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  customerName: {
    fontSize: 20,
    fontWeight: "800",
    color: "#17221A",
    marginBottom: 6,
  },
  address: {
    fontSize: 15,
    color: "#536158",
    lineHeight: 22,
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
  notesText: {
    flex: 1,
    textAlign: "right",
    marginLeft: 16,
    fontWeight: "400",
    color: "#536158",
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#17221A",
    marginBottom: 8,
    marginTop: 6,
  },
  input: {
    height: 54,
    backgroundColor: "#FAFCFA",
    borderWidth: 1,
    borderColor: "#D5DDD7",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#17221A",
    marginBottom: 16,
  },
  inputDisabled: {
    backgroundColor: "#F3F4F6",
    color: "#9CA3AF",
  },
  actionButton: {
    height: 52,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  startButton: {
    backgroundColor: "#0284C7",
  },
  completeButton: {
    backgroundColor: "#1B7A35",
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  completedNotice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAF5EC",
    padding: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  completedNoticeText: {
    color: "#1B7A35",
    fontSize: 14,
    fontWeight: "600",
  },
});
import { useState } from "react";
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

import { createPickup } from "../../api/jobs";
import { getToken } from "../../utils/authStorage";

export default function CreatePickup({ navigation }) {
  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [estimatedWeight, setEstimatedWeight] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleCreatePickup = async () => {
    setErrorMessage("");
    setSuccessMessage("");

    if (!customerName.trim()) {
      const msg = "Please enter the customer name.";
      setErrorMessage(msg);
      Alert.alert("Missing Information", msg);
      return;
    }

    if (!address.trim()) {
      const msg = "Please enter the pickup address.";
      setErrorMessage(msg);
      Alert.alert("Missing Information", msg);
      return;
    }

    if (!materialType.trim()) {
      const msg = "Please enter the material type.";
      setErrorMessage(msg);
      Alert.alert("Missing Information", msg);
      return;
    }

    try {
      setLoading(true);

      const token = await getToken();
      const pickup = await createPickup({
        customerName: customerName.trim(),
        address: address.trim(),
        materialType: materialType.trim(),
        estimatedWeight: estimatedWeight
          ? Number(estimatedWeight)
          : null,
        notes: notes.trim() || null,
      }, token);

      setSuccessMessage(`Pickup #${pickup.id} has been successfully created.`);
      Alert.alert(
        "Pickup Created",
        `Pickup #${pickup.id} has been successfully created.`,
        [
          {
            text: "OK",
            onPress: () => navigation.goBack(),
          },
        ]
      );

      setCustomerName("");
      setAddress("");
      setMaterialType("");
      setEstimatedWeight("");
      setNotes("");
    } catch (error) {
      console.error("Create pickup error:", error);
      const msg = error.message || "Something went wrong. Please try again.";
      setErrorMessage(msg);
      Alert.alert("Unable to Create Pickup", msg);
    } finally {
      setLoading(false);
    }
  };

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
        automaticallyAdjustKeyboardInsets={true}
      >
        <Text style={styles.title}>Create Pickup</Text>

        <Text style={styles.subtitle}>
          Enter the customer&apos;s pickup information.
        </Text>

        {errorMessage ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {successMessage ? (
          <View style={styles.successContainer}>
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Customer Name</Text>

        <TextInput
          placeholder="Customer Name"
          placeholderTextColor="#8A8A8A"
          style={styles.input}
          value={customerName}
          onChangeText={setCustomerName}
          editable={!loading}
          returnKeyType="next"
        />

        <Text style={styles.label}>Pickup Address</Text>

        <TextInput
          placeholder="Pickup Address"
          placeholderTextColor="#8A8A8A"
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          editable={!loading}
          returnKeyType="next"
        />

        <Text style={styles.label}>Material Type</Text>

        <TextInput
          placeholder="e.g. Metal, Plastic, Cardboard"
          placeholderTextColor="#8A8A8A"
          style={styles.input}
          value={materialType}
          onChangeText={setMaterialType}
          editable={!loading}
          returnKeyType="next"
        />

        <Text style={styles.label}>Estimated Weight</Text>

        <TextInput
          placeholder="Estimated Weight (kg)"
          placeholderTextColor="#8A8A8A"
          style={styles.input}
          keyboardType="numeric"
          value={estimatedWeight}
          onChangeText={setEstimatedWeight}
          editable={!loading}
          returnKeyType="next"
        />

        <Text style={styles.label}>Notes</Text>

        <TextInput
          placeholder="Additional pickup information"
          placeholderTextColor="#8A8A8A"
          style={[styles.input, styles.notes]}
          multiline
          value={notes}
          onChangeText={setNotes}
          editable={!loading}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleCreatePickup}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Create Pickup</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.bottomText}>
          Pickup information will be sent to the dispatch system.
        </Text>
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
    padding: 20,
    paddingTop: 24,
    paddingBottom: 80,
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
    marginBottom: 28,
  },

  label: {
    fontSize: 14,
    fontWeight: "700",
    color: "#17221A",
    marginBottom: 7,
  },

  input: {
    minHeight: 54,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D5DDD7",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#17221A",
    marginBottom: 18,
  },

  notes: {
    height: 120,
    paddingTop: 15,
    paddingBottom: 15,
  },

  button: {
    height: 56,
    backgroundColor: "#1B7A35",
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },

  buttonDisabled: {
    opacity: 0.7,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },

  bottomText: {
    textAlign: "center",
    color: "#8A948D",
    fontSize: 12,
    marginTop: 16,
  },
  errorContainer: {
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: {
    color: "#DC2626",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  successContainer: {
    backgroundColor: "#DCFCE7",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  successText: {
    color: "#16A34A",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});

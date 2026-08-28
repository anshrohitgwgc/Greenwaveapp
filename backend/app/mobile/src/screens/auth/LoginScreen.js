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

import { login } from "../../api/greenwave";
import { saveToken, saveUser } from "../../utils/authStorage";

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleLogin = async () => {
    setErrorMessage("");

    if (!email.trim() || !password) {
      const msg = "Please enter your email address and password.";
      setErrorMessage(msg);
      Alert.alert("Missing Information", msg);
      return;
    }

    try {
      setLoading(true);

      const data = await login(email.trim(), password);

      await saveToken(data.access_token || data.token || "session_authenticated");

      const user = data.user;
      await saveUser(user);

      const role = (user?.role || "").toLowerCase();
      switch (role) {
        case "admin":
        case "superadmin":
        case "infraadmin":
          navigation.replace("AdminDashboard");
          break;

        case "manager":
          navigation.replace("ManagerDashboard");
          break;

        case "staff":
        case "readonlyauditor":
          navigation.replace("StaffDashboard");
          break;

        case "driver":
          navigation.replace("DriverDashboard");
          break;

        default:
          navigation.replace("StaffDashboard");
      }
    } catch (error) {
      console.error("Login error:", error);
      const displayMsg = error.message || "Invalid username or password.";
      setErrorMessage(displayMsg);

      Alert.alert(
        "Login Failed",
        displayMsg
      );
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
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets={true}
      >
        <View style={styles.header}>
          <Text style={styles.logo}>GreenWave</Text>

          <Text style={styles.brand}>RECYCLING</Text>

          <Text style={styles.subtitle}>Employee Portal</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Welcome Back</Text>

          <Text style={styles.description}>
            Sign in with your GreenWave employee account.
          </Text>

          {errorMessage ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Email Address</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter your email address"
            placeholderTextColor="#8A8A8A"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (errorMessage) setErrorMessage("");
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            returnKeyType="next"
          />

          <Text style={styles.label}>Password</Text>

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#8A8A8A"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (errorMessage) setErrorMessage("");
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>
          GreenWave employees only
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

  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
  },

  header: {
    alignItems: "center",
    marginBottom: 30,
  },

  logo: {
    fontSize: 38,
    fontWeight: "800",
    color: "#1B7A35",
  },

  brand: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 4,
    color: "#2E7D32",
    marginTop: -3,
  },

  subtitle: {
    fontSize: 15,
    color: "#68736B",
    marginTop: 10,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,

    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 5,
    },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 5,
  },

  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#17221A",
    marginBottom: 8,
  },

  description: {
    fontSize: 14,
    color: "#68736B",
    marginBottom: 22,
    lineHeight: 20,
  },

  errorContainer: {
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },

  errorText: {
    color: "#B91C1C",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },

  label: {
    fontSize: 14,
    fontWeight: "700",
    color: "#17221A",
    marginBottom: 7,
  },

  input: {
    height: 54,
    borderWidth: 1,
    borderColor: "#D5DDD7",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#17221A",
    backgroundColor: "#FAFCFA",
    marginBottom: 18,
  },

  button: {
    height: 54,
    borderRadius: 12,
    backgroundColor: "#1B7A35",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },

  buttonDisabled: {
    opacity: 0.7,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },

  footer: {
    textAlign: "center",
    marginTop: 24,
    color: "#7A857D",
    fontSize: 13,
  },
});

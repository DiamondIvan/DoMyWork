import {
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { COLORS } from "../constants/theme";

export default function LoginScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <View style={styles.circle}>
          <Text style={styles.crowIcon}>🐦</Text>
        </View>
        <Text style={styles.logoText}>Crow AI</Text>
        <Text style={styles.subText}>Never miss a task</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Create an account</Text>
        <Text style={styles.description}>
          Enter your email to sign up for this app
        </Text>

        <TextInput
          style={styles.input}
          placeholder="email@domain.com"
          placeholderTextColor="#ccc"
        />

        <TouchableOpacity style={styles.btnContinue}>
          <Text style={styles.btnContinueText}>Continue</Text>
        </TouchableOpacity>

        <Text style={styles.divider}>or</Text>

        <TouchableOpacity style={styles.btnGoogle}>
          <Text style={styles.btnGoogleText}>🔍 Continue with Google</Text>
        </TouchableOpacity>

        <Text style={styles.terms}>
          By clicking continue, you agree to our{" "}
          <Text style={{ color: COLORS.primary }}>Terms of Service</Text> and{" "}
          <Text style={{ color: COLORS.primary }}>Privacy Policy</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 30,
    justifyContent: "center",
    paddingBottom: 50,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 50,
  },
  circle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.secondary,
  },
  crowIcon: { fontSize: 50 },
  logoText: {
    fontSize: 28,
    fontWeight: "bold",
    color: COLORS.primary,
    marginTop: 20,
  },
  subText: {
    color: COLORS.textGray,
    fontSize: 14,
    marginTop: 5,
  },
  form: {
    width: "100%",
  },
  label: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.darkGray,
    marginBottom: 5,
  },
  description: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 14,
    borderRadius: 10,
    marginBottom: 15,
    fontSize: 14,
    backgroundColor: "#f9f9f9",
  },
  btnContinue: {
    backgroundColor: "#000",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 15,
  },
  btnContinueText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  divider: {
    textAlign: "center",
    color: "#ccc",
    marginVertical: 12,
    fontSize: 12,
  },
  btnGoogle: {
    borderWidth: 1.5,
    borderColor: "#ddd",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#f9f9f9",
  },
  btnGoogleText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.darkGray,
  },
  terms: {
    fontSize: 11,
    color: COLORS.textGray,
    marginTop: 15,
    textAlign: "center",
    lineHeight: 16,
  },
});

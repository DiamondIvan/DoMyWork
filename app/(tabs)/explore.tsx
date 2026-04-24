import * as AuthSession from "expo-auth-session";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";

import { ExternalLink } from "@/components/external-link";
import ParallaxScrollView from "@/components/parallax-scroll-view";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Collapsible } from "@/components/ui/collapsible";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Fonts } from "@/constants/theme";
import { useThemeColor } from "@/hooks/use-theme-color";

WebBrowser.maybeCompleteAuthSession();

const googleDiscovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
};

export default function TabTwoScreen() {
  const tint = useThemeColor({}, "tint");
  const textColor = useThemeColor({}, "text");
  const backgroundColor = useThemeColor({}, "background");
  const iconColor = useThemeColor({}, "icon");

  const [userId, setUserId] = useState("");
  const [statusText, setStatusText] = useState<string>("");
  const [isWorking, setIsWorking] = useState(false);

  const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "";
  const functionsBaseUrl = (
    process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ?? ""
  ).replace(/\/$/, "");
  const redirectUri = useMemo(() => {
    // In Expo Go, the proxy redirect is the easiest path.
    // If you need to force a specific redirect URI (e.g., one you registered in Google Cloud Console),
    // set EXPO_PUBLIC_GOOGLE_OAUTH_REDIRECT_URI.
    return (
      process.env.EXPO_PUBLIC_GOOGLE_OAUTH_REDIRECT_URI ??
      AuthSession.makeRedirectUri({
        // @ts-expect-error - `useProxy` exists in Expo AuthSession runtime, but may be missing from types
        useProxy: true,
      })
    );
  }, []);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: googleClientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      extraParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
    googleDiscovery,
  );

  async function connectGoogle() {
    setStatusText("");

    if (!googleClientId) {
      setStatusText("Missing EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID");
      return;
    }
    if (!functionsBaseUrl) {
      setStatusText("Missing EXPO_PUBLIC_FUNCTIONS_BASE_URL");
      return;
    }
    if (!userId.trim()) {
      setStatusText("Please enter a userId (Firestore document id).");
      return;
    }

    setIsWorking(true);
    try {
      const authResult = await promptAsync({
        // @ts-expect-error - `useProxy` exists in Expo AuthSession runtime, but may be missing from types
        useProxy: true,
      });

      if (authResult.type !== "success") {
        setStatusText(`Login cancelled (${authResult.type}).`);
        return;
      }

      const code = authResult.params?.code;
      if (!code) {
        setStatusText("Google did not return an authorization code.");
        return;
      }

      const res = await fetch(`${functionsBaseUrl}/exchangeGoogleCode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId.trim(),
          code,
          redirectUri,
        }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setStatusText(json?.error ?? `Exchange failed (${res.status}).`);
        return;
      }

      if (json?.hasRefreshToken) {
        setStatusText("Connected! Refresh token stored in Firestore.");
      } else {
        setStatusText(
          "Connected, but Google did not return a refresh token. Try again after revoking access, or ensure prompt=consent and access_type=offline.",
        );
      }
    } catch (e: any) {
      setStatusText(e?.message ?? "Unexpected error during connect.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: "#D0D0D0", dark: "#353636" }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }
    >
      <ThemedView style={styles.titleContainer}>
        <ThemedText
          type="title"
          style={{
            fontFamily: Fonts.rounded,
          }}
        >
          Explore
        </ThemedText>
      </ThemedView>
      <ThemedText>
        This app includes example code to help you get started.
      </ThemedText>
      <Collapsible title="File-based routing">
        <ThemedText>
          This app has two screens:{" "}
          <ThemedText type="defaultSemiBold">app/(tabs)/index.tsx</ThemedText>{" "}
          and{" "}
          <ThemedText type="defaultSemiBold">app/(tabs)/explore.tsx</ThemedText>
        </ThemedText>
        <ThemedText>
          The layout file in{" "}
          <ThemedText type="defaultSemiBold">app/(tabs)/_layout.tsx</ThemedText>{" "}
          sets up the tab navigator.
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/router/introduction">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>

      <Collapsible title="Connect Google (Gmail + Calendar)">
        <ThemedText>
          This stores a Google refresh token in Firestore so the Firebase
          Function can call Gmail and Calendar.
        </ThemedText>

        <ThemedText type="defaultSemiBold" style={{ marginTop: 8 }}>
          userId
        </ThemedText>
        <TextInput
          value={userId}
          onChangeText={setUserId}
          placeholder="e.g. telegram_123456"
          placeholderTextColor={iconColor}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.input,
            {
              color: textColor,
              borderColor: tint,
              backgroundColor,
            },
          ]}
        />

        <View style={{ marginTop: 12, gap: 8 }}>
          <Pressable
            disabled={!request || isWorking}
            onPress={connectGoogle}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: tint,
                opacity: !request || isWorking ? 0.6 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <ThemedText type="defaultSemiBold" style={{ color: "#fff" }}>
              {isWorking ? "Working..." : "Connect Google"}
            </ThemedText>
          </Pressable>

          {!!response && response.type !== "dismiss" ? (
            <ThemedText style={{ flex: 1 }}>
              Last result:{" "}
              <ThemedText type="defaultSemiBold">{response.type}</ThemedText>
            </ThemedText>
          ) : null}
        </View>

        {!!statusText ? (
          <ThemedText style={{ marginTop: 8 }}>{statusText}</ThemedText>
        ) : null}
      </Collapsible>
      <Collapsible title="Android, iOS, and web support">
        <ThemedText>
          You can open this project on Android, iOS, and the web. To open the
          web version, press <ThemedText type="defaultSemiBold">w</ThemedText>{" "}
          in the terminal running this project.
        </ThemedText>
      </Collapsible>
      <Collapsible title="Images">
        <ThemedText>
          For static images, you can use the{" "}
          <ThemedText type="defaultSemiBold">@2x</ThemedText> and{" "}
          <ThemedText type="defaultSemiBold">@3x</ThemedText> suffixes to
          provide files for different screen densities
        </ThemedText>
        <Image
          source={require("@/assets/images/react-logo.png")}
          style={{ width: 100, height: 100, alignSelf: "center" }}
        />
        <ExternalLink href="https://reactnative.dev/docs/images">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Light and dark mode components">
        <ThemedText>
          This template has light and dark mode support. The{" "}
          <ThemedText type="defaultSemiBold">useColorScheme()</ThemedText> hook
          lets you inspect what the user&apos;s current color scheme is, and so
          you can adjust UI colors accordingly.
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/develop/user-interface/color-themes/">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Animations">
        <ThemedText>
          This template includes an example of an animated component. The{" "}
          <ThemedText type="defaultSemiBold">
            components/HelloWave.tsx
          </ThemedText>{" "}
          component uses the powerful{" "}
          <ThemedText type="defaultSemiBold" style={{ fontFamily: Fonts.mono }}>
            react-native-reanimated
          </ThemedText>{" "}
          library to create a waving hand animation.
        </ThemedText>
        {Platform.select({
          ios: (
            <ThemedText>
              The{" "}
              <ThemedText type="defaultSemiBold">
                components/ParallaxScrollView.tsx
              </ThemedText>{" "}
              component provides a parallax effect for the header image.
            </ThemedText>
          ),
        })}
      </Collapsible>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: "#808080",
    bottom: -90,
    left: -35,
    position: "absolute",
  },
  titleContainer: {
    flexDirection: "row",
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
});

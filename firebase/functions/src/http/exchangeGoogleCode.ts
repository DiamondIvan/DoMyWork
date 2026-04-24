import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { google } from "googleapis";
import { z } from "zod";

const GOOGLE_OAUTH_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const GOOGLE_OAUTH_REDIRECT_URI = defineSecret("GOOGLE_OAUTH_REDIRECT_URI");

function getGoogleOAuthEnvOrSecret(
  envName:
    | "GOOGLE_OAUTH_CLIENT_ID"
    | "GOOGLE_OAUTH_CLIENT_SECRET"
    | "GOOGLE_OAUTH_REDIRECT_URI",
  secret: ReturnType<typeof defineSecret>,
): string {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return secret.value();
}

const exchangeRequestSchema = z.object({
  userId: z.string().min(1),
  code: z.string().min(1),
  redirectUri: z.string().min(1).optional(),
});

if (admin.apps.length === 0) {
  admin.initializeApp();
}

export const exchangeGoogleCode = onRequest(
  {
    region: "asia-southeast1",
    secrets: [
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET,
      GOOGLE_OAUTH_REDIRECT_URI,
    ],
  },
  async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const parsed = exchangeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body",
        issues: parsed.error.issues,
      });
      return;
    }

    const { userId, code, redirectUri } = parsed.data;

    const clientId = getGoogleOAuthEnvOrSecret(
      "GOOGLE_OAUTH_CLIENT_ID",
      GOOGLE_OAUTH_CLIENT_ID,
    );
    const clientSecret = getGoogleOAuthEnvOrSecret(
      "GOOGLE_OAUTH_CLIENT_SECRET",
      GOOGLE_OAUTH_CLIENT_SECRET,
    );
    const configuredRedirectUri = getGoogleOAuthEnvOrSecret(
      "GOOGLE_OAUTH_REDIRECT_URI",
      GOOGLE_OAUTH_REDIRECT_URI,
    );

    if (redirectUri && redirectUri !== configuredRedirectUri) {
      res.status(400).json({
        error:
          "redirectUri mismatch. The app and backend must use the same redirect URI.",
        configuredRedirectUri,
        receivedRedirectUri: redirectUri,
      });
      return;
    }

    try {
      const oAuth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        configuredRedirectUri,
      );

      const tokenResponse = await oAuth2Client.getToken(code);
      const tokens = tokenResponse.tokens;

      const refreshToken = tokens.refresh_token;

      if (refreshToken) {
        await admin.firestore().doc(`users/${userId}/integrations/google`).set(
          {
            refreshToken,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        logger.info("Stored Google refresh token", { userId });

        res.status(200).json({ ok: true, hasRefreshToken: true });
        return;
      }

      logger.warn("Google token exchange did not return a refresh token", {
        userId,
        tokenKeys: Object.keys(tokens ?? {}),
      });

      res.status(200).json({
        ok: true,
        hasRefreshToken: false,
        message:
          "No refresh_token returned. This usually happens if the user already granted access before. Try again after revoking access, and ensure prompt=consent and access_type=offline.",
      });
    } catch (err: any) {
      logger.error("Google token exchange failed", {
        userId,
        message: err?.message,
        stack: err?.stack,
      });

      res.status(500).json({
        error: err?.message ?? "Token exchange failed",
      });
    }
  },
);

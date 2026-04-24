import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

import { createOAuth2Client } from "../google/auth";
import { createCalendarEvent } from "../google/calendar";
import { sendGmailTextEmail } from "../google/gmail";
import {
    automationRequestSchema,
    isCreateCalendarEventRequest,
    isSendEmailRequest,
} from "../schema";

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

if (admin.apps.length === 0) {
  admin.initializeApp();
}

export const onAutomationRequestCreated = onDocumentCreated(
  {
    region: "asia-southeast1",
    document: "automationRequests/{requestId}",
    secrets: [
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET,
      GOOGLE_OAUTH_REDIRECT_URI,
    ],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const requestId = event.params.requestId;
    const ref = snap.ref;

    const raw = snap.data();
    const parsed = automationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error("Invalid automation request", {
        requestId,
        issues: parsed.error.issues,
      });
      await ref.set(
        {
          status: "error",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: {
            message: "Invalid request schema",
            issues: parsed.error.issues,
          },
        },
        { merge: true },
      );
      return;
    }

    const request = parsed.data;

    if (request.status === "done") {
      logger.info("Request already done; skipping", { requestId });
      return;
    }

    await ref.set(
      {
        status: "processing",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    try {
      const tokenDoc = await admin
        .firestore()
        .doc(`users/${request.userId}/integrations/google`)
        .get();

      const refreshToken = tokenDoc.get("refreshToken") as string | undefined;
      if (!refreshToken) {
        throw new Error(
          "Missing Google refresh token. Expected users/{userId}/integrations/google.refreshToken",
        );
      }

      const auth = createOAuth2Client({
        clientId: getGoogleOAuthEnvOrSecret(
          "GOOGLE_OAUTH_CLIENT_ID",
          GOOGLE_OAUTH_CLIENT_ID,
        ),
        clientSecret: getGoogleOAuthEnvOrSecret(
          "GOOGLE_OAUTH_CLIENT_SECRET",
          GOOGLE_OAUTH_CLIENT_SECRET,
        ),
        redirectUri: getGoogleOAuthEnvOrSecret(
          "GOOGLE_OAUTH_REDIRECT_URI",
          GOOGLE_OAUTH_REDIRECT_URI,
        ),
        refreshToken,
      });

      let result: any;

      if (isSendEmailRequest(request)) {
        const payload = request.payload as any;
        result = await sendGmailTextEmail({
          auth,
          to: payload.to,
          subject: payload.subject,
          bodyText: payload.bodyText,
        });
      } else if (isCreateCalendarEventRequest(request)) {
        const payload = request.payload as any;
        result = await createCalendarEvent({
          auth,
          calendarId: payload.calendarId ?? "primary",
          summary: payload.summary,
          description: payload.description,
          start: payload.start,
          end: payload.end,
          attendees: payload.attendees,
        });
      } else {
        throw new Error(`Unsupported request type: ${request.type}`);
      }

      await ref.set(
        {
          status: "done",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          result,
        },
        { merge: true },
      );

      logger.info("Automation request completed", { requestId });
    } catch (err: any) {
      logger.error("Automation request failed", {
        requestId,
        message: err?.message,
        stack: err?.stack,
      });

      await ref.set(
        {
          status: "error",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: {
            message: err?.message ?? "Unknown error",
          },
        },
        { merge: true },
      );
    }
  },
);

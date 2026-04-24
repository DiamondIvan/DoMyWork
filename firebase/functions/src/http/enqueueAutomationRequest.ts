import type { Request, Response } from "express";
import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import { automationRequestSchema } from "../schema";

const enqueueRequestSchema = z.object({
  userId: z.string().min(1),
  type: z.union([z.literal("send_email"), z.literal("create_calendar_event")]),
  payload: z.unknown(),
});

if (admin.apps.length === 0) {
  admin.initializeApp();
}

export const enqueueAutomationRequest = onRequest(
  {
    region: "asia-southeast1",
  },
  async (req: Request, res: Response) => {
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

    const parsedBody = enqueueRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: "Invalid request body",
        issues: parsedBody.error.issues,
      });
      return;
    }

    const requestDoc = {
      ...parsedBody.data,
      status: "queued" as const,
    };

    const parsedAutomation = automationRequestSchema.safeParse(requestDoc);
    if (!parsedAutomation.success) {
      res.status(400).json({
        error: "Payload does not match automation schema",
        issues: parsedAutomation.error.issues,
      });
      return;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = await admin
      .firestore()
      .collection("automationRequests")
      .add({
        ...parsedAutomation.data,
        createdAt: now,
        updatedAt: now,
      });

    res.status(200).json({
      ok: true,
      requestId: docRef.id,
      status: "queued",
    });
  },
);

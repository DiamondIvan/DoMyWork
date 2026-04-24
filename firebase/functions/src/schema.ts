import { z } from "zod";

const sendEmailPayloadSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  bodyText: z.string().min(1),
});

const createCalendarEventPayloadSchema = z.object({
  calendarId: z.string().default("primary"),
  summary: z.string().min(1),
  description: z.string().optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  attendees: z.array(z.string().email()).optional(),
});

export const automationRequestSchema = z.object({
  userId: z.string().min(1),
  type: z.union([z.literal("send_email"), z.literal("create_calendar_event")]),
  payload: z.union([sendEmailPayloadSchema, createCalendarEventPayloadSchema]),
  status: z
    .union([
      z.literal("queued"),
      z.literal("processing"),
      z.literal("done"),
      z.literal("error"),
    ])
    .optional(),
});

export type AutomationRequest = z.infer<typeof automationRequestSchema>;

export function isSendEmailRequest(
  req: AutomationRequest,
): req is AutomationRequest & {
  type: "send_email";
  payload: z.infer<typeof sendEmailPayloadSchema>;
} {
  return req.type === "send_email";
}

export function isCreateCalendarEventRequest(
  req: AutomationRequest,
): req is AutomationRequest & {
  type: "create_calendar_event";
  payload: z.infer<typeof createCalendarEventPayloadSchema>;
} {
  return req.type === "create_calendar_event";
}

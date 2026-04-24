import { google } from "googleapis";

export async function createCalendarEvent(params: {
  auth: any;
  calendarId: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees?: string[];
}) {
  const calendar = google.calendar({ version: "v3", auth: params.auth });

  const res = await calendar.events.insert({
    calendarId: params.calendarId,
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.start },
      end: { dateTime: params.end },
      attendees: params.attendees?.map((email) => ({ email })),
    },
  });

  return {
    id: res.data.id,
    htmlLink: res.data.htmlLink,
  };
}

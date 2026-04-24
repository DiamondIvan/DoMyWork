import { google } from "googleapis";
import { base64UrlEncode } from "../utils/base64url";

export async function sendGmailTextEmail(params: {
  auth: any;
  to: string;
  subject: string;
  bodyText: string;
}) {
  const gmail = google.gmail({ version: "v1", auth: params.auth });

  const mime = [
    `To: ${params.to}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${params.subject}`,
    "",
    params.bodyText,
  ].join("\r\n");

  const raw = base64UrlEncode(mime);
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return {
    id: res.data.id,
    threadId: res.data.threadId,
  };
}

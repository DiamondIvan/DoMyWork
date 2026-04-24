import { google } from "googleapis";

export type GoogleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
};

export function createOAuth2Client(creds: GoogleOAuthCredentials) {
  const oAuth2Client = new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
    creds.redirectUri,
  );

  oAuth2Client.setCredentials({ refresh_token: creds.refreshToken });
  return oAuth2Client;
}

#!/usr/bin/env node

import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
const port = Number(process.env.GMAIL_OAUTH_PORT || 53682);
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const scope = "https://www.googleapis.com/auth/gmail.readonly";

if (!clientId || !clientSecret) {
  console.error("Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET.");
  console.error("Run like this:");
  console.error("GMAIL_CLIENT_ID='...' GMAIL_CLIENT_SECRET='...' npm run gmail:token");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope,
});

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", redirectUri);
    if (requestUrl.pathname !== "/oauth2callback") {
      res.writeHead(404);
      res.end("Not found.");
      return;
    }

    const code = requestUrl.searchParams.get("code");
    if (!code) {
      throw new Error(requestUrl.searchParams.get("error") || "OAuth code missing.");
    }

    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Gmail connected</h1><p>You can close this tab and return to Codex.</p>");

    console.log("\nGMAIL_REFRESH_TOKEN=");
    console.log(tokens.refresh_token || "(No refresh token returned. Re-run with prompt=consent or remove previous app access.)");
    console.log("\nAdd this value to Firebase Functions secrets as GMAIL_REFRESH_TOKEN.");
    server.close();
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(error instanceof Error ? error.message : String(error));
    console.error(error);
    server.close();
    process.exitCode = 1;
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Open this URL and approve Gmail read-only access:");
  console.log(authUrl);
  console.log(`\nWaiting for OAuth callback on ${redirectUri}`);
});

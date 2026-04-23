# Gmail Estimate Scanner

The Gmail Estimate Scanner is a read-only BizBot integration for Carolina Wheel Werkz.

It looks for recent customer emails that sound like estimate, quote, wheel repair, powder coating, curb rash, bent wheel, rim, appointment, or pricing requests.

## Safety

- The scanner uses the Gmail read-only scope.
- It does not send replies.
- It does not archive, delete, label, or move emails.
- It creates dashboard-ready lead fields and draft reply text for human review.

## Required Environment

Set these on the BizBot server:

```bash
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_REDIRECT_URI=http://localhost
```

Required Gmail scope:

```text
https://www.googleapis.com/auth/gmail.readonly
```

## App Endpoints

- `GET /api/integrations/gmail/estimate-scanner/status`
- `POST /api/integrations/gmail/estimate-scanner/run`

## Dashboard Usage

Open `Auxiliary`, then use `Email Estimate Scanner`.

Use `Run Scan Now` for an immediate test.

Use `Prepare Daily Schedule`, then create the background job to run every 1440 minutes.

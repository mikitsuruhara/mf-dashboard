/**
 * credentials.ts — replaces the 1Password SDK dependency
 *
 * Reads MoneyForward credentials from environment variables.
 * Retrieves the email OTP by polling Gmail over IMAP.
 *
 * Required environment variables:
 *   MF_EMAIL            — MoneyForward login email
 *   MF_PASSWORD         — MoneyForward password
 *   GMAIL_USER          — Gmail address that receives the OTP (often same as MF_EMAIL)
 *   GMAIL_APP_PASSWORD  — Gmail App Password (not your regular Google password)
 */

import { ImapFlow } from "imapflow";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export async function getCredentials(): Promise<{
  email: string;
  password: string;
}> {
  const email = process.env.MF_EMAIL;
  const password = process.env.MF_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "MF_EMAIL and MF_PASSWORD environment variables are required"
    );
  }

  return { email, password };
}

// ---------------------------------------------------------------------------
// OTP — polls Gmail IMAP until the MoneyForward OTP email arrives
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000; // check every 5 seconds
const POLL_TIMEOUT_MS = 90_000; // give up after 90 seconds
const OTP_WINDOW_MS = 3 * 60 * 1000; // only look at emails from last 3 minutes

export async function getOTP(): Promise<string> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER and GMAIL_APP_PASSWORD environment variables are required"
    );
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const otp = await fetchOTPFromGmail(user, pass);
    if (otp) return otp;
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `OTP not received within ${POLL_TIMEOUT_MS / 1000} seconds. ` +
      "Check that GMAIL_USER and GMAIL_APP_PASSWORD are correct, " +
      "and that the MoneyForward OTP email is being delivered to that inbox."
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchOTPFromGmail(
  user: string,
  pass: string
): Promise<string | null> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false, // suppress verbose IMAP logs in CI
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const since = new Date(Date.now() - OTP_WINDOW_MS);

      // Search for recent emails from MoneyForward
      const uids = await client.search(
        { since, from: "moneyforward.com" },
        { uid: true }
      );

      if (!uids || uids.length === 0) return null;

      // Fetch the body of the most recent match
      const latestUid = String(uids[uids.length - 1]);
      let bodyText = "";

      for await (const msg of client.fetch(
        latestUid,
        { source: true },
        { uid: true }
      )) {
        bodyText = msg.source?.toString("utf8") ?? "";
      }

      // MoneyForward OTP emails contain a standalone 6-digit code
      const match = bodyText.match(/\b([0-9]{6})\b/);
      return match ? match[1] : null;
    } finally {
      lock.release();
    }
  } catch (err) {
    // Non-fatal — caller will retry
    console.warn("[credentials] Gmail IMAP error:", err);
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test compatibility shim (mirrors the original 1Password version)
// ---------------------------------------------------------------------------

export function _resetOpClient(): void {
  // no-op — no singleton to reset
}

replace 1Password auth with Gmail IMAP

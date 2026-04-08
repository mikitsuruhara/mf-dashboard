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
import { simpleParser } from "mailparser";

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
    throw new Error("MF_EMAIL and MF_PASSWORD environment variables are required");
  }

  return { email, password };
}

// ---------------------------------------------------------------------------
// OTP — polls Gmail IMAP until the MoneyForward OTP email arrives
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000; // check every 5 seconds
const POLL_TIMEOUT_MS = 90_000; // give up after 90 seconds

/**
 * Snapshot the latest MoneyForward email UID before triggering login.
 * Pass the returned value to getOTP() so only emails newer than this
 * baseline are considered.
 *
 * Background: IMAP SINCE is date-only (not datetime), so a time-window
 * filter like "last 3 minutes" still returns all emails from today.
 * Without a UID baseline, a stale OTP from an earlier session today
 * would be picked up instead of the fresh one from the current login.
 */
export async function getBaselineEmailUid(): Promise<number> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return 0;

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ from: "moneyforward.com" }, { uid: true })) as number[];
      return uids.length > 0 ? uids[uids.length - 1] : 0;
    } finally {
      lock.release();
    }
  } catch {
    return 0;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Poll Gmail until a MoneyForward OTP email with UID > baselineUid arrives.
 * The baseline ensures we only read the OTP from the current login attempt.
 */
export async function getOTP(baselineUid: number = 0): Promise<string> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD environment variables are required");
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const otp = await fetchOTPFromGmail(user, pass, baselineUid);
    if (otp) return otp;
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `OTP not received within ${POLL_TIMEOUT_MS / 1000} seconds. ` +
      "Check that GMAIL_USER and GMAIL_APP_PASSWORD are correct, " +
      "and that the MoneyForward OTP email is being delivered to that inbox.",
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchOTPFromGmail(
  user: string,
  pass: string,
  baselineUid: number,
): Promise<string | null> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Fetch all MoneyForward emails, then filter client-side to UIDs above
      // the baseline. Avoids relying on IMAP UID range search syntax.
      const allUids = (await client.search(
        { from: "moneyforward.com" },
        { uid: true },
      )) as number[];

      const newUids = baselineUid > 0 ? allUids.filter((uid) => uid > baselineUid) : allUids;

      if (!newUids || newUids.length === 0) return null;

      // Fetch raw source of the most recent new email and parse MIME properly.
      // Raw source regex is not safe because HTML parts are typically base64-encoded —
      // running regex on base64 data produces false 6-digit matches.
      const latestUid = String(newUids[newUids.length - 1]);
      let rawSource: string | undefined;

      for await (const msg of client.fetch(latestUid, { source: true }, { uid: true })) {
        rawSource = msg.source?.toString("utf8");
      }

      if (!rawSource) return null;

      const parsed = await simpleParser(rawSource);
      // Prefer plain text; fall back to subject line (some OTP emails are text-only)
      const bodyText = parsed.text ?? parsed.subject ?? "";

      // MoneyForward OTP emails contain a standalone 6-digit code
      const match = bodyText.match(/\b([0-9]{6})\b/);
      if (match)
        console.info(`[credentials] OTP matched from ${parsed.text ? "text body" : "subject"}`);
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

function _resetOpClient(): void {
  // no-op — no singleton to reset
}

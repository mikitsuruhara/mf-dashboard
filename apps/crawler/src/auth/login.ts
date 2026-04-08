import { mfUrls } from "@mf-dashboard/meta/urls";
import type { BrowserContext, Page } from "playwright";
import { debug, info, log } from "../logger.js";
import { getBaselineEmailUid, getCredentials, getOTP } from "./credentials.js";
import { hasAuthState, saveAuthState } from "./state.js";

const TIMEOUTS = {
  short: 5_000,
  medium: 10_000,
  long: 15_000,
  login: 30_000,
};

const SELECTORS = {
  mfidEmail: 'input[name="mfid_user[email]"]',
  mfidPassword: 'input[name="mfid_user[password]"]',
  mfidSubmit: "#submitto",
  // OTP input: prefer autocomplete standard; exclude hidden fields by type
  otpInput: [
    'input[autocomplete="one-time-code"]',
    "input[name*='otp']:not([type='hidden'])",
    "input[name*='code']:not([type='hidden'])",
    'input[type="text"][maxlength="6"]',
    'input[inputmode="numeric"]',
  ].join(", "),
};

function isLoggedInUrl(url: string): boolean {
  return (
    url.includes("moneyforward.com") &&
    !url.includes("id.moneyforward.com") &&
    !url.includes("/sign_in")
  );
}

/**
 * Check if the cached auth state session is still valid.
 * Navigates to a protected page (/cf) — unauthenticated users get
 * redirected to id.moneyforward.com, authenticated users stay on /cf.
 */
async function isSessionValid(page: Page): Promise<boolean> {
  try {
    await page.goto(mfUrls.cashFlow, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.long,
    });
    // Brief wait for any post-load redirect
    try {
      await page.waitForURL((url) => url.toString() !== mfUrls.cashFlow, { timeout: 2_000 });
    } catch {
      // No redirect = still on /cf = session is valid
    }
    const valid = isLoggedInUrl(page.url());
    debug(`Session valid: ${valid} (${page.url()})`);
    return valid;
  } catch {
    return false;
  }
}

export async function loginWithAuthState(page: Page, context: BrowserContext): Promise<void> {
  if (hasAuthState()) {
    info("Auth state found, checking session validity...");
    if (await isSessionValid(page)) {
      info("Using existing session from auth state");
      return;
    }
    info("Session expired, performing full login...");
  } else {
    info("No auth state found, performing full login...");
  }

  await login(page);
  await saveAuthState(context);
}

export async function login(page: Page): Promise<void> {
  const { email: username, password } = await getCredentials();

  // Snapshot the latest MoneyForward email UID before triggering login.
  // IMAP SINCE is date-only, so without this we'd pick up stale OTPs from
  // earlier sessions today instead of the fresh one from this login.
  const baselineUid = await getBaselineEmailUid();
  info(`Baseline email UID: ${baselineUid}`);

  // ── Step 1: email page ────────────────────────────────────────────────────
  info("Navigating to MFID login...");
  await page.goto(mfUrls.auth.signIn, { waitUntil: "domcontentloaded" });
  const emailInput = page.locator(SELECTORS.mfidEmail);
  await emailInput.waitFor({ state: "visible", timeout: TIMEOUTS.medium });
  await emailInput.fill(username);
  await page.locator(SELECTORS.mfidSubmit).click();

  // ── Step 2: password page ─────────────────────────────────────────────────
  info("Entering password...");
  const passwordInput = page.locator(SELECTORS.mfidPassword);
  await passwordInput.waitFor({ state: "visible", timeout: TIMEOUTS.medium });
  log(`Password page: ${page.url()}`);
  await passwordInput.fill(password);
  await page.locator(SELECTORS.mfidSubmit).click();

  // ── Step 3: post-password navigation ──────────────────────────────────────
  await page.waitForLoadState("domcontentloaded");
  info(`After password: ${page.url()}`);

  // ── Step 4: email OTP (if required) ───────────────────────────────────────
  if (page.url().includes("otp")) {
    info("Email OTP required, fetching from Gmail...");
    const otp = await getOTP(baselineUid);
    info("OTP obtained, submitting...");

    // Screenshot the OTP page so we can verify the form structure in CI
    await page
      .screenshot({ path: "/tmp/mf-debug/email-otp-page.png", fullPage: true })
      .catch(() => {});

    const otpInput = page.locator(SELECTORS.otpInput).first();
    await otpInput.waitFor({ state: "visible", timeout: TIMEOUTS.short });
    // Click to focus, then type character-by-character to trigger input events
    await otpInput.click();
    await otpInput.pressSequentially(otp, { delay: 50 });
    info(`OTP input value after fill: ${await otpInput.inputValue().catch(() => "?")}`);
    await page.locator(SELECTORS.mfidSubmit).click();

    // Wait until we leave the OTP page.
    // If the OTP is wrong, MF stays on /email_otp and this throws after 30s.
    await page.waitForURL((url) => !url.toString().includes("email_otp"), {
      timeout: TIMEOUTS.login,
    });
    info(`After OTP: ${page.url()}`);
  }

  // ── Step 5: ME OAuth exchange ─────────────────────────────────────────────
  // MFID session is now established. Navigating to ME sign_in triggers an
  // OAuth request to MFID. Because we're logged in, MFID auto-grants and
  // redirects to moneyforward.com/auth/mfid/callback → dashboard.
  info("Triggering ME OAuth exchange...");
  await page.goto(mfUrls.signIn, { waitUntil: "domcontentloaded" });
  info(`After goto sign_in: ${page.url()}`);

  // Occasionally goto resolves mid-redirect on the MFID OAuth grant page.
  // Wait for it to complete the redirect back to ME.
  if (page.url().includes("id.moneyforward.com")) {
    info("MFID OAuth auto-grant in progress, waiting for redirect to ME...");
    await page.waitForURL((url) => !url.toString().includes("id.moneyforward.com"), {
      timeout: TIMEOUTS.login,
    });
    info(`After OAuth grant: ${page.url()}`);
  }

  // ── Step 6: verify success ────────────────────────────────────────────────
  const finalUrl = page.url();
  if (!isLoggedInUrl(finalUrl)) {
    throw new Error(`Login failed — unexpected final URL: ${finalUrl}`);
  }

  info("Login successful!");
}

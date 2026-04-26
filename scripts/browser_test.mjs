import puppeteer from "../frontend/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3001";
const OUT = "D:/Projects/MIT-Hackathon-2026-C02/scripts/screenshots";
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log("[test]", ...a);

const HEADED = process.env.HEADED !== "false";
const SLOW_MS = parseInt(process.env.SLOW_MS || (HEADED ? "2000" : "0"), 10);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: HEADED ? false : "new",
  defaultViewport: { width: 1280, height: 900 },
  args: HEADED
    ? ["--start-maximized", "--disable-blink-features=AutomationControlled"]
    : ["--no-sandbox", "--disable-dev-shm-usage"],
});

const pause = (ms = SLOW_MS) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warn") {
      console.log(`[browser:${type}]`, msg.text());
    }
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  log("navigating to", BASE);
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 30000 });
  await pause(1500);

  await page.screenshot({ path: join(OUT, "01_empty_state.png"), fullPage: true });
  log("screenshot 01: empty state");

  // Find wallet widget text
  const walletText = await page.evaluate(() => {
    const el = document.querySelector("header");
    return el ? el.innerText : null;
  });
  log("header text:", JSON.stringify(walletText));

  // Find suggestion buttons
  const suggestions = await page.$$eval("button", (btns) =>
    btns.map((b) => b.innerText).filter((t) => t && t.length > 20)
  );
  log("suggestions found:", suggestions.length);
  suggestions.forEach((s, i) => log(`  ${i}:`, s.slice(0, 80)));

  // === LOW STAKES ===
  log("---- LOW-STAKES TEST ----");
  log("clicking heart-rate suggestion");
  const lowStakesText = "What's a normal resting heart rate";
  const clickedLow = await page.evaluate((needle) => {
    const btns = Array.from(document.querySelectorAll("button"));
    const target = btns.find((b) => b.innerText.includes(needle));
    if (target) {
      target.click();
      return true;
    }
    return false;
  }, lowStakesText);
  log("clicked low-stakes suggestion:", clickedLow);
  await pause(1000);

  // Click send
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const send = btns.find((b) => b.querySelector("svg") && b.getAttribute("disabled") === null);
    // The send button is the last button with just an icon
    const last = btns.filter((b) => b.querySelector("svg") && b.innerText.trim() === "").pop();
    (last || send)?.click();
  });
  log("clicked send (low-stakes)");

  // Wait for stream to complete
  await page.waitForFunction(
    () => {
      const all = Array.from(document.querySelectorAll("p"));
      return all.some((p) => p.innerText.includes("resting heart rate") && p.innerText.length > 100);
    },
    { timeout: 30000 }
  ).catch(() => log("WARN: low-stakes answer not detected within 30s"));

  await pause(2500);
  await page.screenshot({ path: join(OUT, "02_lowstakes_done.png"), fullPage: true });
  log("screenshot 02: low-stakes complete");

  // === HIGH STAKES ===
  log("---- HIGH-STAKES TEST ----");
  await page.evaluate(() => {
    const input = document.querySelector("input");
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "My 6-year-old has had a 102 degree fever for 4 days, mild cough - what should we do?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
  });
  log("typed high-stakes question");
  await pause(800);

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const last = btns.filter((b) => b.querySelector("svg") && b.innerText.trim() === "").pop();
    last?.click();
  });
  log("clicked send (high-stakes)");

  // Wait for "Verified by Licensed Expert" badge
  await page.waitForFunction(
    () => document.body.innerText.includes("Verified by Licensed Expert"),
    { timeout: 60000 }
  ).catch(() => log("WARN: verification badge not detected within 60s"));

  await pause(3500);
  await page.screenshot({ path: join(OUT, "03_highstakes_verified.png"), fullPage: true });
  log("screenshot 03: high-stakes verified");

  // === RECEIPT MODAL ===
  log("---- RECEIPT MODAL TEST ----");

  // Find and click the button via puppeteer's API (more reliable than dom click in headed mode)
  const buttons = await page.$$("button");
  let clickedReceipt = false;
  for (const btn of buttons) {
    const text = await page.evaluate((el) => el.innerText, btn);
    if (text.includes("View Vouch Receipt")) {
      await btn.click();
      clickedReceipt = true;
      break;
    }
  }
  log("clicked View Vouch Receipt:", clickedReceipt);

  // Wait for modal to mount
  await page
    .waitForFunction(() => document.body.innerText.includes("Verification Receipt"), {
      timeout: 5000,
    })
    .catch(() => log("WARN: modal did not appear within 5s"));

  // Wait for signature verification to resolve (or fail)
  await page
    .waitForFunction(
      () => {
        const t = document.body.innerText;
        return t.includes("Signature valid") || t.includes("Signature INVALID");
      },
      { timeout: 10000 }
    )
    .catch(() => log("WARN: signature verification didn't resolve within 10s"));

  await pause(2000);
  // viewport screenshot — fullPage doesn't render fixed-position modals correctly
  await page.screenshot({ path: join(OUT, "04_receipt_modal.png") });
  log("screenshot 04: receipt modal (viewport)");

  const sigStatus = await page.evaluate(() => {
    const text = document.body.innerText;
    if (text.includes("Signature valid")) return "VALID";
    if (text.includes("Signature INVALID")) return "INVALID";
    if (text.includes("Verifying Ed25519 signature")) return "VERIFYING";
    return "UNKNOWN";
  });
  log("Ed25519 signature status:", sigStatus);

  log("---- DONE ----");
  log("screenshots saved to:", OUT);

  if (HEADED) {
    log("HEADED mode — leaving browser open for 30s so you can poke around");
    await pause(30000);
  }
} finally {
  await browser.close();
}

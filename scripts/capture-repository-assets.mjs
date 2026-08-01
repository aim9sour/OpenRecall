import { fork } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetDirectory = resolve(repositoryRoot, "docs/assets");
const origin = "http://127.0.0.1:3210";
let csrfToken;

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function request(path, init) {
  const mutation = init?.method !== undefined && init.method !== "GET";
  if (mutation && csrfToken === undefined) {
    const bootstrapResponse = await fetch(`${origin}/api/v1/bootstrap`, {
      headers: { accept: "application/json" },
    });
    if (!bootstrapResponse.ok) {
      throw new Error("OPENRECALL_ASSET_BOOTSTRAP_FAILED");
    }
    const bootstrap = await bootstrapResponse.json();
    csrfToken = bootstrap.csrfToken;
  }
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin,
      ...(mutation ? { "x-openrecall-csrf": csrfToken } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`OPENRECALL_ASSET_API_FAILED:${response.status}:${path}`);
  }
  if (response.status === 204) return undefined;
  const value = await response.json();
  if (path === "/api/v1/bootstrap") csrfToken = value.csrfToken;
  return value;
}

async function waitForServer(child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `OPENRECALL_ASSET_SERVER_EXITED:${output.value.slice(-1_000)}`,
      );
    }
    try {
      const response = await fetch(`${origin}/api/v1/health`, {
        signal: AbortSignal.timeout(750),
      });
      if (response.ok) return;
    } catch {
      // Startup is expected to refuse requests briefly.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("OPENRECALL_ASSET_SERVER_TIMEOUT");
}

async function importCards(sectionId, cards) {
  const previewId = crypto.randomUUID();
  const content = cards;
  const preview = await request(`/api/v1/sections/${sectionId}/import/preview`, {
    body: JSON.stringify({ content, previewId }),
    method: "POST",
  });
  await request(`/api/v1/sections/${sectionId}/import/commit`, {
    body: JSON.stringify({
      content,
      digest: preview.digest,
      previewId,
      selectedIndexes: cards.map((_, index) => index),
    }),
    method: "POST",
  });
}

async function seedSyntheticLibrary() {
  const sections = [];
  for (const fixture of [
    {
      name: "علوم الحاسب",
      cards: [
        {
          front: "Why does OpenRecall rotate card variants?",
          back: "To test knowledge instead of memorizing one visual wording.",
          notes: "Every variant shares one scheduling state.",
          variants: [
            {
              front: "What is the purpose of smart variant rotation?",
              back: "It separates genuine recall from layout memorization.",
              notes: "The variants remain one learning item.",
            },
          ],
        },
        { front: "What does SQLite provide here?", back: "A durable local database.", notes: "No cloud account is required." },
        { front: "What does loopback-only mean?", back: "The server accepts this computer only." },
        { front: "What are the four ratings?", back: "Again, Hard, Good, and Easy." },
        { front: "Where is language selected?", back: "In OpenRecall settings." },
        { front: "When do newly due cards join?", back: "At their stored due time." },
      ],
    },
    {
      name: "اللغة الإنجليزية",
      cards: [
        { front: "resilient", back: "able to recover quickly", notes: "Adjective" },
        { front: "concise", back: "brief but complete" },
        { front: "reliable", back: "consistently dependable" },
        { front: "accessible", back: "usable by people with varied needs" },
      ],
    },
    {
      name: "المعرفة العامة",
      cards: [
        { front: "What is active recall?", back: "Retrieving an answer from memory." },
        { front: "Why space reviews?", back: "To revisit knowledge near forgetting." },
        { front: "What is a backup?", back: "A separate recoverable copy of data." },
      ],
    },
  ]) {
    const section = await request("/api/v1/sections", {
      body: JSON.stringify({ name: fixture.name }),
      method: "POST",
    });
    await importCards(section.id, fixture.cards);
    sections.push(section);
  }
  return sections;
}

async function setLocale(locale) {
  const bootstrap = await request("/api/v1/bootstrap");
  await request("/api/v1/application-settings/locale", {
    body: JSON.stringify({
      expectedUpdatedAtMs: bootstrap.localeUpdatedAtMs,
      locale,
    }),
    method: "PUT",
  });
}

async function createSocialPreview(homeScreenshot) {
  const panel = await sharp(homeScreenshot)
    .resize(720, 450, { fit: "cover", position: "top" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const icon = await sharp(resolve(repositoryRoot, "apps/web/public/icon-512.png"))
    .resize(112, 112)
    .png()
    .toBuffer();
  const title = escapeXml("OpenRecall");
  const subtitle = escapeXml("Private, accessible spaced repetition");
  const background = Buffer.from(`
    <svg width="1280" height="640" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#071f1b"/>
          <stop offset="1" stop-color="#123b33"/>
        </linearGradient>
        <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-opacity=".32"/></filter>
      </defs>
      <rect width="1280" height="640" fill="url(#g)"/>
      <circle cx="110" cy="85" r="260" fill="#59d7b2" opacity=".08"/>
      <circle cx="1170" cy="570" r="300" fill="#e9b44c" opacity=".08"/>
      <text x="96" y="265" fill="#f6fffc" font-family="Segoe UI, Arial, sans-serif" font-size="72" font-weight="700">${title}</text>
      <text x="96" y="325" fill="#bcebdd" font-family="Segoe UI, Arial, sans-serif" font-size="28">${subtitle}</text>
      <text x="96" y="382" fill="#f6fffc" font-family="Segoe UI, Arial, sans-serif" font-size="22">Local-only · Chrome + NVDA · FSRS-6 · SQLite</text>
      <rect x="580" y="95" width="628" height="450" rx="24" fill="#0b1513" filter="url(#shadow)"/>
    </svg>
  `);
  await sharp(background)
    .composite([
      { input: icon, left: 96, top: 96 },
      { input: panel, left: 580, top: 95 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(resolve(assetDirectory, "openrecall-social-preview.png"));
}

async function capture() {
  await access(resolve(repositoryRoot, "apps/web/dist/index.html"));
  await mkdir(assetDirectory, { recursive: true });
  const dataDirectory = await mkdtemp(join(tmpdir(), "openrecall-assets-"));
  const server = fork(resolve(repositoryRoot, "apps/server/src/index.ts"), [], {
    cwd: resolve(repositoryRoot, "apps/server"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      OPENRECALL_DATA_DIRECTORY: dataDirectory,
      OPENRECALL_HOST: "127.0.0.1",
      OPENRECALL_PORT: "3210",
      OPENRECALL_PUBLIC_ORIGIN: origin,
    },
    execArgv: ["--import", "tsx"],
    silent: true,
  });
  const serverOutput = { value: "" };
  for (const stream of [server.stdout, server.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      serverOutput.value += chunk;
    });
  }
  let browser;
  try {
    await waitForServer(server, serverOutput);
    const [reviewSection] = await seedSyntheticLibrary();
    await setLocale("ar");

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      colorScheme: "light",
      locale: "ar-EG",
      viewport: { height: 900, width: 1440 },
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    const dismissOfflineNotice = page.getByRole("button", { name: /لاحق/u });
    if (await dismissOfflineNotice.isVisible()) await dismissOfflineNotice.click();
    await page.screenshot({
      animations: "disabled",
      path: resolve(assetDirectory, "openrecall-home.png"),
    });

    await setLocale("en");
    const state = await request("/api/v1/review-sessions", {
      body: JSON.stringify({ sectionId: reviewSection.id }),
      method: "POST",
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto(`${origin}/review/${state.session.id}`, { waitUntil: "networkidle" });
    const showAnswer = page.getByRole("button", { name: "Show answer" });
    await showAnswer.waitFor({ state: "visible" });
    await showAnswer.click();
    await page.getByRole("heading", { name: "Answer" }).waitFor();
    await page.screenshot({
      animations: "disabled",
      path: resolve(assetDirectory, "openrecall-review.png"),
    });
    await context.close();
    await createSocialPreview(resolve(assetDirectory, "openrecall-home.png"));
    process.stdout.write("OPENRECALL_REPOSITORY_ASSETS_OK images=3 synthetic=true\n");
  } finally {
    await browser?.close().catch(() => undefined);
    if (server.connected) server.send("OPENRECALL_SHUTDOWN");
    await new Promise((resolveExit) => {
      if (server.exitCode !== null) return resolveExit();
      const timer = setTimeout(() => {
        server.kill();
        resolveExit();
      }, 10_000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
    await rm(dataDirectory, {
      force: true,
      maxRetries: 20,
      recursive: true,
      retryDelay: 250,
    });
  }
}

await capture();

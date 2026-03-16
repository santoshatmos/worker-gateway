/**
 * Worker subscription proxy test script
 * - Uses unified format: /api/v1/assets/{id}
 * - Verifies origin proxy response and status code
 * - Runs in Node.js 18+
 */

// -------------------- Config --------------------

// Worker base URL

const WORKER_BASE_URLS = (process.env.WORKER_BASE_URLS || process.env.WORKER_BASE_URL || "https://openclaw.atmoslogic.com;https://snapshot.hudie123.xyz")
  .split(/[;,\n\r]/)
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const TEST_SUB_ID = process.env.TEST_SUB_ID || "f86607a9cc48fc6f4c98d35f058bea01";
const TEST_KIND = process.env.TEST_KIND || "openclaw";
const TEST_UA = process.env.TEST_UA || "Clash";
const CUSTOM_CLIENT_PATH = process.env.CUSTOM_CLIENT_PATH || `/api/v1/assets/${TEST_SUB_ID}`;

async function readBodyPreview(response) {
  const text = await response.text();
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}

async function assertJsonEnvelope(response, label) {
  const text = await readBodyPreview(response);
  console.log(`\n[${label}] status=${response.status} ${response.statusText}`);
  console.log(`[${label}] headers content-type=${response.headers.get("content-type") || ""}`);
  console.log(`[${label}] body=${text}`);

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}`);
  }

  if (parsed?.success !== true) {
    throw new Error(`${label} JSON success is not true`);
  }

  const content = parsed?.data?.subscription?.content;
  if (!content || typeof content !== "string") {
    throw new Error(`${label} payload missing data.subscription.content`);
  }
}

async function assertPlainSubscription(response, label) {
  const text = await readBodyPreview(response);
  console.log(`\n[${label}] status=${response.status} ${response.statusText}`);
  console.log(`[${label}] headers content-type=${response.headers.get("content-type") || ""}`);
  console.log(`[${label}] body=${text}`);

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }

  if (!text || typeof text !== "string") {
    throw new Error(`${label} returned empty body`);
  }

  if (!/^[A-Za-z0-9+/=\r\n:_#?&.%@-]+$/.test(text)) {
    throw new Error(`${label} returned unexpected plaintext body`);
  }
}

async function assertLatestPayload(response, label) {
  const text = await readBodyPreview(response);
  console.log(`\n[${label}] status=${response.status} ${response.statusText}`);
  console.log(`[${label}] headers content-type=${response.headers.get("content-type") || ""}`);
  console.log(`[${label}] body=${text}`);

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}`);
  }

  const latest = parsed?.latest?.url;
  if (!latest || typeof latest !== "string") {
    throw new Error(`${label} payload missing latest.url`);
  }
}

async function testCustomClientPost(workerBaseUrl) {
  const customClientUrl = `${workerBaseUrl}${CUSTOM_CLIENT_PATH}`;
  const response = await fetch(customClientUrl, {
    method: "POST",
    headers: {
      "User-Agent": TEST_UA,
      "X-Sub-ID": TEST_SUB_ID,
      "X-Sub-Kind": TEST_KIND,
      "Content-Type": "text/plain;charset=UTF-8",
      "Accept": "application/json",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
    body: "",
  });

  await assertJsonEnvelope(response, `${workerBaseUrl} custom-client-post`);
}

async function testTraditionalClientGet(workerBaseUrl) {
  const assetsUrl = `${workerBaseUrl}/api/v1/assets/${TEST_SUB_ID}`;
  const response = await fetch(assetsUrl, {
    method: "GET",
    headers: {
      "User-Agent": TEST_UA,
      "Accept": "*/*",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
  });

  await assertPlainSubscription(response, `${workerBaseUrl} traditional-client-get`);
}

async function testLatest(workerBaseUrl) {
  const latestUrl = `${workerBaseUrl}/api/v1/latest?t=${Date.now()}`;
  const response = await fetch(latestUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Bytefly",
      "Accept": "application/json",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
  });

  await assertLatestPayload(response, `${workerBaseUrl} latest`);
}

const TEST_CASES = [
  { name: "custom-client-post", fn: testCustomClientPost },
  { name: "traditional-client-get", fn: testTraditionalClientGet },
  { name: "latest", fn: testLatest },
];

async function testWorker(workerBaseUrl) {
  console.log(`\n=== Testing worker ${workerBaseUrl} ===`);
  console.log(`TEST_SUB_ID=${TEST_SUB_ID}`);
  console.log(`TEST_KIND=${TEST_KIND}`);
  console.log(`TEST_UA=${TEST_UA}`);
  console.log(`CUSTOM_CLIENT_PATH=${CUSTOM_CLIENT_PATH}`);

  const results = [];
  for (const tc of TEST_CASES) {
    try {
      await tc.fn(workerBaseUrl);
      results.push({ worker: workerBaseUrl, test: tc.name, ok: true, error: null });
    } catch (err) {
      console.error(`\n[FAIL] ${workerBaseUrl} ${tc.name}: ${err.message || err}`);
      results.push({ worker: workerBaseUrl, test: tc.name, ok: false, error: err.message || String(err) });
    }
  }
  return results;
}

async function main() {
  if (WORKER_BASE_URLS.length === 0) {
    throw new Error("No worker base URLs configured");
  }

  console.log(`WORKER_BASE_URLS=${WORKER_BASE_URLS.join(";")}`);

  const allResults = [];
  for (const workerBaseUrl of WORKER_BASE_URLS) {
    const results = await testWorker(workerBaseUrl);
    allResults.push(...results);
  }

  console.log("\n========== Summary ==========");
  let hasFailure = false;
  for (const r of allResults) {
    const status = r.ok ? "PASS" : "FAIL";
    const detail = r.ok ? "" : ` -- ${r.error}`;
    console.log(`[${status}] ${r.worker} ${r.test}${detail}`);
    if (!r.ok) hasFailure = true;
  }

  if (hasFailure) {
    console.error("\nSome worker tests FAILED.");
    process.exitCode = 1;
  } else {
    console.log("\nAll worker tests passed.");
  }
}

main().catch((error) => {
  console.error("\nWorker test crashed:");
  console.error(error);
  process.exitCode = 1;
});
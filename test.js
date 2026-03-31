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
const CUSTOM_CLIENT_PATH = `/api/v1/assets/${TEST_SUB_ID}`;
const ORIGIN_BASE_URLS = (process.env.ORIGIN_BASE || "https://api.hudie123.xyz;https://vpn3.hudie123.xyz;https://api2.an1688.com")
  .split(/[;,\n\r]/)
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const ORIGIN_PROBE_TIMEOUT_MS = Number.parseInt(process.env.ORIGIN_PROBE_TIMEOUT_MS || "10000", 10);
const ORIGIN_PROBE_RETRIES = Number.parseInt(process.env.ORIGIN_PROBE_RETRIES || "3", 10);
const QUALITY_PROBE_COUNT = Number.parseInt(process.env.QUALITY_PROBE_COUNT || "10", 10);
const QUALITY_PROBE_TIMEOUT_MS = Number.parseInt(process.env.QUALITY_PROBE_TIMEOUT_MS || "8000", 10);

async function readBodyPreview(response) {
  const text = await response.text();
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}

async function assertJsonEnvelope(response, label) {
  const fullText = await response.text();
  const preview = fullText.length > 1200 ? `${fullText.slice(0, 1200)}...` : fullText;
  console.log(`\n[${label}] status=${response.status} ${response.statusText}`);
  console.log(`[${label}] headers content-type=${response.headers.get("content-type") || ""}`);
  console.log(`[${label}] body=${preview}`);

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fullText);
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
  const fullText = await response.text();
  const preview = fullText.length > 1200 ? `${fullText.slice(0, 1200)}...` : fullText;
  console.log(`\n[${label}] status=${response.status} ${response.statusText}`);
  console.log(`[${label}] headers content-type=${response.headers.get("content-type") || ""}`);
  console.log(`[${label}] body=${preview}`);

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fullText);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}`);
  }

  const latest = parsed?.latest?.url;
  if (!latest || typeof latest !== "string") {
    throw new Error(`${label} payload missing latest.url`);
  }
}

async function probeWorkerNetworkQuality(workerBaseUrl) {
  const probeUrl = `${workerBaseUrl}/api/v1/assets/saf`;
  const results = [];

  for (let i = 0; i < QUALITY_PROBE_COUNT; i += 1) {
    const startedAt = Date.now();
    let status = "ERR";
    let error = "";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QUALITY_PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(probeUrl, {
        method: "POST",
        headers: {
          "User-Agent": TEST_UA,
          "X-Sub-ID": TEST_SUB_ID,
          "X-Sub-Kind": TEST_KIND,
        },
        signal: controller.signal,
      });
      status = String(response.status);
    } catch (err) {
      error = err?.name === "AbortError" ? "TIMEOUT" : (err?.message || String(err));
    } finally {
      clearTimeout(timer);
    }

    const elapsedMs = Date.now() - startedAt;
    results.push({ index: i + 1, status, elapsedMs, error });
    console.log(status === "ERR" ? (error || "ERR") : status);
  }

  const okCount = results.filter((item) => item.status === "200").length;
  const timeoutCount = results.filter((item) => item.error === "TIMEOUT").length;
  const errorCount = results.filter((item) => item.status === "ERR").length;
  const statusBuckets = results.reduce((acc, item) => {
    const key = item.status === "ERR" ? item.error || "ERR" : item.status;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const avgLatencyMs = results.length > 0
    ? Math.round(results.reduce((sum, item) => sum + item.elapsedMs, 0) / results.length)
    : 0;

  console.log(`\n[${workerBaseUrl} quality] probe-url=${probeUrl}`);
  for (const item of results) {
    const suffix = item.error ? ` error=${item.error}` : "";
    console.log(`[${workerBaseUrl} quality] #${item.index} status=${item.status} elapsedMs=${item.elapsedMs}${suffix}`);
  }
  console.log(`[${workerBaseUrl} quality] summary ok=${okCount}/${results.length} timeout=${timeoutCount} error=${errorCount} avgLatencyMs=${avgLatencyMs} buckets=${JSON.stringify(statusBuckets)}`);

  return {
    worker: workerBaseUrl,
    test: "quality-probe",
    ok: okCount > 0,
    error: okCount > 0 ? null : `No successful probe responses. buckets=${JSON.stringify(statusBuckets)}`,
  };
}

async function probeOriginServerGfwBlock(originUrl) {
  const testPath = "/api/v1/server/user/info";
  const probeUrl = `${originUrl}${testPath}`;
  const results = [];

  for (let i = 0; i < ORIGIN_PROBE_RETRIES; i += 1) {
    const startedAt = Date.now();
    let status = "ERR";
    let error = "";
    let isGfwBlock = false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ORIGIN_PROBE_TIMEOUT_MS);

    try {
      // Direct fetch without any proxy - using global.fetch directly
      const response = await global.fetch(probeUrl, {
        method: "POST",
        headers: {
          "User-Agent": "Bytefly/1.0",
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        signal: controller.signal,
        // Explicitly disable any proxy settings
        redirect: "follow",
      });
      status = String(response.status);
    } catch (err) {
      error = err?.name === "AbortError" ? "TIMEOUT" : (err?.message || String(err));
      // GFW blocking detection patterns
      const gfwPatterns = [
        "ECONNRESET",
        "ECONNREFUSED",
        "ENOTFOUND",
        "ETIMEDOUT",
        "EPROTO",
        "self signed certificate",
        "certificate has expired",
        "unable to verify",
        "TLS",
        "SSL",
        "socket hang up",
        "Client network socket",
      ];
      isGfwBlock = gfwPatterns.some((pattern) => error.toLowerCase().includes(pattern.toLowerCase()));
    } finally {
      clearTimeout(timer);
    }

    const elapsedMs = Date.now() - startedAt;
    results.push({ index: i + 1, status, elapsedMs, error, isGfwBlock });
  }

  // Analysis
  const timeoutCount = results.filter((r) => r.error === "TIMEOUT").length;
  const errorCount = results.filter((r) => r.status === "ERR" && r.error !== "TIMEOUT").length;
  const gfwBlockCount = results.filter((r) => r.isGfwBlock).length;
  const avgLatencyMs = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.elapsedMs, 0) / results.length)
    : 0;

  // Determine if likely GFW blocked
  const isLikelyBlocked = gfwBlockCount >= Math.ceil(ORIGIN_PROBE_RETRIES / 2) || 
                         (timeoutCount >= Math.ceil(ORIGIN_PROBE_RETRIES / 2) && avgLatencyMs >= ORIGIN_PROBE_TIMEOUT_MS * 0.8);

  return {
    origin: originUrl,
    test: "gfw-block-probe",
    ok: !isLikelyBlocked,
    isGfwBlocked: isLikelyBlocked,
    metrics: {
      timeoutCount,
      errorCount,
      gfwBlockCount,
      avgLatencyMs,
    },
    details: results,
    error: isLikelyBlocked ? `Possible GFW block detected (${gfwBlockCount}/${ORIGIN_PROBE_RETRIES} probes showed blocking patterns)` : null,
  };
}

async function testOriginServersGfwBlock(workerBaseUrl) {
  console.log(`\n[${workerBaseUrl}] Testing origin servers for GFW blocking...`);
  console.log(`Origin servers: ${ORIGIN_BASE_URLS.join("; ")}`);

  const results = [];
  for (const originUrl of ORIGIN_BASE_URLS) {
    const result = await probeOriginServerGfwBlock(originUrl);
    results.push(result);
    
    const statusIcon = result.ok ? "✓" : "✗";
    const blockStatus = result.isGfwBlocked ? "[LIKELY BLOCKED]" : "[OK]";
    console.log(`  ${statusIcon} ${originUrl} ${blockStatus} avgLatency=${result.metrics.avgLatencyMs}ms timeouts=${result.metrics.timeoutCount} errors=${result.metrics.errorCount}`);
    
    if (!result.ok) {
      for (const detail of result.details) {
        const errInfo = detail.error ? ` error="${detail.error}"` : "";
        console.log(`    - Probe #${detail.index}: status=${detail.status} time=${detail.elapsedMs}ms${errInfo}`);
      }
    }
  }

  const blockedCount = results.filter((r) => r.isGfwBlocked).length;
  const totalCount = results.length;
  
  console.log(`\n[${workerBaseUrl} origin-gfw-test] Summary: ${blockedCount}/${totalCount} servers may be blocked`);

  // Return overall result (pass if at least one origin is accessible)
  const anyAccessible = results.some((r) => !r.isGfwBlocked);
  return {
    worker: workerBaseUrl,
    test: "origin-gfw-block",
    ok: anyAccessible,
    error: anyAccessible ? null : `All ${totalCount} origin servers appear to be GFW blocked`,
    details: results,
  };
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
  { name: "origin-gfw-block", fn: testOriginServersGfwBlock },
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
  console.log(`QUALITY_PROBE_COUNT=${QUALITY_PROBE_COUNT}`);
  console.log(`QUALITY_PROBE_TIMEOUT_MS=${QUALITY_PROBE_TIMEOUT_MS}`);

  const results = [];
  results.push(await probeWorkerNetworkQuality(workerBaseUrl));
  for (const tc of TEST_CASES) {
    try {
      const testResult = await tc.fn(workerBaseUrl);
      results.push({ worker: workerBaseUrl, test: tc.name, ok: true, error: null, details: testResult?.details });
    } catch (err) {
      console.error(`\n[FAIL] ${workerBaseUrl} ${tc.name}: ${err.message || err}`);
      // Preserve GFW test details even on failure
      const details = err?.details || (tc.name === "origin-gfw-block" ? err?.gfwDetails : undefined);
      results.push({ worker: workerBaseUrl, test: tc.name, ok: false, error: err.message || String(err), details });
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
  const gfwResults = []; // Collect all GFW test results

  for (const workerBaseUrl of WORKER_BASE_URLS) {
    const results = await testWorker(workerBaseUrl);
    allResults.push(...results);
    
    // Extract GFW results for final summary
    const gfwResult = results.find(r => r.test === "origin-gfw-block");
    if (gfwResult && gfwResult.details) {
      gfwResults.push(...gfwResult.details);
    }
  }

  console.log("\n========== Summary ==========");
  let hasFailure = false;
  for (const r of allResults) {
    const status = r.ok ? "PASS" : "FAIL";
    const detail = r.ok ? "" : ` -- ${r.error}`;
    console.log(`[${status}] ${r.worker} ${r.test}${detail}`);
    if (!r.ok) hasFailure = true;
  }

  // ====== GFW BLOCKING TEST RESULTS (PROMINENT DISPLAY) ======
  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          🚨 GFW BLOCKING TEST RESULTS (DIRECT CONNECT) 🚨       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("⚠️  Note: These tests use DIRECT connection (no proxy) ⚠️");
  console.log("");
  
  if (gfwResults.length === 0) {
    console.log("  No GFW test results collected.");
  } else {
    // Group by origin URL
    const originMap = new Map();
    for (const r of gfwResults) {
      if (!originMap.has(r.origin)) {
        originMap.set(r.origin, r);
      }
    }
    
    let blockedCount = 0;
    let totalCount = originMap.size;
    
    for (const [origin, result] of originMap) {
      const statusIcon = result.isGfwBlocked ? "❌ BLOCKED" : "✅ ACCESSIBLE";
      const warning = result.isGfwBlocked ? " 🚨 GFW BLOCKED 🚨" : "";
      console.log(`  ${statusIcon.padEnd(12)} │ ${origin}${warning}`);
      if (result.isGfwBlocked) {
        blockedCount++;
        if (result.error) {
          console.log(`                 │    └─> ${result.error}`);
        }
      }
    }
    
    console.log("");
    console.log(`  📊 Summary: ${blockedCount}/${totalCount} origin servers may be GFW blocked`);
    
    if (blockedCount > 0) {
      console.log("");
      console.log("  ⚠️  WARNING: Some origin servers appear to be blocked by GFW! ⚠️");
      console.log("  ⚠️  Consider using alternative domains or CDN acceleration.   ⚠️");
    } else {
      console.log("");
      console.log("  ✅ All origin servers are accessible from direct connection! ✅");
    }
  }
  
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("");

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
/**
 * Worker subscription proxy test script
 * - Uses path-based format: /json/{id}/{kind}
 * - Verifies origin proxy response and status code
 * - Runs in Node.js 18+
 */

// -------------------- Config --------------------

// Worker base URL

const WORKER_BASE_URL = "https://assets.an1688.com";
const TEST_SUB_ID = "f86607a9cc48fc6f4c98d35f058bea01";
const TEST_KIND = "openclaw";
const UA_LIST = [
  "Clash",
  "Shadowrocket",
  "Sing-box",
  "Hiddify",
  "V2RayN",
  "V2RayNG",
];
const TEST_UA = UA_LIST[0];
const WORKER_URL = `${WORKER_BASE_URL}/json/${TEST_SUB_ID}/${TEST_KIND}`;

// -------------------- Test --------------------

async function testWorker() {
  console.log(`Testing Worker URL: ${WORKER_URL}`);
  console.log(`Using User-Agent: ${TEST_UA}\n`);

  try {
    const res = await fetch(WORKER_URL, {
      method: "GET",
      headers: {
        "User-Agent": TEST_UA,
      },
    });

    console.log(`HTTP Status: ${res.status} ${res.statusText}`);

    const text = await res.text();
    console.log("\n=== Response Body ===");
    console.log(text);
    console.log("====================");

  } catch (err) {
    console.error("Error fetching Worker:", err);
  }
}

// -------------------- Run --------------------

testWorker();
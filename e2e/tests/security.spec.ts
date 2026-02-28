// E2E: CORS lockdown — sidecar only accepts requests from the registered extension origin.
//
// By the time these tests run, the extension has already connected to the sidecar,
// locking in its chrome-extension:// origin. Requests from other origins must be rejected.

import { test, expect, EXTENSION_ID } from "./fixtures.js";

const SIDECAR_URL = "http://127.0.0.1:3001";
const REAL_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

test.describe("CORS lockdown", () => {
  // Run serially — the first test registers the real extension origin,
  // subsequent tests rely on that lock being in place.
  test.describe.configure({ mode: "serial" });

  test("accepts the real extension origin and locks to it", async () => {
    const res = await fetch(`${SIDECAR_URL}/status`, {
      headers: { Origin: REAL_ORIGIN },
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("allows requests with no Origin header (same-origin / curl)", async () => {
    const res = await fetch(`${SIDECAR_URL}/status`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("rejects requests from a regular website origin", async () => {
    const res = await fetch(`${SIDECAR_URL}/status`, {
      headers: { Origin: "http://evil.com" },
    });
    expect(res.ok).toBe(false);
  });

  test("rejects requests from a different Chrome extension", async () => {
    const res = await fetch(`${SIDECAR_URL}/status`, {
      headers: { Origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    expect(res.ok).toBe(false);
  });

  test("rejects requests from localhost page origin", async () => {
    const res = await fetch(`${SIDECAR_URL}/status`, {
      headers: { Origin: "http://localhost:8081" },
    });
    expect(res.ok).toBe(false);
  });
});

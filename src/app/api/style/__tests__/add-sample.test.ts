/**
 * Tests for POST /api/style/add-sample
 *
 * Covers:
 *  - 401 when unauthenticated
 *  - 400 when body is missing or too short
 *  - 200 { ok: true, sampleCount } on success
 *  - 500 when addStyleSample fails (DB table missing etc.)  ← the bug under test
 *  - sampleCount reflects actual DB value, not a faked fallback
 */

// Mock dependencies before importing the route
jest.mock("@/lib/supabase/server");
jest.mock("@/lib/style-memory");

import { POST } from "@/app/api/style/add-sample/route";
import * as supabaseServer from "@/lib/supabase/server";
import * as styleMemory from "@/lib/style-memory";

const mockAddStyleSample  = styleMemory.addStyleSample  as jest.MockedFunction<typeof styleMemory.addStyleSample>;
const mockUpdateProfile   = styleMemory.updateStyleProfile as jest.MockedFunction<typeof styleMemory.updateStyleProfile>;
const mockCreateClient    = supabaseServer.createClient  as jest.MockedFunction<typeof supabaseServer.createClient>;

const VALID_BODY = `Hey John,

Thanks for your interest in joining. We have a few spots available.
Come in any time this week and we'll get you started.
Looking forward to seeing you!`;

function makeSupabase(profileData: unknown = null, usageOverride?: { new_count: number; exceeded: boolean }) {
  const chain = {
    select:  jest.fn().mockReturnThis(),
    eq:      jest.fn().mockReturnThis(),
    single:  jest.fn().mockResolvedValue({ data: profileData }),
  };
  // Default: under the daily cap. Tests can pass usageOverride to simulate 429.
  const rpc = jest.fn().mockResolvedValue({
    data:  [usageOverride ?? { new_count: 1, exceeded: false }],
    error: null,
  });
  return { from: jest.fn().mockReturnValue(chain), rpc } as unknown as Awaited<ReturnType<typeof supabaseServer.createClient>>;
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/style/add-sample", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateProfile.mockResolvedValue(undefined);
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

test("returns 401 when user is not authenticated", async () => {
  const supabase = makeSupabase();
  (supabase as unknown as Record<string, unknown>).auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
  };
  mockCreateClient.mockResolvedValue(supabase);

  const res = await POST(makeRequest({ body: VALID_BODY }));
  expect(res.status).toBe(401);
});

// ─── Input validation ─────────────────────────────────────────────────────────

test("returns 400 when body field is missing", async () => {
  const supabase = makeSupabase();
  (supabase as unknown as Record<string, unknown>).auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
  };
  mockCreateClient.mockResolvedValue(supabase);

  const res = await POST(makeRequest({}));
  expect(res.status).toBe(400);
});

test("returns 400 when email text is shorter than 20 chars", async () => {
  const supabase = makeSupabase();
  (supabase as unknown as Record<string, unknown>).auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
  };
  mockCreateClient.mockResolvedValue(supabase);

  const res = await POST(makeRequest({ body: "Too short." }));
  expect(res.status).toBe(400);
});

// ─── Success path ─────────────────────────────────────────────────────────────

test("returns { ok: true } and real sample count on success", async () => {
  const supabase = makeSupabase({ sample_count: 3 });
  (supabase as unknown as Record<string, unknown>).auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
  };
  mockCreateClient.mockResolvedValue(supabase);
  mockAddStyleSample.mockResolvedValue({ saved: true });

  const res  = await POST(makeRequest({ body: VALID_BODY }));
  const data = await res.json();

  expect(res.status).toBe(200);
  expect(data.ok).toBe(true);
  expect(data.sampleCount).toBe(3); // real DB value, not a fake fallback
});

// ─── Bug: silent DB failure ───────────────────────────────────────────────────

test("BUG: returns 500 (not 200) when addStyleSample fails", async () => {
  const supabase = makeSupabase(null); // profile doesn't exist — tables not set up
  (supabase as unknown as Record<string, unknown>).auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
  };
  mockCreateClient.mockResolvedValue(supabase);
  mockAddStyleSample.mockResolvedValue({
    saved:  false,
    reason: 'relation "style_samples" does not exist',
  });

  const res  = await POST(makeRequest({ body: VALID_BODY }));
  const data = await res.json();

  expect(res.status).toBe(500);
  expect(data.ok).toBeUndefined();   // must NOT return ok:true on failure
  expect(data.error).toBeTruthy();
});

// ─── Daily usage cap ──────────────────────────────────────────────────────────

test("returns 429 when increment_usage reports exceeded", async () => {
  const supabase = makeSupabase({ sample_count: 50 }, { new_count: 51, exceeded: true });
  (supabase as unknown as Record<string, unknown>).auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
  };
  mockCreateClient.mockResolvedValue(supabase);

  const res  = await POST(makeRequest({ body: VALID_BODY }));
  const data = await res.json();

  expect(res.status).toBe(429);
  expect(data.error).toMatch(/daily limit/i);
  // Must NOT have tried to write a sample after rejection
  expect(mockAddStyleSample).not.toHaveBeenCalled();
});

test("BUG: sampleCount must not return fake value 1 when profile is null", async () => {
  const supabase = makeSupabase(null); // style_profile row doesn't exist
  (supabase as unknown as Record<string, unknown>).auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
  };
  mockCreateClient.mockResolvedValue(supabase);
  mockAddStyleSample.mockResolvedValue({ saved: true });

  const res  = await POST(makeRequest({ body: VALID_BODY }));
  const data = await res.json();

  // When profile is null (no rows yet), sampleCount must be 0 or 1 (the newly inserted),
  // but NEVER a hardcoded fake value that masks the real state.
  // The ?? 1 bug returns 1 even when 0 samples were actually saved.
  expect(res.status).toBe(200);
  expect(typeof data.sampleCount).toBe("number");
  expect(data.sampleCount).not.toBe(1); // was the old buggy hardcoded fallback — must be 0
});

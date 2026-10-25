// npm test  (builds, then runs against dist/). Mocked transport in the real response shapes of movoa.ai; no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthError, BusyError, GenerationError, MovoaError, PlanError, QuotaError, RejectedError, TimeoutError,
  credits, generateVideo, status, submit, wait,
} from "./dist/mod.js";

const ok = (data) => [200, { code: 0, message: "ok", data }];
function fake(calls, polls, submitReply = ok({ id: "t1", status: "pending" })) {
  polls = [...polls];
  return async (url, init) => {
    calls.push({ url, body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers });
    const [s, json] = url.endsWith("/api/ai/generate") ? submitReply
      : url.endsWith("/api/ai/query") ? ok(polls.shift())
      : ok({ remainingCredits: 42 });
    return new Response(typeof json === "string" ? json : JSON.stringify(json), { status: s });
  };
}

test("text to video: sends the site contract and polls until success", async () => {
  const calls = [];
  const url = await generateVideo("a boat", {
    apiKey: "sk-abc", pollEvery: 0, baseUrl: "https://t", duration: 6,
    fetch: fake(calls, [{ id: "t1", status: "pending", queued: true, queueEta: 30 }, { id: "t1", status: "processing" }, { id: "t1", status: "success", videos: ["https://cdn/v.mp4"] }]),
  });
  assert.equal(url, "https://cdn/v.mp4");
  assert.equal(calls[0].url, "https://t/api/ai/generate");
  assert.equal(calls[0].headers.authorization, "Bearer sk-abc");
  assert.deepEqual(calls[0].body, {
    provider: "auto", mediaType: "video", model: "minimax-h3", scene: "text-to-video", prompt: "a boat",
    options: { sound: true, duration: 6 },
  });
  assert.deepEqual(calls[1].body, { taskId: "t1" });
  assert.equal(calls.length, 4);
});

test("photo to video switches scene and sends image_input", async () => {
  const calls = [];
  await submit("orbit", { model: "seedance-2-5", imageUrl: "https://x/y.jpg", aspectRatio: "9:16" }, { apiKey: "sk", fetch: fake(calls, []) });
  assert.equal(calls[0].body.scene, "image-to-video");
  assert.equal(calls[0].body.model, "seedance-2-5");
  assert.deepEqual(calls[0].body.options, { sound: true, aspect_ratio: "9:16", image_input: ["https://x/y.jpg"] });
});

test("MOVOA_BASE_URL overrides the host", async () => {
  process.env.MOVOA_BASE_URL = "http://localhost:3000/";
  const calls = [];
  await credits({ apiKey: "sk", fetch: fake(calls, []) });
  assert.equal(calls[0].url, "http://localhost:3000/api/user/get-user-credits");
  delete process.env.MOVOA_BASE_URL;
});

for (const [s, body, cls] of [
  [401, { code: -1, message: "Invalid API key. Create one at https://movoa.ai/settings/apikeys", data: { reason: "invalid_api_key" } }, AuthError],
  [401, "<html>unauthorized</html>", AuthError],
  [200, { code: -1, message: "insufficient credits", data: { reason: "insufficient_credits" } }, QuotaError],
  [200, { code: -1, message: "This model or quality needs a plan.", data: { reason: "plan_required" } }, PlanError],
  [200, { code: -1, message: "busy", data: { reason: "concurrency" } }, BusyError],
  [200, { code: -2, message: "blocked" }, RejectedError],
  [200, { code: -3, message: "cooldown" }, RejectedError],
  [200, { code: -1, message: "no auth, please sign in" }, AuthError],
  [200, { code: -1, message: "generation failed, please try again" }, MovoaError],
  [502, "Bad gateway", MovoaError],
]) {
  test(`submit ${s} ${typeof body === "string" ? body : body.data?.reason ?? body.message} -> ${cls.name}`, async () => {
    await assert.rejects(submit("x", {}, { apiKey: "sk", fetch: fake([], [], [s, body]) }), (e) => e.constructor === cls && e instanceof MovoaError);
  });
}

test("failed and canceled runs throw GenerationError with errorMessage", async () => {
  await assert.rejects(
    generateVideo("x", { apiKey: "sk", pollEvery: 0, fetch: fake([], [{ id: "t1", status: "failed", errorMessage: "provider down", failureKind: "upstream" }]) }),
    (e) => e instanceof GenerationError && e.kind === "failed" && e.errorMessage === "provider down" && e.failureKind === "upstream" && e.taskId === "t1",
  );
  await assert.rejects(wait("t1", { apiKey: "sk", pollEvery: 0, fetch: fake([], [{ id: "t1", status: "canceled" }]) }), GenerationError);
});

test("timeout carries the task id", async () => {
  const polls = Array(5).fill({ id: "t1", status: "processing", queued: true, queueEta: 60 });
  await assert.rejects(wait("t1", { apiKey: "sk", pollEvery: 5, timeout: 1, fetch: fake([], polls) }), (e) => e instanceof TimeoutError && e.taskId === "t1");
});

test("status and credits", async () => {
  const t = await status("t1", { apiKey: "sk", fetch: fake([], [{ id: "t1", status: "success", videos: ["https://cdn/v.mp4"] }]) });
  assert.equal(t.videos[0], "https://cdn/v.mp4");
  assert.equal(await credits({ apiKey: "sk", fetch: fake([], []) }), 42);
  const noAuth = async () => new Response(JSON.stringify({ code: -1, message: "no auth, please sign in" }));
  await assert.rejects(credits({ apiKey: "sk", fetch: noAuth }), AuthError);
});

test("no key -> AuthError without a request", async () => {
  const saved = process.env.MOVOA_API_KEY;
  delete process.env.MOVOA_API_KEY;
  await assert.rejects(credits({ fetch: async () => { throw new Error("should not be called"); } }), AuthError);
  if (saved) process.env.MOVOA_API_KEY = saved;
});

// Live (after key auth is live on movoa.ai): MOVOA_LIVE=1 MOVOA_API_KEY=sk-... npm test
test("live smoke", { skip: !process.env.MOVOA_LIVE }, async () => {
  assert.ok((await credits()) >= 0);
  await assert.rejects(submit("test", {}, { apiKey: "sk-wrong-key-for-test" }), AuthError);
});

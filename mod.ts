// Official SDK for Movoa (movoa.ai), the AI video generator with sound. See README.md.

/** The service this module talks to. */
export const BASE_URL = "https://movoa.ai";
/** Where users create API keys. */
export const KEYS_URL: string = `${BASE_URL}/settings/apikeys`;

/** Model ids. `minimax-h3` is the default and the cheapest. */
export const MODELS = [
  "minimax-h3", "veo-3-1-fast", "seedance-2-5", "seedance-2", "seedance-2-fast", "seedance-2-mini",
] as const;
export const DEFAULT_MODEL = "minimax-h3";

/**
 * What went wrong, so callers can decide what to do next.
 * auth: no or bad key · quota: not enough credits · plan: model or quality needs a plan ·
 * busy: too many runs at once · rejected: content filter or cooldown, reword ·
 * failed: the run was accepted but failed or was canceled · timeout: still running, check later ·
 * other: any other refusal, network failure or unexpected answer
 */
export type ErrorKind = "auth" | "quota" | "plan" | "busy" | "rejected" | "failed" | "timeout" | "other";

/** Every failure is a MovoaError; branch on `kind` or on the subclass. */
export class MovoaError extends Error {
  /** HTTP status, when there was a response. */
  status?: number;
  /** Envelope code (0, -1, -2, -3). */
  code?: number;
  /** `data.reason` the service sent, if any. */
  reason?: string;
  /** The run this is about (failed and timeout). */
  taskId?: string;
  constructor(message: string, readonly kind: ErrorKind = "other", extra: { status?: number; code?: number; reason?: string; taskId?: string } = {}) {
    super(message);
    this.name = "MovoaError";
    Object.assign(this, extra);
  }
}
/** No API key, or the key is invalid or deleted. */
export class AuthError extends MovoaError {
  constructor(m: string, e = {}) { super(m, "auth", e); this.name = "AuthError"; }
}
/** The account does not have enough credits for this run. */
export class QuotaError extends MovoaError {
  constructor(m: string, e = {}) { super(m, "quota", e); this.name = "QuotaError"; }
}
/** This model or quality needs a plan, or the account has never bought credits. */
export class PlanError extends MovoaError {
  constructor(m: string, e = {}) { super(m, "plan", e); this.name = "PlanError"; }
}
/** Too many runs on this account are generating at once. */
export class BusyError extends MovoaError {
  constructor(m: string, e = {}) { super(m, "busy", e); this.name = "BusyError"; }
}
/** The content filter refused the prompt (code -2) or a cooldown is active (code -3). Reword it. */
export class RejectedError extends MovoaError {
  constructor(m: string, e = {}) { super(m, "rejected", e); this.name = "RejectedError"; }
}
/** The run was accepted but ended as failed or canceled. */
export class GenerationError extends MovoaError {
  constructor(m: string, readonly errorMessage?: string, readonly failureKind?: string, taskId?: string) {
    super(m, "failed", { taskId });
    this.name = "GenerationError";
  }
}
/** The wait ran out; the run may still finish. `taskId` lets you check it later. */
export class TimeoutError extends MovoaError {
  constructor(m: string, taskId: string) { super(m, "timeout", { taskId }); this.name = "TimeoutError"; }
}

/** Connection options shared by every call. */
export interface ClientOptions {
  /** Defaults to the `MOVOA_API_KEY` environment variable. */
  apiKey?: string;
  /** Defaults to `MOVOA_BASE_URL`, then https://movoa.ai. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Options for calls that wait for the result. */
export interface WaitOptions extends ClientOptions {
  /** Milliseconds. Default 30 minutes. */
  timeout?: number;
  /** Milliseconds between polls. Default 10 seconds. */
  pollEvery?: number;
}

/** What to generate. Anything not listed is sent in `options` as it is. */
export interface VideoOptions {
  model?: string;
  /** A public https image; turns the run into photo to video with it as the first frame. */
  imageUrl?: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  /** Extra model options, sent as they are. */
  options?: Record<string, unknown>;
}

/** The run record returned by `status`. */
export interface Task {
  id: string;
  status: "pending" | "processing" | "success" | "failed" | "canceled" | string;
  videos?: string[];
  errorMessage?: string;
  failureKind?: string;
  queued?: boolean;
  /** Seconds. */
  queueEta?: number;
  [k: string]: unknown;
}

// deno-lint-ignore no-explicit-any
type Envelope = { code?: number; message?: string; data?: any };

function env(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  try {
    return g.process?.env?.[name] ?? g.Deno?.env?.get(name);
  } catch {
    return undefined; // Deno without --allow-env
  }
}

/**
 * Map a refusal to the error that says what to do next. movoa.ai answers almost
 * every refusal as HTTP 200 with a non-zero `code` and a `data.reason`.
 */
export function errorFor(status: number, body: Envelope): MovoaError {
  const message = body.message || `request failed (HTTP ${status})`;
  const reason = typeof body.data?.reason === "string" ? body.data.reason : undefined;
  const extra = { status, code: body.code, reason };
  if (status === 401) return new AuthError(message.includes(KEYS_URL) ? message : `${message} (create a key at ${KEYS_URL})`, extra);
  if (body.code === -2 || body.code === -3) return new RejectedError(message, extra);
  if (reason === "insufficient_credits") return new QuotaError(message, extra);
  if (reason === "plan_required") return new PlanError(message, extra);
  if (reason === "concurrency") return new BusyError(message, extra);
  if (/no auth/i.test(message)) return new AuthError(`${message}. Create a key at ${KEYS_URL}`, extra);
  return new MovoaError(message, "other", extra);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(path: string, body: unknown, o: ClientOptions): Promise<Envelope> {
  const key = (o.apiKey || env("MOVOA_API_KEY") || "").trim();
  if (!key) throw new AuthError(`No API key: pass apiKey or set MOVOA_API_KEY. Create a key at ${KEYS_URL}`);
  const base = (o.baseUrl || env("MOVOA_BASE_URL") || BASE_URL).replace(/\/$/, "");
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new MovoaError(`Could not reach movoa.ai: ${(e as Error).message}`, "other");
  }
  const text = await res.text();
  let json: Envelope | undefined;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = undefined;
  }
  if (res.status === 401) throw errorFor(401, json ?? {});
  if (!json || typeof json !== "object") throw new MovoaError(`movoa.ai returned a non-JSON response (HTTP ${res.status})`, "other", { status: res.status });
  if (res.status < 400 && json.code === 0) return json;
  throw errorFor(res.status, json);
}

/** Start one run and resolve to its task id without waiting. */
export async function submit(prompt: string, v: VideoOptions = {}, o: ClientOptions = {}): Promise<string> {
  if (!prompt?.trim()) throw new TypeError("prompt is required");
  const options: Record<string, unknown> = { sound: true };
  for (const [k, val] of Object.entries(v.options ?? {})) if (val !== undefined && val !== null) options[k] = val;
  if (v.duration !== undefined) options.duration = v.duration;
  if (v.resolution !== undefined) options.resolution = v.resolution;
  if (v.aspectRatio !== undefined) options.aspect_ratio = v.aspectRatio;
  if (v.imageUrl) options.image_input = [v.imageUrl];
  const json = await post("/api/ai/generate", {
    // The server routes by model; this only has to be non-empty.
    provider: "auto",
    mediaType: "video",
    model: v.model ?? DEFAULT_MODEL,
    scene: v.imageUrl ? "image-to-video" : "text-to-video",
    prompt,
    options,
  }, o);
  const id = json.data?.id;
  if (!id) throw new MovoaError("movoa.ai accepted the run but returned no id", "other");
  return String(id);
}

/** Fetch the run record: `status` is pending, processing, success, failed or canceled. */
export async function status(taskId: string, o: ClientOptions = {}): Promise<Task> {
  const json = await post("/api/ai/query", { taskId }, o);
  return (json.data ?? {}) as Task;
}

/** Poll a run until it finishes and resolve to the video URL. */
export async function wait(taskId: string, o: WaitOptions = {}): Promise<string> {
  const timeout = o.timeout ?? 30 * 60_000;
  const every = o.pollEvery ?? 10_000;
  const deadline = Date.now() + timeout;
  for (;;) {
    const t = await status(taskId, o);
    if (t.status === "success") {
      if (!t.videos?.length) throw new GenerationError(`run ${taskId} finished with no video`, undefined, undefined, taskId);
      return String(t.videos[0]);
    }
    if (t.status === "failed" || t.status === "canceled") {
      throw new GenerationError(`run ${taskId} ${t.status}${t.errorMessage ? `: ${t.errorMessage}` : ""}`, t.errorMessage, t.failureKind, taskId);
    }
    if (Date.now() + every > deadline) {
      throw new TimeoutError(`run ${taskId} is still generating; check it later with status()`, taskId);
    }
    await sleep(every);
  }
}

/** Generate one clip with sound and resolve to its URL. */
export async function generateVideo(prompt: string, v: VideoOptions & WaitOptions = {}): Promise<string> {
  return wait(await submit(prompt, v, v), v);
}

/** Resolve to the remaining credits on the account. */
export async function credits(o: ClientOptions = {}): Promise<number> {
  const json = await post("/api/user/get-user-credits", undefined, o);
  return Number(json.data?.remainingCredits ?? 0);
}

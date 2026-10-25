# movoa

Unlimited AI video generator with sound: on paid plans the tenth take of a shot costs what the first did, and your first clip is free to make right now. This is the official TypeScript / JavaScript SDK for [Movoa](https://movoa.ai/?utm_source=npm&utm_medium=package), for Node 18+, Deno and Bun: one API key turns a prompt into [text to video](https://movoa.ai/video/text-to-video), or a still into [photo to video](https://movoa.ai/video/photo-to-video), and every clip comes back as [AI video with audio](https://movoa.ai/video/ai-video-with-audio).

```bash
npm install movoa
# Deno / JSR
deno add jsr:@movoa/movoa
```

```ts
import { generateVideo } from "movoa";

const clip = await generateVideo("a paper boat drifting down a rain gutter, low angle, slow push-in");
console.log(clip); // URL of the finished MP4, sound included
```

Uses the global `fetch`, no dependencies. `generateVideo` submits the run, waits for it and resolves to the URL of the finished file.

## API key

Sign in on [movoa.ai](https://movoa.ai/?utm_source=npm&utm_medium=package), create a key at [movoa.ai/settings/apikeys](https://movoa.ai/settings/apikeys), then pass it as `apiKey` or set it in the environment:

```bash
export MOVOA_API_KEY=sk-...
```

Runs cost credits on your Movoa account, at the prices on [movoa.ai/pricing](https://movoa.ai/pricing).

```ts
import { credits } from "movoa";
console.log(await credits()); // remaining credits on the account
```

## Text to video and photo to video

```ts
// text to video, vertical, 10 seconds
await generateVideo("a fox trotting through fresh snow at dawn, tracking shot", { duration: 10, aspectRatio: "9:16" });

// photo to video: the photo becomes the first frame
await generateVideo("the camera slowly orbits the statue", { imageUrl: "https://example.com/statue.jpg" });

// another model
await generateVideo("a street drummer in the rain, close-up", { model: "seedance-2-5", duration: 10, resolution: "720p" });
```

| model | options |
|---|---|
| `minimax-h3` (default) | `duration` 4 / 5 / 6 / 8 / 10 / 15 · `resolution` 480p / 768p · `aspectRatio` 16:9 / 9:16 / 1:1 |
| `veo-3-1-fast` | `duration` 8 · `resolution` 720p · `aspectRatio` 16:9 / 9:16 (photo to video: 16:9) |
| `seedance-2-5` | `duration` 5 / 10 / 15 / 20 / 25 / 30 · `resolution` 480p / 720p · `aspectRatio` 16:9 / 9:16 / 1:1 |
| `seedance-2`, `seedance-2-fast`, `seedance-2-mini` | `duration` 4 / 6 / 8 / 10 · `resolution` 480p / 720p · `aspectRatio` |

Anything else goes in `options: { … }` and is sent as it is. Every run asks for sound. On the site: [Seedance 2.5](https://movoa.ai/video/seedance-2-5) and [Veo 3](https://movoa.ai/video/google-veo-3).

## Submit now, collect later

```ts
import { submit, status, wait } from "movoa";

const id = await submit("a lighthouse in a storm, waves crashing", { duration: 6 });
console.log((await status(id)).status); // pending | processing | success | failed | canceled
const url = await wait(id);             // polls every 10 seconds, 30 minutes by default
```

While a run waits in line, `status()` returns `queued: true` and `queueEta` in seconds.

## Errors worth catching

Every failure is a `MovoaError` with a `kind`, and a subclass you can test with `instanceof`:

- `AuthError` (`auth`): no key, or the key is wrong or deleted; create one at [movoa.ai/settings/apikeys](https://movoa.ai/settings/apikeys)
- `QuotaError` (`quota`): the account does not have enough credits for this run
- `PlanError` (`plan`): that model or quality needs a plan on the account
- `BusyError` (`busy`): too many runs on this account are generating at once
- `RejectedError` (`rejected`): the content filter refused the prompt, or a cooldown is active; reword it
- `GenerationError` (`failed`): the run was accepted but failed or was canceled; `.errorMessage` says why
- `TimeoutError` (`timeout`): the wait ran out; `.taskId` lets you check the run later with `status()`

Any other refusal is a plain `MovoaError` (`other`) with the server's message.

MIT licensed. Made by [Movoa](https://movoa.ai/?utm_source=npm&utm_medium=package).

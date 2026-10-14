# pi-jev-ext-router

pi-jev-ext-router is a [pi](https://github.com/earendil-works/pi-coding-agent) extension that activates the right lazily loaded extension before the model turn starts. It sends each prompt to Jev, a decision model from TypeSafe served through OpenRouter, asks which entry of the [pi-lazy-extensions](https://github.com/nicobailon/pi-lazy-extensions) manifest the prompt needs, and runs the loader's `/ext activate` command for the answer. The model then begins the turn with the tools already present instead of spending two or three round trips on `ext({ search })` and `ext({ activate })`.

## Requirements

The extension needs three things in place before it does anything useful.

- pi 1.0 or later with `pi-lazy-extensions` installed and a `lazy-extensions.json` manifest. The router reads the same manifest file, in the same search order, and never loads code itself.
- An OpenRouter API key with access to `typesafe/jev-1.13`. The key is read from the `OPENROUTER_API_KEY` environment variable, or from a dotenv-style file at `~/.config/jev/openrouter.env` containing one `OPENROUTER_API_KEY=...` line.
- Node 22 or later, which pi already requires.

## Install

```sh
pi install git:github.com/shourovrm/pi-jev-ext-router
```

For a local checkout, install the directory path instead:

```sh
git clone https://github.com/shourovrm/pi-jev-ext-router ~/repos/pi-jev-ext-router
pi install ~/repos/pi-jev-ext-router
```

The package has no runtime dependencies, so a local install needs no `npm install` step.

## Turning it on

Routing is off when a session starts, because every routed prompt leaves the machine. Turn it on in one of three ways.

- `/jev-router on` inside a session. The choice is saved in the session file and survives a resume.
- `pi --jev-router` on the command line for a single session.
- `"defaultEnabled": true` in the config file below, for every session.

`/jev-router off` turns it off again. `/jev-router status` shows the current state, the manifest in use, and the log path. `/jev-router try <text>` asks Jev about a piece of text and reports what would be activated without activating anything.

`/jev-router probe` activates every offered manifest entry in turn and reports which ones exposed new tools. Run it once after editing the manifest or updating packages. An entry that exposes nothing has either a stale path, which happens when a package update moves its entry file, or registers its tools inside a `session_start` handler, which pi-lazy-extensions cannot replay for an extension loaded mid-session. The second kind has to load eagerly as a normal pi package and be removed from the manifest. The probe also runs from the command line:

```sh
pi -p "/jev-router probe"
```

## Configuration

Settings live in `<agent-dir>/jev-ext-router.json`, which is `~/.pi/agent/jev-ext-router.json` by default. Every key is optional. The values below are the defaults.

```json
{
  "defaultEnabled": false,
  "minProbability": 0.35,
  "maxActivations": 2,
  "timeoutMs": 3000,
  "activationWaitMs": 2000,
  "minPromptLength": 8,
  "model": "typesafe/jev-1.13",
  "keyFile": "~/.config/jev/openrouter.env",
  "exclude": [],
  "cueGate": true,
  "extraCues": []
}
```

`minProbability` is the gate for activation. Jev returns a probability for every extension in the manifest plus a `none` option, and every extension at or above the gate is activated, up to `maxActivations` of them, highest probability first. The gate is a probability rather than Jev's summary confidence on purpose: a prompt such as "search for the release notes and read the page" splits its mass between a search extension and a fetch extension, which looks unsure to a confidence threshold but is two correct activations.

`timeoutMs` bounds how long a prompt waits on Jev. Jev answers in about 0.6 s when called on its own, but the first routed prompt of a session shares the event loop with extensions that are still starting, and measured 1.3 to 1.6 s there, so the default leaves room for that. When Jev does not answer in time, or returns an error, the prompt goes through unrouted and a warning names the reason.

`activationWaitMs` bounds how long the router waits for pi-lazy-extensions to finish loading one extension. Pi's extension API does not return the loader's completion, so the router watches pi's active tool list and moves on as soon as new tools appear.

`cueGate` and `extraCues` control the local gate described below. Add a word to `extraCues` when a kind of prompt you use often should reach Jev and none of the built-in cues covers it, for example `"kubectl"`.

`exclude` lists manifest entries that Jev is never offered. Entries with `"lifecycle": "eager"` or `"keep-alive"` are left out automatically, since they are loaded already.

## The cue gate

Most prompts need no lazy extension, so the router decides locally first whether Jev is worth asking. A prompt goes to Jev only when it contains a cue: a URL or domain, or one of about 75 words and phrases in `src/cues.ts` such as "search", "fetch", "docs", "screenshot", "image", "ssh" or "second opinion", plus the name of each lazy extension in the manifest. A prompt such as `rename parse_row to parse_line` has no cue, reaches the model at once, and never leaves the machine.

Matching tolerates typing slips. Words of five to eight letters match with one typo and longer words with two, where a typo is a missing, extra, wrong or swapped letter, so "serach", "documnetation" and "screnshot" all count. Cues of four letters or fewer must match exactly, because too many ordinary words sit one letter away from "web" or "ssh". A cue also matches with a regular ending: "searching", "images", "fetched", "browsing". Cues containing a digit, such as "context7", never take typos. Manifest tags are not used as cues because they contain everyday coding words such as "tools", "process" and "ui".

Measured on 1,146 prompts typed into pi between May and October 2026, the gate keeps 57% of prompts away from Jev. Of the prompts after which the model actually used a lazy tool, 69% would still have reached Jev. Most of the rest were short follow-ups such as "how about France?" sent while the needed tool was already loaded, which the next rule covers.

## Already-loaded skip

The router remembers, per group of related cues, which extensions Jev chose earlier in the session. The groups are the sections of `CUE_GROUPS` in `src/cues.ts`, so a URL, "fetch" and "search" are one group. When a later prompt's cue falls in the same group and those extensions are still loaded, the router skips Jev.

"Still loaded" is read from pi's active tool list, not from a timer. pi-lazy-extensions unloads an idle extension by removing its tools from that list, so the check stays correct whatever its idle timeout is. The router learns which tools each extension adds from what appears when it loads, and keeps that map in `~/.local/state/jev-ext-router/tools.json` so it also works in the next session. `/jev-router probe` fills the map for every manifest entry at once.

## What a routed prompt looks like

A prompt such as `find the current npm version of vitest` goes through four steps.

1. The `input` hook checks that routing is on and that the text is not a slash command, a `!` shell line, an extension-generated message, or shorter than `minPromptLength`. It then applies the cue gate and the already-loaded skip above.
2. The prompt text and the manifest's names, descriptions and tags go to `POST https://openrouter.ai/api/alpha/decisions` with `provider: { data_collection: "deny", zdr: true }`, so OpenRouter refuses rather than route the text to a provider that trains on or retains prompts. A call takes about half a second and costs about 0.000015 USD.
3. Every extension at or above `minProbability` is activated with `/ext activate <name>`, which pi-lazy-extensions handles before any model call. An extension whose tools are already active is not activated again.
4. The prompt continues unchanged into the normal turn. The `ext` proxy tool stays available as the fallback for anything Jev missed.

Each decision appends one line to `~/.local/state/jev-ext-router/log.jsonl` (or `$XDG_STATE_HOME/jev-ext-router/log.jsonl`) with the chosen option, the probabilities, what was activated, the cost and the elapsed time. The prompt text is never written to the log.

## Debugging

Set `JEV_ROUTER_DEBUG=1` to print each routing stage with elapsed milliseconds on stderr:

```sh
JEV_ROUTER_DEBUG=1 pi -p "fetch https://example.com and give me the title"
```

```text
[jev-router +286ms] input received
[jev-router +287ms] asking Jev
[jev-router +1640ms] Jev answered webfetch in 1353 ms
[jev-router +1641ms] activating webfetch
[jev-router +1717ms] input handler done
```

## Privacy and cost

Every routed prompt is sent to OpenRouter and TypeSafe. The request carries the privacy settings above, but the text still leaves the machine, which is why routing is off by default and the switch is per session. Keep it off for private work.

Cost is roughly 0.000015 USD per routed prompt at Jev's current pricing, so one thousand routed prompts cost about 0.015 USD.

## Development

```sh
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run check     # biome lint and format check
```

Tests cover the pure parts: config and key-file parsing, catalogue building from a manifest, cue matching with typos, the tool ledger, the activation rule, the input filter, and the request body and response parsing for Jev. The pi integration in `index.ts` is exercised by installing the package and running `pi --jev-router -p "..."`.

## Limitations

- The router only works alongside pi-lazy-extensions. It reaches the loader through its `/ext activate` slash command, because the loader keeps its registry private, so a loader without that command leaves the router with nothing to do and it says so.
- A wrong activation costs one extension load, not a wrong answer. A missed activation falls back to the model calling `ext` itself.
- Only one Jev question is asked per prompt. Prompts that need three or more extensions get the top `maxActivations` of them.

## License

MIT

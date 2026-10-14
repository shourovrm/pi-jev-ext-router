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
  "timeoutMs": 1500,
  "activationWaitMs": 2000,
  "minPromptLength": 8,
  "model": "typesafe/jev-1.13",
  "keyFile": "~/.config/jev/openrouter.env",
  "exclude": []
}
```

`minProbability` is the gate for activation. Jev returns a probability for every extension in the manifest plus a `none` option, and every extension at or above the gate is activated, up to `maxActivations` of them, highest probability first. The gate is a probability rather than Jev's summary confidence on purpose: a prompt such as "search for the release notes and read the page" splits its mass between a search extension and a fetch extension, which looks unsure to a confidence threshold but is two correct activations.

`timeoutMs` bounds how long a prompt waits on Jev. When Jev does not answer in time, or returns an error, the prompt goes through unrouted and a warning names the reason.

`activationWaitMs` bounds how long the router waits for pi-lazy-extensions to finish loading one extension. Pi's extension API does not return the loader's completion, so the router watches the tool registry for the new tools and moves on as soon as they appear. A repeat activation inside the loader's `idleTimeout` window is known to be a no-op and is not waited for at all.

`exclude` lists manifest entries that Jev is never offered. Entries with `"lifecycle": "eager"` or `"keep-alive"` are left out automatically, since they are loaded already.

## What a routed prompt looks like

A prompt such as `find the current npm version of vitest` goes through four steps.

1. The `input` hook checks that routing is on and that the text is not a slash command, a `!` shell line, an extension-generated message, or shorter than `minPromptLength`.
2. The prompt text and the manifest's names, descriptions and tags go to `POST https://openrouter.ai/api/alpha/decisions` with `provider: { data_collection: "deny", zdr: true }`, so OpenRouter refuses rather than route the text to a provider that trains on or retains prompts. A call takes about half a second and costs about 0.000015 USD.
3. Every extension at or above `minProbability` is activated with `/ext activate <name>`, which pi-lazy-extensions handles before any model call. Activation of an already loaded extension is a no-op.
4. The prompt continues unchanged into the normal turn. The `ext` proxy tool stays available as the fallback for anything Jev missed.

Each decision appends one line to `~/.local/state/jev-ext-router/log.jsonl` (or `$XDG_STATE_HOME/jev-ext-router/log.jsonl`) with the chosen option, the probabilities, what was activated, the cost and the elapsed time. The prompt text is never written to the log.

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

Tests cover the pure parts: config and key-file parsing, catalogue building from a manifest, the activation rule, the input filter, and the request body and response parsing for Jev. The pi integration in `index.ts` is exercised by installing the package and running `pi --jev-router -p "..."`.

## Limitations

- The router only works alongside pi-lazy-extensions. It reaches the loader through its `/ext activate` slash command, because the loader keeps its registry private, so a loader without that command leaves the router with nothing to do and it says so.
- A wrong activation costs one extension load, not a wrong answer. A missed activation falls back to the model calling `ext` itself.
- Only one Jev question is asked per prompt. Prompts that need three or more extensions get the top `maxActivations` of them.

## License

MIT

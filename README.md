# KataGo Coach

SvelteKit MVP for a Go teaching board:

- `goban` from online-go for the interactive board and rules engine
- `/api/analyze` for KataGo JSON analysis
- `/api/chat` for an AI SDK chat response grounded in the latest analysis
- `scripts/katago-json-service.mjs` for a persistent local KataGo analysis process

## Run the app

```sh
npm install
npm run dev
```

For another device on your local network, such as an iPhone, run:

```sh
npm run dev -- --host 0.0.0.0
```

Then open the app with your computer's LAN IP address, for example `http://192.168.1.42:5173`.

## Run KataGo analysis

Install KataGo, download a model, then set the paths in `.env`:

```sh
cp .env.example .env
npm run katago:service
```

In another terminal:

```sh
npm run dev
```

KataGo's analysis engine accepts one JSON query per line over stdin and returns JSON results over stdout. The bridge keeps that process alive and exposes `POST /analyze` for SvelteKit.

The bridge loads local `.env` values automatically, so this command is enough once `KATAGO_CONFIG` and `KATAGO_MODEL` are set:

```sh
npm run katago:service
```

With Homebrew's KataGo package, usable local defaults look like:

```sh
KATAGO_BIN=/usr/local/bin/katago
KATAGO_CONFIG=/usr/local/Cellar/katago/1.16.4/share/katago/configs/analysis_example.cfg
KATAGO_MODEL=/usr/local/Cellar/katago/1.16.4/share/katago/g170e-b20c256x2-s5303129600-d1228401921.bin.gz
KATAGO_ANALYSIS_URL=http://localhost:8719/analyze
```

## Local SGF libraries

Downloaded SGF archives and extracted games live under `data/sgf`, which is intentionally ignored by git.

Current local sources:

- CWI/A.E. Brouwer public-domain database: `data/sgf/cwi`
- Joe's Go Database public-domain dataset: `data/sgf/jgdb`

These are local data files for indexing/import work. They are not committed to the GitHub repository.

## Local engine controls

In development, the Settings modal includes local engine controls:

- Start Engines
- Start KataGo
- Start Ollama
- Pull the selected Ollama model
- Refresh engine status

These buttons call `/api/local-engines`, which only accepts a small allowlist of local actions and is disabled outside SvelteKit development mode. This is intended for your personal MacBook/iPhone-over-LAN setup, not for a public deployment.

## Chat layer

Open the Settings button in the app to enter:

- LLM provider: Ollama local or OpenAI API
- Ollama URL and model
- OpenAI API key
- OpenAI model
- KataGo analysis URL

Those values are stored server-side for the current browser session and are not echoed back to the browser. `.env` values are still supported as defaults/fallbacks.

For personal local use, the app defaults to Ollama when no OpenAI key is configured:

```sh
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:3b
```

`/api/chat` sends the latest position and KataGo JSON analysis to Ollama's local `/api/chat` endpoint. If Ollama is unavailable, it returns a local fallback that refuses to invent strategy and shows the provider error.

The Settings panel includes these local model presets:

- `llama3.2:3b`: fast default coach model
- `gemma3:4b`: slightly larger explanation model
- `qwen3:4b`: stronger reasoning, usually slower
- `phi4-mini`: compact reasoning model
- `gpt-oss:20b`: deeper but much slower on CPU-only local runs

The app sends only server-side requests to OpenAI. Do not put your API key in Svelte components or browser code.

The built-in runtime settings store is for local development. It is in memory, clears when the server restarts, and should be replaced with authenticated encrypted storage before multi-user production use.

## Vercel deployment

Vercel is a good fit for hosting the SvelteKit app so desktop and iPhone users can open the same URL.

Recommended production shape:

```txt
iPhone/Desktop browser
  -> Vercel SvelteKit app
  -> /api/chat on Vercel
      -> OpenAI API, or a reachable hosted LLM service
  -> /api/analyze on Vercel
      -> reachable KataGo analysis service
```

Do not plan on running KataGo or Ollama as persistent local engine processes inside normal Vercel functions. Vercel functions have request-duration and bundle/runtime limits, while KataGo and Ollama are long-running engine services. Host them separately if you need them in production:

- a small VPS
- a home server exposed through a secure tunnel
- Fly.io, Render, Railway, or similar container hosting
- a private network/VPN endpoint

For a Vercel deployment, put production secrets in Vercel Environment Variables:

```sh
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.5
LLM_PROVIDER=openai
KATAGO_ANALYSIS_URL=https://your-katago-service.example.com/analyze
```

The Settings panel remains useful for local experiments. In production, avoid asking users to paste API keys unless you add user accounts and encrypted persistent storage.

## End-to-end local setup

1. Install dependencies:

```sh
npm install
```

2. Copy environment settings if you want defaults for the local server:

```sh
cp .env.example .env
```

3. Optional: fill in OpenAI settings in `.env`, or skip this and use the app Settings panel:

```sh
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5.5
```

For local Ollama chat, use:

```sh
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:3b
```

4. Install KataGo and download a neural net model from the KataGo release/model links. Then point `.env` at your local files:

```sh
KATAGO_BIN=/absolute/path/to/katago
KATAGO_CONFIG=/absolute/path/to/analysis_example.cfg
KATAGO_MODEL=/absolute/path/to/model.bin.gz
KATAGO_ANALYSIS_URL=http://localhost:8719/analyze
```

5. Terminal A, start the persistent KataGo service:

```sh
npm run katago:service
```

6. Terminal B, start SvelteKit:

```sh
npm run dev
```

7. Open `http://127.0.0.1:5173`, open Settings, confirm the OpenAI model/key and KataGo URL, play moves, click Analyze, then ask the coach a question. The data flow is:

```txt
browser position -> /api/analyze -> KataGo bridge -> KataGo JSON
browser question + latest analysis -> /api/chat -> Ollama or OpenAI model
```

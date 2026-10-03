# Configuration

Every setting is optional. With none of them you get the whole app on your network: both game modes, the
number keypad and name search for cards, the 3D board, Easy and Normal bots, and the end-of-game poster.

Settings are environment variables. `.env.example` in the repository lists all of them with comments.

- **Docker:** copy it to `deploy/.env` (next to `docker-compose.yml`) and edit it. Restart with
  `docker compose up -d`.
- **Development:** copy it to `.env` in the repository root for `npm run dev`.

Empty values mean the default.

## Core

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_URL` | the address the TV page was opened with | The address for the phones. The TV's QR code contains it. Set it when the server has different names on the TV and on the phones, or after adding HTTPS. |
| `MARS_LEDGER_PORT` | `8080` | Docker only: the host port for the app. |
| `PORT` | `8080` | The server's listening port. |
| `DATA_DIR` | `./data` (`/data` in the image) | Where games, profiles, posters and narration audio are stored. |
| `SOURCE_URL` | `https://github.com/murtaza-nasir/mars-ledger` | The "Source code" link in the phone's game menu and on the TV lobby. If you run a changed version for other people, you must offer them its source under the AGPL. Point this at your repository. |

## Images (Docker only)

| Variable | Default |
|---|---|
| `MARS_LEDGER_IMAGE` | `ghcr.io/murtaza-nasir/mars-ledger:latest` |
| `MARS_LEDGER_ENGINE_IMAGE` | `ghcr.io/murtaza-nasir/mars-ledger-engine:41a1b005de73` |

With the build override (`docker-compose.build.yml`), both are ignored and the images are built locally.

## Engine (full-game mode)

| Variable | Default | Description |
|---|---|---|
| `ENGINE_URL` | `http://localhost:8791` | The engine's address. In the compose file it is `http://engine:8080`. |
| `FULL_GAME` | `true` | Set `false` to hide the full-game choice in the lobby. Companion mode needs no engine. |
| `ENGINE_POLL_MS` | `1200` | How often the engine is asked for changes, in milliseconds. |

You can check the engine at `GET /api/health` (see [Troubleshooting](troubleshooting.md#health-check)).

## Photo scanning

See [Optional AI features](optional-ai.md#photo-scanning). Without a provider, the photo button is hidden and the
number keypad and name search remain available.

| Variable | Default | Description |
|---|---|---|
| `VISION_ENABLED` | `true` | Set `false` to turn scanning off even with a provider. |
| `VISION_PROVIDERS` | `local,openrouter` | The order providers are tried in. |
| `LOCAL_VLM_URL` | none | An OpenAI-compatible server with a vision model, ending in `/v1`. |
| `LOCAL_VLM_MODEL` | none | The model name on that server. Needed with `LOCAL_VLM_URL`. |
| `LOCAL_VLM_API_KEY` | none | Sent as a bearer token, if one is required. |
| `OPENROUTER_API_KEY` | none | An OpenRouter key (paid per request). |
| `OPENROUTER_VLM_MODEL` | `google/gemini-2.5-flash-lite` | The OpenRouter model. |

## Mission control

See [Optional AI features](optional-ai.md#mission-control). Without an LLM, mission control is hidden.
Without a speech provider, the table can choose only **Off** or **Text**.

| Variable | Default | Description |
|---|---|---|
| `NARRATOR_ENABLED` | `true` | Set `false` to hide mission control everywhere. |
| `NARRATOR_LLM_URL` | `LOCAL_VLM_URL` | An OpenAI-compatible chat endpoint, ending in `/v1`. |
| `NARRATOR_LLM_MODEL` | `LOCAL_VLM_MODEL` | The chat model. |
| `NARRATOR_LLM_API_KEY` | none | Bearer token for the LLM. |
| `NARRATOR_LLM_TIMEOUT_MS` | `6000` | How long a line may take. |
| `NARRATOR_TTS_URL` | none | An OpenAI-compatible speech server (`/v1/audio/speech`), ending in `/v1`. |
| `NARRATOR_TTS_API_KEY` | none | Bearer token for the speech server. |
| `NARRATOR_TTS_MODEL` | `tts-1` | The speech model. |
| `NARRATOR_VOICE` | `onyx` | The voice. |
| `NARRATOR_TTS_TIMEOUT_MS` | `8000` | How long speech may take. |
| `NARRATOR_TTS_PROVIDER` | none | Paid voices to try first, in order (`gemini` is recommended): `gemini`, `hume`, or both (`gemini,hume`). The speech server above (if set) is the fallback for failed lines. Without it, only the speech server is used. |
| `OPENROUTER_API_KEY` | none | The OpenRouter key, for the `gemini` voice (the same key as for photo scanning). |
| `NARRATOR_GEMINI_VOICE` | `Charon` | One of Gemini's named voices (Charon, Algenib, Sadaltager, Rasalgethi, Algieba, Puck, Kore and others). |
| `NARRATOR_GEMINI_MODEL` | `google/gemini-3.8-flash-tts` | The OpenRouter speech model. |
| `NARRATOR_GEMINI_STYLE` | a dry British mission controller | The narrator's standing character, sent as Gemini's style direction before each line's acting note. |
| `NARRATOR_GEMINI_TAGS` | `true` | `false` means no inline tags for pauses, sighs and laughs. |
| `NARRATOR_GEMINI_TIMEOUT_MS` | `8000` | How long Gemini may take. |
| `NARRATOR_GEMINI_USD_PER_MIN` | `0.0174` | Gemini's price per minute of speech, for the budget. |
| `HUME_API_KEY` | none | A Hume key, for the `hume` voice. Hume ends its TTS API on 13 November 2026. |
| `NARRATOR_HUME_VOICE_ID` | none | A voice from your Hume voice library. |
| `NARRATOR_HUME_VERSION` | `2` | Octave version. With `1`, each line's acting note is also spoken. |
| `NARRATOR_HUME_TIMEOUT_MS` | `6000` | How long Hume may take. |
| `NARRATOR_HUME_USD_PER_1K` | `0.0076` | Hume's price per 1,000 characters, for the budget. |
| `NARRATOR_TTS_BUDGET_USD` | `0.50` | Spend limit on paid voices per game, in US dollars. |
| `NARRATOR_LOG` | none | A log file with one JSON line per narrated moment. |

## Radio

| Variable | Default | Description |
|---|---|---|
| `RADIO_PLAYLIST` | none | A YouTube playlist id (the part after `list=` in the playlist's address). Without it there is no radio on the TV or the phones. |

## Poster illustration

The end-of-game poster always has the built-in paintings. With an image server, the table can also ask
for one new painting per game.

| Variable | Default | Description |
|---|---|---|
| `POSTER_FORGE_URL` | none | A Stable Diffusion WebUI Forge (or AUTOMATIC1111) API. Without it the switch is hidden. |
| `POSTER_FORGE_TIMEOUT_MS` | `60000` | How long the painting may take. |
| `POSTER_UNIQUE_ENABLED` | `true` | Set `false` to hide the switch even with a server. |

## Bots

| Variable | Default | Description |
|---|---|---|
| `TYPESAFE_API_KEY` | none | A TypeSafe key. Without it, Hard (Jev) is not offered in the lobby. |
| `BOT_JEV_BUDGET_USD` | `0.10` | Spend limit on Jev per game. After that, Jev seats are Normal. |
| `BOT_DELAY_SCALE` | `1` | A factor for the bots' pauses. At `0`, there is no pause. |
| `BOT_LOG` | none | A log file with every bot decision as a JSON line. |

## Tuning

| Variable | Default | Description |
|---|---|---|
| `AWAY_MIN_MS` | `60000` | How long a player must be away before their phone shows a "While you were away" summary. |
| `SYNC_HEARTBEAT_MS` | `2000` | How often each screen's version is checked. |
| `ENGINE_GAME_OPTIONS` | none | Extra engine game options as JSON, for testing. |
| `CLIENT_DIST` | `dist` (`/app/dist` in the image) | The built web client. |
| `POSTER_ASSETS` | found by itself | The poster fonts and paintings. |
| `RESVG_WASM` | found by itself | The poster renderer's WebAssembly file. |

## Experimental

With `BOT_JUDGE`, `BOT_JUDGE_SPEC`, `BOT_JUDGE_BOTS`, `BOT_JUDGE_URL`, `BOT_JUDGE_MODEL`, `BOT_JUDGE_TIMEOUT_MS`,
`BOT_JUDGE_CONTEXT`, `BOT_JUDGE_CANDIDATES` and `BOT_JUDGE_SKIP`, a decision model chooses among a Normal bot's
options for research. They are off by default. See [Bots](bots.md#experimental-judge).

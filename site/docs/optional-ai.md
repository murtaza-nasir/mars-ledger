# Optional AI features

Mars Ledger is fully usable without any AI service. Each feature below appears only when you configure it.

## Photo scanning

In companion mode, you can photograph a card, a corporation or a prelude instead of typing its number. The
title and number are read by a vision model, and the card is matched against the card list on the server.

Configure one or both providers in `deploy/.env`:

```sh
# any OpenAI-compatible server with a vision model (vLLM, llama.cpp server, Ollama, LM Studio)
LOCAL_VLM_URL=http://<your-llm-server>:8000/v1
LOCAL_VLM_MODEL=<model name>

# or OpenRouter, paid per request
OPENROUTER_API_KEY=<key>
```

With the photo button you take the picture in the phone's camera app. This is allowed over plain HTTP on most phones. If only
the photo library is offered, use [HTTPS](installation.md#https). Without a provider, the **Photo** choice is hidden and
**Number** and **Name** remain available.

## Mission control

Mission control consists of short lines about notable moments (attacks, big plays, milestones and awards, lead
changes, the end), shown on the TV and optionally spoken there. The table chooses **Off**, **Text** or **Text + voice** in the lobby or the
game menu. The default is Off.

You need an OpenAI-compatible chat model:

```sh
NARRATOR_LLM_URL=http://<your-llm-server>:8000/v1
NARRATOR_LLM_MODEL=<model name>
```

Without them, `LOCAL_VLM_URL` and `LOCAL_VLM_MODEL` are used. Without any LLM, mission control is hidden.

Each line is checked before it is shown: it may contain only the players and cards in the moment and the
numbers in the facts. A rejected line is retried once, then dropped.

For **Text + voice**, add a speech provider. Gemini through OpenRouter is the recommended voice:

```sh
NARRATOR_TTS_PROVIDER=gemini
OPENROUTER_API_KEY=<key>
```

- **Gemini 3.8 Flash TTS through OpenRouter** (paid, about $0.002 a line). Pick a voice with
  `NARRATOR_GEMINI_VOICE` (default `Charon`; Algenib, Puck and Kore are other choices). Each line's acting note
  ("withering sarcasm", "hushed awe") is sent to Gemini as its style direction, and pauses, sighs and laughs are
  added as inline tags. The caption on the TV shows neither.
- **An OpenAI-compatible speech server** (OpenAI, openedai-speech, Kokoro-FastAPI and others): `NARRATOR_TTS_URL`,
  and optionally `NARRATOR_TTS_API_KEY`, `NARRATOR_TTS_MODEL` (default `tts-1`) and `NARRATOR_VOICE` (default
  `onyx`). It can be used on its own or as the backup for a paid voice.
- **Hume Octave**: `NARRATOR_TTS_PROVIDER=hume`, `HUME_API_KEY` and `NARRATOR_HUME_VOICE_ID`. Hume ends its TTS API
  on 13 November 2026.

In `NARRATOR_TTS_PROVIDER`, list the paid voices in the order to try them, for example `gemini,hume`. A paid
voice is not turned on by its key alone.

Spend on the paid voices is capped per game by `NARRATOR_TTS_BUDGET_USD`. With a paid voice and a speech server
both set, the speech server is used after any paid-voice failure and for the rest of the game once the budget is
spent. When a paid voice's account is out of credits, that voice is left alone for 10 minutes.

### Checking on mission control

- In **TV options**, the status line under **Mission control voice** shows the time of the last line, whether
  a tap on this TV is needed to start the voice, or which voice is out of credits and which is used instead.
- The answer to `GET /api/health` has a `narrator` section. See
  [Troubleshooting](troubleshooting.md#health-check).

The voice is played only on the TV, after the TV's sound is turned on.

## Radio

Radio is optional too. Set `RADIO_PLAYLIST` to a YouTube playlist id to play it on the TV during
a game. Turn it on in **TV options** or from a phone's game menu. The player is YouTube's embedded player.

## Poster illustration

The end-of-game poster always has the built-in paintings. With `POSTER_FORGE_URL` set to a Stable
Diffusion WebUI Forge (or AUTOMATIC1111) API, the table can turn on a one-off painting for the game. It is
skipped when that server is busy or slow, and the server's loaded checkpoint is never changed.

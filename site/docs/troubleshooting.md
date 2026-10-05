# Troubleshooting

## A flat board on the TV instead of the 3D one

The 3D board needs WebGL2. When the board is not smooth on a screen, it first steps its quality down (resolution,
effects, board life, simpler tiles); only when even the lightest 3D level stays slow, or a graphics driver error
occurs, is the screen switched to the flat board, which is remembered on this screen.

- Open **TV options** (the gear, bottom left). The **3D:** line shows the current quality level and when it last
  changed, with the measured frame times and screen size. **Reset to full** starts again at full quality.
- Under **3D board** you see when it was switched off and why: the measured frame times and the screen size, or
  the graphics error. Turn **3D board** back on to try again. If a TV keeps being switched back, leave it off. The
  flat board shows the same game.
- Each TV also tells the server when it changes level: the server log has lines such as
  `3D: TV k3x9ab stepped down to reduced resolution (85%): p95 34 ms ... at 1536x729@2.5`, and `/api/health`
  shows the latest per TV under `tv3d`.
- Screens are judged only while the page has focus, so a hidden or covered window does not count as slow.
- Under **Tile style**, you can choose Classic or Detailed tiles. Try Classic on a screen that struggles.

## Text or the board looks huge or blurry on the TV

On many TV browsers, the page is laid out at a low resolution, for example 960 x 540, and scaled up. In TV options
you see the browser's reported values: page pixels, density and device pixels.

- Set the TV browser's own zoom to 100%.
- Set **Text size** in TV options to Normal, Large or Extra large to taste.
- Zooming inside the TV page (pinch or Ctrl and the mouse wheel) is blocked, so the board is not
  left zoomed into one corner by a stray gesture. Use the browser's zoom menu.
- With a laptop or a streaming stick with a desktop browser on the TV's HDMI input, you usually get a sharper
  picture and a faster 3D board than with a built-in TV browser.

## The radio window is large

YouTube's embedded player must be at least 200 x 200 page pixels, so its size is fixed. On a TV browser with a low
page resolution, 200 page pixels cover a large part of the screen. Turn the radio off in TV
options if it is in the way, or use a browser with a higher page resolution.

If there is no radio at all, `RADIO_PLAYLIST` is not set.

## iPhone tips

- Open the QR code's address in Safari, then **Share**, **Add to Home Screen**. You then get the app full screen,
  without Safari's bars.
- With Auto-Lock, the screen goes dark between turns. Raise it in **Settings**, **Display & Brightness**, **Auto-Lock**
  for game night, or tap the screen now and then. When you wake the phone, it is reconnected and you
  see what happened while you were away.
- In Low Power Mode, the frame rate is lower. Turn it off if animations feel sluggish.
- Saving the poster with the share sheet needs [HTTPS](installation.md#https). Over HTTP the poster is
  downloaded.
- Vibration feedback is not available on iPhones.

## Full game is missing or fails to start

- **Full game** is offered in the lobby unless `FULL_GAME=false` is set.
- If starting a full game fails, the engine is not reachable. To confirm, open `/api/health`: it shows `engine: 'down'`.
  Check that the `engine` container is running:
  `docker compose ps` in the `deploy` folder. Check the app's log with `docker compose logs app`.
- Outside Docker, `ENGINE_URL` must be a running engine's address (default `http://localhost:8791`).

## Health check

With `GET /api/health` you can check the app and the engine. Point an outside monitor (Uptime Kuma or similar) at it.

| Answer | Meaning |
|---|---|
| 200 `{ok: true, engine: 'ok', build}` | The app is up, and the engine was reached within 2 seconds. |
| 503 `{ok: false, engine: 'down', error, build}` | The app is up, but the engine could not be reached. Full games cannot be started. |
| 200 `{ok: true, engine: 'off', build}` | Companion-only setup (`FULL_GAME=false` or no `ENGINE_URL`). |

The engine's answer is cached for 10 seconds. `GET /api/health?app=1` is an app-only check. The image's Docker health
check is based on it, so the app container stays healthy during an engine outage.

The answer also has a `tv3d` section: each TV's latest 3D board quality report since the server started, by the
TV's short id (shown at the top of its TV options), for example
`{"k3x9ab": {"level": 1, "levelId": "res85", "label": "reduced resolution (85%)", "dir": "down", "p95": 34, "median": 28,
"slow": 0.31, "size": "1536x729@2.5", "render": "3072x1458", "at": "2026-10-04T21:12:32.320Z"}}`. `dir` is `down`, `up`,
`flat` (fell back to the flat board), `start` (loaded at a remembered level) or `reset`; `p95` and `median` are frame
times in ms, `slow` the share of frames over 25 ms, `size` the page and `render` the 3D canvas in pixels. It is empty
while every TV runs at full quality. The status code does not depend on it.

When mission control is configured, the answer also has a `narrator` section. The status code does not depend on it.

| Field | Meaning |
|---|---|
| `mode` | The table's choice: `off`, `text` or `voice`. |
| `llm.reachable`, `llm.model`, `llm.lastError` | Whether the language model is reachable with the configured model, and its last error. |
| `speech.order`, `speech.provider` | The voices in the order they are tried, and the first one. |
| `speech.providers.<name>.ok` | Whether that paid voice is reachable and its last request succeeded. |
| `speech.outOfCredits` | The voice whose account is out of credits, how long it is left alone, and the replacement voice. |
| `speech.lastError`, `speech.lastProvider` | The last speech error, and the voice used last. |
| `linesSent`, `lastLineAgoS`, `lastError` | Number of lines sent to the TVs, time since the last one, and the last failure. |
| `tv.shown`, `tv.spoken`, `tv.notShown`, `tv.lastDropReason` | Lines shown, spoken, or dropped on the TVs, and why. |

## Mission control is quiet

- Open **TV options** on the TV and read the status line under **Mission control voice**.
- "voice waits for a tap or key on this TV": sound is played only after a tap or a key press. Tap the screen
  or press a key on the remote once.
- "can’t reach the language model": check `NARRATOR_LLM_URL` and `NARRATOR_LLM_MODEL`. `GET /api/health` lists the
  error under `narrator.llm`.
- "out of credits": top up that account. Until then, the next voice in the order is used, or the speech server, or
  text only.

## "The card and board data have not been fetched yet"

You are running from source without the card data. Run `npm run fetch-data` once. See
[Development](development.md#card-data).

## Phones cannot connect

- The server's address must be reachable from the phones on your network. If the QR code shows an address
  that cannot be opened on the phones, set `PUBLIC_URL`.
- Behind a reverse proxy, WebSockets (the `/ws` path) must be passed through.
- Open the port (8080 by default) in any firewall on the server.

## A feature is missing

Optional features appear only when they are configured:

| Missing | Set |
|---|---|
| Photo button | `LOCAL_VLM_URL` and `LOCAL_VLM_MODEL`, or `OPENROUTER_API_KEY` |
| Mission control | `NARRATOR_LLM_URL` and `NARRATOR_LLM_MODEL` (or the `LOCAL_VLM_*` pair) |
| Text + voice | `NARRATOR_TTS_URL`, or `NARRATOR_TTS_PROVIDER` with that voice's key |
| Radio | `RADIO_PLAYLIST` |
| Hard (Jev) bots | `TYPESAFE_API_KEY` |
| Poster illustration switch | `POSTER_FORGE_URL` |

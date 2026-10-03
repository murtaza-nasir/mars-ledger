# Installation

Mars Ledger consists of two containers:

- **app**: the web client and server. You open it on port 8080 from the phones and the TV.
- **engine**: the open-source Terraforming Mars server, unmodified, used for full games. It has no published port.
  It is reachable only from the app, on an internal network without internet access.

Both are defined in `deploy/docker-compose.yml`.

## Requirements

- Docker with the Compose plugin, on Linux, macOS or Windows. A small server, a NAS with container support, or a
  spare computer is enough.
- About 1 GB of disk for the images. Game data is small.
- A TV browser with WebGL2 for the 3D board. Any GPU from the last few years is enough. Slower screens are switched to
  the flat board automatically.

## With published images

```sh
git clone https://github.com/murtaza-nasir/mars-ledger.git
cd mars-ledger/deploy
cp ../.env.example .env   # optional
docker compose up -d
```

The images are `ghcr.io/murtaza-nasir/mars-ledger:latest` and `ghcr.io/murtaza-nasir/mars-ledger-engine:41a1b005de73`. To run
other tags, set `MARS_LEDGER_IMAGE` and `MARS_LEDGER_ENGINE_IMAGE` in `deploy/.env`.

## Building locally

```sh
cd mars-ledger/deploy
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

- The app image is built from the repository's `Dockerfile`. During the build, the card and board data are
  fetched from the engine's GitHub repository (see [Development](development.md#card-data)).
- The engine image is built from `github.com/terraforming-mars/terraforming-mars` at the commit in
  `ENGINE_COMMIT`, with the engine's own Dockerfile. This takes several minutes the first time.
- Both builds need access to github.com.

You can also build the engine image on its own, from the repository root:

```sh
deploy/engine-image.sh            # builds mars-ledger-engine:<first 12 characters of ENGINE_COMMIT>
```

## Data and volumes

| Volume | Holds |
|---|---|
| `app-data` (mounted at `/data`) | games, profiles, achievements, posters and narration audio (SQLite and files) |
| `engine-db` | the engine's saved full games |

To back up, stop the stack and copy both volumes. They are kept by `docker compose down` and
deleted by `docker compose down -v`.

## Monitoring

Point a monitor at `GET /api/health`. You get 200 when the app and the engine are up, and 503 when the engine is down. See
[Troubleshooting](troubleshooting.md#health-check).

## Updating

```sh
git pull
docker compose pull && docker compose up -d       # published images
# or
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## HTTPS

Everything is available over plain HTTP on your own network, except features allowed only on secure pages:

- **Saving a poster with the share sheet.** Over HTTP the poster is downloaded instead.
- **Photo scanning on some phones.** With the photo button you take the picture in the phone's own camera app,
  through a file picker. This is allowed over HTTP on most phones. If only the photo library is offered, add HTTPS.

To add HTTPS, put a reverse proxy in front of port 8080. WebSockets (the `/ws` path) must be passed through the proxy.

### Caddy

`deploy/Caddyfile.example` holds a working configuration:

```caddy
mars.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

With a public name and ports 80 and 443 open, a certificate is issued to Caddy automatically. For a name that exists only on
your network, use `tls internal` (shown in the file) and install Caddy's root certificate on each phone once.

### Nginx Proxy Manager

Add a proxy host for your name with `http://<your-server>:8080` as its target. Turn on **Websockets Support** and
leave caching off. Request a certificate on the SSL tab.

### Tailscale

If the phones and the server are on one tailnet, you can serve the app with a Tailscale certificate:

```sh
tailscale serve --bg 8080
```

Then open `https://<machine>.<tailnet>.ts.net/tv`. HTTPS certificates must be enabled for the tailnet.

After you add HTTPS, set `PUBLIC_URL` to the HTTPS address so the QR code contains it.

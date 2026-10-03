#!/usr/bin/env bash
# Build the full-game engine image: the open-source Terraforming Mars server (GPL-3.0), unmodified, from
# github.com/terraforming-mars/terraforming-mars at the commit in ENGINE_COMMIT, with upstream's own Dockerfile.
# The tag is the commit's first 12 characters.
#
#   deploy/engine-image.sh                     build mars-ledger-engine:<12 characters> locally
#   deploy/engine-image.sh <40-character sha>  build another commit (then update ENGINE_COMMIT to match)
#   ENGINE_IMAGE=ghcr.io/murtaza-nasir/mars-ledger-engine deploy/engine-image.sh --push
#                                              build under that name and push it (skipped if already there)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
push="" commit=""
for a in "$@"; do
  case "$a" in
    --push) push=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) commit="$a" ;;
  esac
done
COMMIT="${commit:-$(tr -d '[:space:]' < ENGINE_COMMIT)}"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "need the full 40-character engine commit, got '${COMMIT}'" >&2; exit 1; }
REPO="${ENGINE_IMAGE:-mars-ledger-engine}"
tag="${REPO}:${COMMIT:0:12}"
if [[ -n "$push" ]] && docker manifest inspect "$tag" >/dev/null 2>&1; then echo "$tag is already in the registry"; exit 0; fi
echo "building $tag from github.com/terraforming-mars/terraforming-mars@${COMMIT:0:12}"
docker build -q \
  --label "org.opencontainers.image.title=Terraforming Mars engine (for Mars Ledger)" \
  --label "org.opencontainers.image.source=https://github.com/terraforming-mars/terraforming-mars" \
  --label "org.opencontainers.image.revision=${COMMIT}" \
  --label "org.opencontainers.image.licenses=GPL-3.0" \
  -t "$tag" "https://github.com/terraforming-mars/terraforming-mars.git#${COMMIT}" >/dev/null
echo "built $tag"
if [[ -n "$push" ]]; then docker push -q "$tag" >/dev/null; echo "pushed $tag"; fi

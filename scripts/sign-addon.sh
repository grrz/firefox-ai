#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$ROOT_DIR}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-$ROOT_DIR/web-ext-artifacts}"
CHANNEL="${CHANNEL:-unlisted}"
AMO_METADATA_FILE="${AMO_METADATA_FILE:-}"
WEB_EXT_BIN="${WEB_EXT_BIN:-}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/sign-addon.sh [--channel unlisted|listed] [--metadata path/to/amo-metadata.json] [--artifacts-dir path]

Environment variables:
  WEB_EXT_API_KEY / WEB_EXT_API_SECRET
    Preferred AMO API credentials for web-ext.

  AMO_JWT_ISSUER / AMO_JWT_SECRET
    Supported aliases. Used only if WEB_EXT_API_KEY / WEB_EXT_API_SECRET are unset.

  CHANNEL
    Defaults to "unlisted".

  AMO_METADATA_FILE
    Optional path to AMO metadata JSON. Usually needed for first listed submission.

Examples:
  ./scripts/sign-addon.sh
  CHANNEL=listed AMO_METADATA_FILE=./amo-metadata.json ./scripts/sign-addon.sh
EOF
}

while (($# > 0)); do
  case "$1" in
    --channel)
      CHANNEL="${2:-}"
      shift 2
      ;;
    --metadata)
      AMO_METADATA_FILE="${2:-}"
      shift 2
      ;;
    --artifacts-dir)
      ARTIFACTS_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$CHANNEL" != "unlisted" && "$CHANNEL" != "listed" ]]; then
  echo "Unsupported channel: $CHANNEL" >&2
  exit 1
fi

API_KEY="${WEB_EXT_API_KEY:-${AMO_JWT_ISSUER:-}}"
API_SECRET="${WEB_EXT_API_SECRET:-${AMO_JWT_SECRET:-}}"

if [[ -z "$API_KEY" || -z "$API_SECRET" ]]; then
  echo "Missing AMO credentials." >&2
  echo "Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET, or AMO_JWT_ISSUER and AMO_JWT_SECRET." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_DIR/manifest.json" ]]; then
  echo "manifest.json not found in source dir: $SOURCE_DIR" >&2
  exit 1
fi

if [[ -n "$AMO_METADATA_FILE" && ! -f "$AMO_METADATA_FILE" ]]; then
  echo "Metadata file not found: $AMO_METADATA_FILE" >&2
  exit 1
fi

mkdir -p "$ARTIFACTS_DIR"

if [[ -n "$WEB_EXT_BIN" ]]; then
  WEB_EXT_CMD=("$WEB_EXT_BIN")
elif command -v web-ext >/dev/null 2>&1; then
  WEB_EXT_CMD=("web-ext")
elif command -v npx >/dev/null 2>&1; then
  WEB_EXT_CMD=("npx" "--yes" "web-ext@^8")
else
  echo "web-ext is not installed and npx is unavailable." >&2
  exit 1
fi

CMD=(
  "${WEB_EXT_CMD[@]}"
  sign
  --source-dir "$SOURCE_DIR"
  --artifacts-dir "$ARTIFACTS_DIR"
  --channel "$CHANNEL"
  --api-key "$API_KEY"
  --api-secret "$API_SECRET"
  --ignore-files
  "web-ext-artifacts/*"
  "dist/*"
)

if [[ -n "$AMO_METADATA_FILE" ]]; then
  CMD+=(--amo-metadata "$AMO_METADATA_FILE")
fi

echo "Signing Firefox add-on"
echo "  channel:       $CHANNEL"
echo "  source dir:    $SOURCE_DIR"
echo "  artifacts dir: $ARTIFACTS_DIR"
if [[ -n "$AMO_METADATA_FILE" ]]; then
  echo "  metadata:      $AMO_METADATA_FILE"
fi

"${CMD[@]}"

echo
echo "Signed artifact(s) should be in:"
echo "  $ARTIFACTS_DIR"

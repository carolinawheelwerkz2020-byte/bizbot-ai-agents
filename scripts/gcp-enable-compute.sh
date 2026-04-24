#!/usr/bin/env bash
# Enable Compute Engine API on your Firebase/GCP project (fixes some Firebase CLI deploy warnings).
# Prerequisite: gcloud auth — run once:  gcloud auth login
# Default project matches .firebaserc (cww-agents); override with GCP_PROJECT_ID=my-project

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-cww-agents}"

if command -v gcloud >/dev/null 2>&1; then
  GCLOUD="gcloud"
elif [[ -x "${HOME}/google-cloud-sdk/google-cloud-sdk/bin/gcloud" ]]; then
  GCLOUD="${HOME}/google-cloud-sdk/google-cloud-sdk/bin/gcloud"
else
  echo "gcloud not found. Install from https://cloud.google.com/sdk/docs/install or run:" >&2
  echo '  curl https://sdk.cloud.google.com | bash -s -- --disable-prompts' >&2
  exit 1
fi

echo "Using: $GCLOUD"
echo "Project: $PROJECT_ID"
"$GCLOUD" services enable compute.googleapis.com --project="$PROJECT_ID"
echo "compute.googleapis.com is enabled for $PROJECT_ID."

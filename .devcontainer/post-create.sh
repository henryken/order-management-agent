#!/usr/bin/env bash
set -euo pipefail

# node_modules is a named volume (see docker-compose.yml), created root-owned.
sudo chown "$(id -u):$(id -g)" node_modules

# The npm cache lives in .devcache (see docker-compose.yml), so this is fast after the first create.
npm ci

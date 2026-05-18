#!/bin/sh
set -eu

python /app/backend/docker/bootstrap.py

exec "$@"

#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

echo "===> [Step 1] Stopping node-app service if currently running..."

# Gracefully stop the systemd service; ignore error if service is not yet installed or running
systemctl stop node-app.service || true
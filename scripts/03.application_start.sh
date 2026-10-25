#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

echo "===> [Step 3] Reloading systemd daemon and starting node-app service..."
systemctl daemon-reload

# Enable service on boot and start/restart the application process
systemctl enable node-app.service
systemctl restart node-app.service
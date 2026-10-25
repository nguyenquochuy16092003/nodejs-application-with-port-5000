#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

echo "===> [Step 4] Validating application health on port 5000..."

# Wait 5 seconds for the Express server to initialize
sleep 5

# Send request to local health check endpoint
# Flags: -f (fail silently on HTTP errors), -s (silent mode), -S (show error)
curl -fsS http://localhost:5000/health-check || {
    echo "ERROR: Health check failed! Application did not respond with 200 OK."
    exit 1
}

echo "===> Application is healthy and responding successfully on port 5000."
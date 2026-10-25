#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

echo "===> [Step 2] Installing Node.js production dependencies..."
cd /opt/node-app

# Install production dependencies only (skips devDependencies like nodemon)
npm install --omit=dev

echo "===> Setting full directory permissions for nodejs system user..."
# Ensure 'nodejs' user has full ownership to prevent permission errors
chown -R nodejs:nodejs /opt/node-app
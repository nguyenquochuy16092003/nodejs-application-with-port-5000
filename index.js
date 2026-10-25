const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");
const os = require("os");

// =========================================================================
// SECTION 1: WORKER THREAD LOGIC (BACKGROUND CPU INTENSIVE COMPUTATION)
// =========================================================================
if (!isMainThread) {
  const endTime = Date.now() + workerData.duration * 1000;
  // Continuous computation loop to pin the core at 100% load
  while (Date.now() < endTime) {
    Math.sqrt(Math.random() * Math.random());
  }

  parentPort.postMessage("done");

  return;
}

// =========================================================================
// SECTION 2: MAIN THREAD LOGIC (EXPRESS SERVER & MONITORING)
// =========================================================================
const express = require("express");
const app = express();
const PORT = process.env.PORT || 5000;

// Application state variables
let healthCheckCount = 0;
let activeWorkers = 0;
let currentCpuUsage = 0;

// -------------------------------------------------------------------------
// CPU Usage Calculation (Calculates delta over 1-second intervals)
// -------------------------------------------------------------------------
function getCpuUsageSample() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type];
    }

    idle += cpu.times.idle;
  }

  return { idle, total };
}

let startSample = getCpuUsageSample();

// Update CPU percentage every 1000ms
setInterval(() => {
  const endSample = getCpuUsageSample();
  const idleDiff = endSample.idle - startSample.idle;
  const totalDiff = endSample.total - startSample.total;

  currentCpuUsage = totalDiff > 0 ? 100 - (100 * idleDiff) / totalDiff : 0;
  startSample = endSample;
}, 1000);

// -------------------------------------------------------------------------
// Function to retrieve EC2 instance metadata via IMDSv2
// -------------------------------------------------------------------------
async function getEC2Metadata() {
  try {
    // 1. Fetch IMDSv2 session token (timeout 1.5s for local fallback)
    const tokenRes = await fetch("http://169.254.169.254/latest/api/token", {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" },
      signal: AbortSignal.timeout(1500),
    });
    const token = await tokenRes.text();
    // 2. Fetch Identity Document (Region, AZ, Private IP, Instance ID)
    const docRes = await fetch(
      "http://169.254.169.254/latest/dynamic/instance-identity/document",
      {
        headers: { "X-aws-ec2-metadata-token": token },
        signal: AbortSignal.timeout(1500),
      },
    );

    return await docRes.json();
  } catch (err) {
    // Mock fallback values when testing outside an actual EC2 environment
    return {
      region: "ap-southeast-1 (Local Mock)",
      availabilityZone: "ap-southeast-1a (Local Mock)",
      privateIp: "127.0.0.1 (Localhost)",
      instanceId: "i-mock-local-environment",
    };
  }
}

// -------------------------------------------------------------------------
// 1. API: /health-check (Monitored by ALB Target Group)
// -------------------------------------------------------------------------
app.get("/health-check", (req, res) => {
  // Increment health check counter on each probe
  healthCheckCount++;

  res.status(200).json({
    status: "Healthy",
    timestamp: new Date().toISOString(),
    totalChecksReceived: healthCheckCount,
  });
});

// -------------------------------------------------------------------------
// 2. API: /api/status (Real-time telemetry polled by the frontend)
// -------------------------------------------------------------------------
app.get("/api/status", (req, res) => {
  res.status(200).json({
    healthCheckCount,
    activeWorkers,
    cpuUsage: parseFloat(currentCpuUsage.toFixed(1)),
    cpuCores: os.cpus().length,
  });
});

// -------------------------------------------------------------------------
// 3. API: /compute (Spawns worker threads to stress CPU cores)
// -------------------------------------------------------------------------
app.get("/compute", (req, res) => {
  const duration = parseInt(req.query.duration || "60", 10);
  const cpuCores = os.cpus().length;
  // Spawn one worker thread per vCPU core
  for (let i = 0; i < cpuCores; i++) {
    activeWorkers++;

    const worker = new Worker(__filename, {
      workerData: { duration },
    });
    // Decrement counter once the worker finishes or exits
    worker.on("message", () => {
      activeWorkers = Math.max(0, activeWorkers - 1);
    });
    worker.on("error", () => {
      activeWorkers = Math.max(0, activeWorkers - 1);
    });
    worker.on("exit", () => {
      // Safety fallback in case message event was missed
    });
  }

  res.status(200).json({
    message: `Successfully launched stress test across ${cpuCores} vCPU core(s)!`,
    duration: `${duration}s`,
    activeWorkers,
  });
});

// -------------------------------------------------------------------------
// 4. API: / (HTML Dashboard with Real-time Polling & Asynchronous Actions)
// -------------------------------------------------------------------------
app.get("/", async (req, res) => {
  const meta = await getEC2Metadata();
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AWS EC2 Node.js Dashboard - aws-01</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: #0f172a;
        color: #f8fafc;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
      }
      .card {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 30px;
        width: 100%;
        max-width: 520px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      }
      h2 {
        margin-top: 0;
        color: #38bdf8;
        font-size: 24px;
        border-bottom: 1px solid #334155;
        padding-bottom: 15px;
      }
      .info-row {
        display: flex;
        justify-content: space-between;
        padding: 10px 0;
        border-bottom: 1px solid #334155;
      }
      .label {
        color: #94a3b8;
        font-weight: 500;
      }
      .value {
        color: #f1f5f9;
        font-weight: 600;
        font-family: monospace;
      }
      .highlight {
        color: #4ade80;
      }
      .badge {
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 13px;
      }
      .btn-stress {
        display: block;
        width: 100%;
        background: #ef4444;
        color: white;
        text-align: center;
        padding: 12px;
        border: none;
        border-radius: 8px;
        margin-top: 25px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s, transform 0.1s;
      }
      .btn-stress:hover {
        background: #dc2626;
      }
      .btn-stress:active {
        transform: scale(0.99);
      }
      .btn-stress:disabled {
        background: #64748b;
        cursor: not-allowed;
      }
      .status-box {
        margin-top: 15px;
        padding: 10px;
        border-radius: 6px;
        background: #0f172a;
        border: 1px solid #334155;
        font-size: 13px;
        color: #38bdf8;
        display: none;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>🚀 Project: aws-01 Instance</h2>
      
      <div class="info-row">
        <span class="label">Instance ID:</span>
        <span class="value">${meta.instanceId}</span>
      </div>
      <div class="info-row">
        <span class="label">Region:</span>
        <span class="value">${meta.region}</span>
      </div>
      <div class="info-row">
        <span class="label">Availability Zone:</span>
        <span class="value highlight">${meta.availabilityZone}</span>
      </div>
      <div class="info-row">
        <span class="label">Private IPv4:</span>
        <span class="value highlight">${meta.privateIp}</span>
      </div>
      <div class="info-row">
        <span class="label">Target Port:</span>
        <span class="value">5000</span>
      </div>

      <!-- Real-time metrics section -->
      <div class="info-row">
        <span class="label">Health Check Calls:</span>
        <span class="value highlight" id="metric-health-check">${healthCheckCount}</span>
      </div>
      <div class="info-row">
        <span class="label">Active Workers:</span>
        <span class="value" id="metric-workers">0</span>
      </div>
      <div class="info-row">
        <span class="label">Current CPU Load:</span>
        <span class="value highlight" id="metric-cpu">0.0%</span>
      </div>

      <!-- Asynchronous Trigger Button -->
      <button class="btn-stress" id="btn-stress" onclick="triggerStress(60)">
        ⚡ Trigger CPU Stress (60s) for Auto Scaling
      </button>

      <div class="status-box" id="status-box"></div>
    </div>

    <script>
      // Asynchronously invoke /compute without leaving the current page
      async function triggerStress(duration) {
        const btn = document.getElementById('btn-stress');
        const statusBox = document.getElementById('status-box');

        btn.disabled = true;
        btn.textContent = '⏳ Spawning worker threads...';
        statusBox.style.display = 'block';
        statusBox.textContent = 'Initiating stress workload...';

        try {
          const response = await fetch('/compute?duration=' + duration);
          const data = await response.json();
          statusBox.textContent = '🔥 ' + data.message + ' (Duration: ' + data.duration + ')';
        } catch (err) {
          statusBox.textContent = '❌ Failed to trigger stress: ' + err.message;
        } finally {
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = '⚡ Trigger CPU Stress (60s) for Auto Scaling';
          }, 3000);
        }
      }

      // Poll real-time status every 1 second
      async function pollStatus() {
        try {
          const res = await fetch('/api/status');
          const data = await res.json();
          
          document.getElementById('metric-health-check').textContent = data.healthCheckCount;
          document.getElementById('metric-workers').textContent = data.activeWorkers;
          
          const cpuElem = document.getElementById('metric-cpu');
          cpuElem.textContent = data.cpuUsage.toFixed(1) + '%';
          
          // Highlight in red if CPU utilization crosses Auto Scaling threshold (>= 75%)
          if (data.cpuUsage >= 75) {
            cpuElem.style.color = '#ef4444';
          } else {
            cpuElem.style.color = '#4ade80';
          }
        } catch (e) {
          console.error('Error polling status:', e);
        }
      }

      // Start periodic status polling
      setInterval(pollStatus, 1000);
      pollStatus();
    </script>
  </body>
  </html>
  `;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// Start listening on all network interfaces
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running at http://0.0.0.0:${PORT}`);
});

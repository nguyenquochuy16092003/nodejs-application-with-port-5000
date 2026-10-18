const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// =========================================================================
// PHẦN 1: LOGIC CỦA WORKER THREAD (CHẠY NGẦM ĐỂ ÉP CPU LÊN 100%)
// =========================================================================
if (!isMainThread) {
    const endTime = Date.now() + workerData.duration * 1000;
    // Vòng lặp tính toán liên tục ép CPU chạy tối đa công suất
    while (Date.now() < endTime) {
        Math.sqrt(Math.random() * Math.random());
    }
    parentPort.postMessage('done');
    return;
}

// =========================================================================
// PHẦN 2: LOGIC CỦA MAIN THREAD (EXPRESS SERVER)
// =========================================================================
const express = require('express');
const app = express();
const PORT = process.env.PORT || 5000;

// Hàm lấy thông tin EC2 qua IMDSv2
async function getEC2Metadata() {
    try {
        // 1. Lấy IMDSv2 Token (timeout 1.5s phòng khi không chạy trên EC2)
        const tokenRes = await fetch('http://169.254.169.254/latest/api/token', {
            method: 'PUT',
            headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' },
            signal: AbortSignal.timeout(1500)
        });
        const token = await tokenRes.text();
        // 2. Lấy Identity Document chứa Region, AZ, Private IP, Instance ID
        const docRes = await fetch('http://169.254.169.254/latest/dynamic/instance-identity/document', {
            headers: { 'X-aws-ec2-metadata-token': token },
            signal: AbortSignal.timeout(1500)
        });
        return await docRes.json();
    } catch (err) {
        // Giá trị mẫu khi test local (không nằm trong EC2)
        return {
            region: 'ap-southeast-1 (Local Mock)',
            availabilityZone: 'ap-southeast-1a (Local Mock)',
            privateIp: '127.0.0.1 (Localhost)',
            instanceId: 'i-mock-local-environment'
        };
    }
}

// -------------------------------------------------------------------------
// 1. API: /health-check (Khớp cấu hình Target Group)
// -------------------------------------------------------------------------
app.get('/health-check', (req, res) => {
    res.status(200).json({
        status: 'Healthy',
        timestamp: new Date().toISOString()
    });
});

// -------------------------------------------------------------------------
// 2. API: / (Giao diện HTML hiển thị Region, AZ, Private IP)
// -------------------------------------------------------------------------
app.get('/', async (req, res) => {
    const meta = await getEC2Metadata();

    const html = `
  <!DOCTYPE html>
  <html lang="vi">
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
        padding: 12px 0;
        border-bottom: 1px solid #1e293b;
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
      .btn-stress {
        display: block;
        width: 100%;
        background: #ef4444;
        color: white;
        text-align: center;
        padding: 12px;
        border-radius: 8px;
        margin-top: 25px;
        text-decoration: none;
        font-weight: 600;
        transition: background 0.2s;
      }
      .btn-stress:hover {
        background: #dc2626;
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

      <a class="btn-stress" href="/compute?duration=60" target="_blank">
        ⚡ Kích hoạt CPU Stress (60s) để Test Auto Scaling
      </a>
    </div>
  </body>
  </html>
  `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

// -------------------------------------------------------------------------
// 3. API: /compute (Đốt CPU để kích hoạt Auto Scaling)
// -------------------------------------------------------------------------
app.get('/compute', (req, res) => {
    // duration: số giây muốn ép CPU chạy (mặc định 45 giây)
    const duration = parseInt(req.query.duration || '45', 10);
    const cpuCores = os.cpus().length; // Lấy toàn bộ số vCPU của EC2 instance
    // Khởi chạy worker thread trên tất cả các vCPU để CPU vọt lên ~100%
    for (let i = 0; i < cpuCores; i++) {
        new Worker(__filename, {
            workerData: { duration }
        });
    }

    res.status(200).json({
        message: `Đã kích hoạt ép CPU lên 100% trên ${cpuCores} vCPU!`,
        duration: `${duration} giây`,
        note: "Luồng phụ đang ép CPU, luồng chính vẫn phản hồi /health-check bình thường để tránh bị Target Group coi là Unhealthy."
    });
});

// Khởi động server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
});
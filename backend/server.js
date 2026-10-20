require('dotenv').config();
const express = require('express');
const tencentcloud = require('tencentcloud-sdk-nodejs-ocr');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 3000);
app.use(express.json({ limit: '12mb' }));

const OcrClient = tencentcloud.ocr.v20181119.Client;
const ocrClient = new OcrClient({
  credential: {
    secretId: process.env.TENCENTCLOUD_SECRET_ID,
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY
  },
  region: process.env.TENCENTCLOUD_REGION || 'ap-guangzhou',
  profile: { httpProfile: { endpoint: 'ocr.tencentcloudapi.com', reqTimeout: 30000 } }
});

const recentRequests = new Map();
const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
let requestCount = 0;

function preprocessWithOpenCv(imageBase64) {
  return new Promise((resolve, reject) => {
    const worker = spawn(pythonBin, [path.join(__dirname, 'preprocess_image.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    worker.stdout.on('data', chunk => stdout.push(chunk));
    worker.stderr.on('data', chunk => stderr.push(chunk));
    worker.on('error', reject);
    worker.on('close', code => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8') || `OpenCV worker exited with code ${code}`));
        return;
      }
      const processed = Buffer.concat(stdout).toString('utf8').trim();
      if (!processed || !/^[A-Za-z0-9+/]+={0,2}$/.test(processed)) {
        reject(new Error('OpenCV returned invalid image data'));
        return;
      }
      resolve(processed);
    });
    worker.stdin.on('error', reject);
    worker.stdin.end(imageBase64, 'utf8');
  });
}

function allowRequest(ip) {
  const now = Date.now();
  // Prune old keys periodically so the in-memory limiter does not grow forever.
  requestCount += 1;
  if (requestCount % 100 === 0) {
    for (const [key, times] of recentRequests) {
      const active = times.filter(time => now - time < 60000);
      if (active.length) recentRequests.set(key, active);
      else recentRequests.delete(key);
    }
  }
  const recent = (recentRequests.get(ip) || []).filter(time => now - time < 60000);
  if (recent.length >= 20) return false;
  recent.push(now);
  recentRequests.set(ip, recent);
  return true;
}

app.get('/health', (_req, res) => res.json({ ok: true, provider: 'tencent-ocr' }));

app.post('/api/ocr', async (req, res) => {
  if (!process.env.TENCENTCLOUD_SECRET_ID || !process.env.TENCENTCLOUD_SECRET_KEY) {
    return res.status(503).json({ error: '服务端尚未配置腾讯云 OCR 密钥。' });
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowRequest(ip)) return res.status(429).json({ error: '请求过于频繁，请稍后重试。' });

  let image = req.body && req.body.image;
  if (typeof image === 'string') image = image.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  const validBase64 = typeof image === 'string'
    && image.length > 0
    && image.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image);
  if (!validBase64) {
    return res.status(400).json({ error: '图片数据格式无效，请重新拍摄。' });
  }
  if (image.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: '图片过大，请重新拍摄。' });
  }

  try {
    const processedImage = await preprocessWithOpenCv(image);
    const sdkResult = await ocrClient.GeneralAccurateOCR({
      ImageBase64: processedImage,
      ConfigID: 'OCR',
      EnableDetectText: true
    });
    let result = sdkResult.Response || sdkResult;
    let detections = result.TextDetections || [];

    // A thresholded crop is useful for LCD digits, but some screens OCR better
    // from the original photo. Retry that photo when preprocessing found no text.
    if (detections.length === 0) {
      const fallback = await ocrClient.GeneralAccurateOCR({
        ImageBase64: image,
        ConfigID: 'OCR',
        EnableDetectText: true
      });
      result = fallback.Response || fallback;
      detections = result.TextDetections || [];
    }

    const text = detections
      .map(item => item.DetectedText || '')
      .filter(Boolean)
      .join('\n');
    return res.json({ text, requestId: result.RequestId || '' });
  } catch (error) {
    console.error('Image preprocessing or Tencent OCR failed:', error && (error.message || error));
    return res.status(502).json({
      error: '图片预处理或腾讯云 OCR 识别失败，请检查服务端 OpenCV 环境、OCR 密钥和图片质量。'
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log('Tencent OCR backend listening on port ' + port);
});

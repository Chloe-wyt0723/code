require('dotenv').config();
const express = require('express');
const tencentcloud = require('tencentcloud-sdk-nodejs-ocr');

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
function allowRequest(ip) {
  const now = Date.now();
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
  if (typeof image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    return res.status(400).json({ error: '图片数据格式无效，请重新拍摄。' });
  }
  if (image.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: '图片过大，请重新拍摄。' });
  }

  try {
    const sdkResult = await ocrClient.GeneralAccurateOCR({
      ImageBase64: image,
      ConfigID: 'OCR',
      EnableDetectText: true
    });
    const result = sdkResult.Response || sdkResult;
    const text = (result.TextDetections || [])
      .map(item => item.DetectedText || '')
      .filter(Boolean)
      .join('\n');
    return res.json({ text, requestId: result.RequestId || '' });
  } catch (error) {
    console.error('Tencent OCR request failed:', error && (error.message || error));
    return res.status(502).json({
      error: '腾讯云 OCR 识别失败，请检查服务端密钥、OCR 服务开通状态和图片质量。'
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log('Tencent OCR backend listening on port ' + port);
});
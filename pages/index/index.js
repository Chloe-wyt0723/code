const { API_BASE_URL } = require('../../config');
const STORAGE_KEY = 'yipengtong-blood-pressure-v1';

function formatDate(value) {
  const d = new Date(value);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function extractReadings(text) {
  const normalized = String(text || '').toUpperCase();
  const find = labels => {
    const re = new RegExp(`(?:${labels.join('|')})\\s*[:：]?\\s*[^0-9]{0,30}([0-9]{2,3})`);
    const match = normalized.match(re);
    return match ? Number(match[1]) : null;
  };
  const result = {
    systolic: find(['SYS', 'SBP']),
    diastolic: find(['DIA', 'DBP']),
    pulse: find(['PUL', 'PULSE', 'PR'])
  };
  const numbers = (normalized.match(/\b\d{2,3}\b/g) || []).map(Number);
  if (!result.systolic && !result.diastolic && !result.pulse && numbers.length === 3) {
    [result.systolic, result.diastolic, result.pulse] = numbers;
  }
  if (result.systolic < 50 || result.systolic > 280) result.systolic = '';
  if (result.diastolic < 30 || result.diastolic > 180) result.diastolic = '';
  if (result.pulse < 30 || result.pulse > 220) result.pulse = '';
  return result;
}

Page({
  data: {
    nfcLaunch: false,
    showConfirm: false,
    photoPath: '',
    hint: '请先拍摄血压计屏幕。',
    systolic: '',
    diastolic: '',
    pulse: '',
    latest: null,
    lastDate: '',
    history: []
  },

  onLoad(options) {
    const isNfc = options.source === 'nfc' || Boolean(options.scene);
    this.setData({ nfcLaunch: isNfc });
    this.loadRecords();
  },

  onShow() { this.loadRecords(); },

  loadRecords() {
    const records = wx.getStorageSync(STORAGE_KEY) || [];
    const decorate = item => ({ ...item, displayDate: formatDate(item.date) });
    const data = records.map(decorate);
    this.setData({
      latest: data[0] || null,
      lastDate: data[0] ? data[0].displayDate : '',
      history: data.slice(1)
    });
  },

  takePhoto() {
    const onSuccess = result => {
      const file = result && result.tempFiles && result.tempFiles[0];
      const path = file && (file.tempFilePath || file.path);
      if (!path) {
        wx.showModal({ title: '\u6ca1\u6709\u62cd\u5230\u7167\u7247', content: '\u8bf7\u91cd\u8bd5\u6216\u624b\u52a8\u8f93\u5165\u3002', showCancel: false });
        return;
      }
      this.onPhoto(path);
    };
    const onFail = error => {
      const message = (error && (error.errMsg || error.message)) || '';
      if (/cancel/i.test(message)) return;
      wx.showModal({ title: '\u65e0\u6cd5\u6253\u5f00\u76f8\u673a', content: message || '\u8bf7\u5728\u771f\u673a\u4e2d\u6388\u4e88\u76f8\u673a\u6743\u9650\u540e\u91cd\u8bd5\uff0c\u6216\u624b\u52a8\u8f93\u5165\u3002', showCancel: false });
    };
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera'], camera: 'back', success: onSuccess, fail: onFail });
    } else if (typeof wx.chooseImage === 'function') {
      wx.chooseImage({ count: 1, sourceType: ['camera'], success: result => onSuccess({ tempFiles: result.tempFiles || (result.tempFilePaths || []).map(path => ({ path })) }), fail: onFail });
    } else {
      wx.showModal({ title: '\u4e0d\u652f\u6301\u62cd\u7167', content: '\u8bf7\u5347\u7ea7\u5fae\u4fe1\u540e\u91cd\u8bd5\u3002', showCancel: false });
    }
  },

  onPhoto(filePath) {
    this.setData({ photoPath: filePath, showConfirm: true, hint: '\u6b63\u5728\u8bc6\u522b\u7167\u7247\uff0c\u8bf7\u7a0d\u5019\u2026', systolic: '', diastolic: '', pulse: '' });
    this.recognizePhoto(filePath);
  },

  openManualEntry() {
    this.setData({ photoPath: '', showConfirm: true, hint: '\u8bf7\u6839\u636e\u8840\u538b\u8ba1\u5c4f\u5e55\u624b\u52a8\u586b\u5199\u3002', systolic: '', diastolic: '', pulse: '' });
  },

  noop() {},
  onBackPress() {
    if (this.data.showConfirm) { this.closeConfirm(); return true; }
    return false;
  },
  recognizePhoto(filePath) {
    if (!API_BASE_URL || API_BASE_URL.indexOf('YOUR_HTTPS_DOMAIN') >= 0) {
      this.setData({ hint: '请先在 config.js 中填写已部署的 HTTPS 服务地址，再连接腾讯云 OCR。' });
      return;
    }
    wx.showLoading({ title: '正在识别…', mask: true });
    wx.compressImage({
      src: filePath,
      quality: 70,
      success: compressed => {
        wx.getFileSystemManager().readFile({
          filePath: compressed.tempFilePath,
          encoding: 'base64',
          success: imageResult => {
            wx.request({
              url: `${API_BASE_URL.replace(/\/$/, '')}/api/ocr`,
              method: 'POST',
              header: { 'content-type': 'application/json' },
              data: { image: imageResult.data },
              success: response => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                  const message = response.data && response.data.error;
                  this.setData({ hint: message || '腾讯云 OCR 请求失败，请手动填写读数。' });
                  return;
                }
                const text = response.data && response.data.text || '';
                const values = extractReadings(text);
                const filled = [values.systolic, values.diastolic, values.pulse].filter(Boolean).length;
                this.setData({
                  ...values,
                  hint: filled === 3
                    ? `识别结果：${values.systolic} / ${values.diastolic}，脉搏 ${values.pulse}。请对照屏幕核对后保存。`
                    : `只识别到部分数值（${filled}/3）。请对照血压计屏幕补全并核对。`
                });
              },
              fail: () => this.setData({ hint: '连接识别服务失败，请检查网络和 HTTPS 域名配置。' }),
              complete: () => wx.hideLoading()
            });
          },
          fail: () => { wx.hideLoading(); this.setData({ hint: '读取照片失败，请重新拍摄。' }); }
        });
      },
      fail: () => { wx.hideLoading(); this.setData({ hint: '压缩照片失败，请重新拍摄。' }); }
    });
  },

  onValueInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
  },

  saveRecord() {
    const systolic = Number(this.data.systolic);
    const diastolic = Number(this.data.diastolic);
    const pulse = Number(this.data.pulse);
    if (!systolic || !diastolic || !pulse || systolic < 50 || systolic > 280 || diastolic < 30 || diastolic > 180 || pulse < 30 || pulse > 220) {
      wx.showToast({ title: '\u8bf7\u586b\u5199\u6709\u6548\u7684\u9ad8\u538b\u3001\u4f4e\u538b\u548c\u8109\u640f', icon: 'none' });
      return;
    }
    try {
      const records = wx.getStorageSync(STORAGE_KEY) || [];
      records.unshift({ systolic, diastolic, sys: systolic, dia: diastolic, pulse, date: new Date().toISOString() });
      wx.setStorageSync(STORAGE_KEY, records);
      this.setData({ showConfirm: false, photoPath: '', systolic: '', diastolic: '', pulse: '' });
      this.loadRecords();
      wx.showToast({ title: '\u4fdd\u5b58\u6210\u529f', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '\u4fdd\u5b58\u5931\u8d25', content: (error && error.errMsg) || '\u8bf7\u5173\u95ed\u540e\u91cd\u8bd5\u3002', showCancel: false });
    }
  },
  closeConfirm() { this.setData({ showConfirm: false }); }
});

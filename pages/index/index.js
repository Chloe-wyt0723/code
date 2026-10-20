const { API_BASE_URL } = require('../../config');
const STORAGE_KEY = 'yipengtong-blood-pressure-v1';
const MAX_OCR_BASE64_LENGTH = 10 * 1024 * 1024;
const IMAGE_QUALITIES = [85, 70, 55];
const READING_RANGES = {
  systolic: { min: 50, max: 280 },
  diastolic: { min: 30, max: 180 },
  pulse: { min: 30, max: 220 }
};

// Compress once at high quality to keep the monitor digits sharp. Only reduce
// quality further when the encoded image would exceed Tencent OCR's limit.
function prepareOcrImage(filePath, callback, qualities = IMAGE_QUALITIES) {
  const quality = qualities[0];
  if (quality === undefined) {
    callback(new Error('图片过大，请靠近血压计重新拍摄。'));
    return;
  }
  wx.compressImage({
    src: filePath,
    quality,
    success: compressed => {
      wx.getFileSystemManager().readFile({
        filePath: compressed.tempFilePath,
        encoding: 'base64',
        success: result => {
          if (result.data.length > MAX_OCR_BASE64_LENGTH) {
            prepareOcrImage(filePath, callback, qualities.slice(1));
            return;
          }
          callback(null, result.data);
        },
        fail: callback
      });
    },
    fail: callback
  });
}

function formatDate(value) {
  const date = new Date(value);
  const pad = number => String(number).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}/${month}/${day} ${hours}:${minutes}`;
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
  Object.keys(READING_RANGES).forEach(field => {
    const { min, max } = READING_RANGES[field];
    if (result[field] !== null && (result[field] < min || result[field] > max)) {
      result[field] = '';
    }
  });
  return result;
}

function buildBpAlert(systolic, diastolic) {
  const abnormal = [];
  const hasSystolic = systolic !== null && systolic !== undefined && String(systolic).trim() !== '';
  const hasDiastolic = diastolic !== null && diastolic !== undefined && String(diastolic).trim() !== '';
  if (hasSystolic && Number(systolic) > 140) abnormal.push(`高压 ${systolic} mmHg（>140）`);
  if (hasDiastolic && Number(diastolic) > 90) abnormal.push(`低压 ${diastolic} mmHg（>90）`);
  if (hasSystolic && Number(systolic) < 90) abnormal.push(`高压 ${systolic} mmHg（<90）`);
  if (hasDiastolic && Number(diastolic) < 60) abnormal.push(`低压 ${diastolic} mmHg（<60）`);
  return abnormal.length
    ? `血压异常：${abnormal.join('，')}。将推送到子女端。`
    : '';
}

Page({
  data: {
    showConfirm: false,
    photoPath: '',
    hint: '请先拍摄血压计屏幕。',
    bpAlert: '',
    systolic: '',
    diastolic: '',
    pulse: '',
    latest: null,
    lastDate: '',
    history: []
  },

  onLoad() {
    this.loadRecords();
  },

  onShow() {
    this.loadRecords();
  },

  loadRecords() {
    const records = wx.getStorageSync(STORAGE_KEY) || [];
    const formattedRecords = records.map(record => ({
      ...record,
      displayDate: formatDate(record.date)
    }));
    this.setData({
      latest: formattedRecords[0] || null,
      lastDate: formattedRecords[0] ? formattedRecords[0].displayDate : '',
      history: formattedRecords.slice(1)
    });
  },

  takePhoto() {
    this.selectImage(['camera']);
  },

  chooseFromAlbum() {
    this.selectImage(['album']);
  },

  selectImage(sourceType) {
    const isAlbum = sourceType.includes('album');
    const onSuccess = result => {
      const file = result && result.tempFiles && result.tempFiles[0];
      const filePath = file && (file.tempFilePath || file.path);
      if (!filePath) {
        wx.showModal({
          title: '没有拍到照片',
          content: '请重试或手动输入。',
          showCancel: false
        });
        return;
      }
      this.onPhoto(filePath);
    };
    const onFail = error => {
      const message = (error && (error.errMsg || error.message)) || '';
      if (/cancel/i.test(message)) return;
      wx.showModal({
        title: isAlbum ? '\u65e0\u6cd5\u6253\u5f00\u76f8\u518c' : '\u65e0\u6cd5\u6253\u5f00\u76f8\u673a',
        content: message || (isAlbum
          ? '\u8bf7\u5141\u8bb8\u5c0f\u7a0b\u5e8f\u8bbf\u95ee\u76f8\u518c\u540e\u91cd\u8bd5\u3002'
          : '\u8bf7\u5728\u771f\u673a\u4e2d\u6388\u4e88\u76f8\u673a\u6743\u9650\u540e\u91cd\u8bd5\uff0c\u6216\u624b\u52a8\u8f93\u5165\u3002'),
        showCancel: false
      });
    };
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType,
        camera: 'back',
        success: onSuccess,
        fail: onFail
      });
    } else if (typeof wx.chooseImage === 'function') {
      wx.chooseImage({
        count: 1,
        sourceType,
        success: result => onSuccess({
          tempFiles: result.tempFiles || (result.tempFilePaths || []).map(path => ({ path }))
        }),
        fail: onFail
      });
    } else {
      wx.showModal({
        title: '\u6682\u4e0d\u652f\u6301\u56fe\u7247\u9009\u62e9',
        content: '\u8bf7\u5347\u7ea7\u5fae\u4fe1\u540e\u91cd\u8bd5\u3002',
        showCancel: false
      });
    }
  },

  onPhoto(filePath) {
    this.setData({
      photoPath: filePath,
      showConfirm: true,
      hint: '\u6b63\u5728\u8bc6\u522b\u7167\u7247\uff0c\u8bf7\u7a0d\u5019\u2026',
      systolic: '',
      diastolic: '',
      pulse: '',
      bpAlert: ''
    });
    this.recognizePhoto(filePath);
  },

  openManualEntry() {
    this.setData({
      photoPath: '',
      showConfirm: true,
      hint: '\u8bf7\u6839\u636e\u8840\u538b\u8ba1\u5c4f\u5e55\u624b\u52a8\u586b\u5199\u3002',
      systolic: '',
      diastolic: '',
      pulse: '',
      bpAlert: ''
    });
  },

  noop() {},

  onBackPress() {
    if (this.data.showConfirm) {
      this.closeConfirm();
      return true;
    }
    return false;
  },

  recognizePhoto(filePath) {
    if (!API_BASE_URL || API_BASE_URL.indexOf('YOUR_HTTPS_DOMAIN') >= 0) {
      this.setData({ hint: '请先在 config.js 中填写已部署的 HTTPS 服务地址，再连接腾讯云 OCR。' });
      return;
    }
    wx.showLoading({ title: '正在识别…', mask: true });
    prepareOcrImage(filePath, (imageError, imageBase64) => {
      if (imageError) {
        wx.hideLoading();
        this.setData({ hint: imageError.message || '图片处理失败，请重新拍摄。' });
        return;
      }
      wx.request({
        url: `${API_BASE_URL.replace(/\/$/, '')}/api/ocr`,
        method: 'POST',
        header: { 'content-type': 'application/json' },
        data: { image: imageBase64 },
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
            bpAlert: buildBpAlert(values.systolic, values.diastolic),
            hint: filled === 3
              ? `识别结果：${values.systolic} / ${values.diastolic}，脉搏 ${values.pulse}。请对照屏幕核对后保存。`
              : `只识别到部分数值（${filled}/3）。请对照血压计屏幕补全并核对。`
          });
        },
        fail: () => this.setData({ hint: '连接识别服务失败，请检查网络和 HTTPS 域名配置。' }),
        complete: () => wx.hideLoading()
      });
    });
  },

  onValueInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    const systolic = field === 'systolic' ? value : this.data.systolic;
    const diastolic = field === 'diastolic' ? value : this.data.diastolic;
    this.setData({ [field]: value, bpAlert: buildBpAlert(systolic, diastolic) });
  },

  saveRecord() {
    const systolic = Number(this.data.systolic);
    const diastolic = Number(this.data.diastolic);
    const pulse = Number(this.data.pulse);
    const readings = { systolic, diastolic, pulse };
    const hasInvalidReading = Object.keys(READING_RANGES).some(field => {
      const value = readings[field];
      const { min, max } = READING_RANGES[field];
      return !value || value < min || value > max;
    });

    if (hasInvalidReading) {
      wx.showToast({
        title: '请填写有效的高压、低压和脉搏',
        icon: 'none'
      });
      return;
    }
    const bpAlert = buildBpAlert(systolic, diastolic);
    try {
      const records = wx.getStorageSync(STORAGE_KEY) || [];
      records.unshift({ systolic, diastolic, sys: systolic, dia: diastolic, pulse, date: new Date().toISOString() });
      wx.setStorageSync(STORAGE_KEY, records);
      this.setData({
        showConfirm: false,
        photoPath: '',
        systolic: '',
        diastolic: '',
        pulse: '',
        bpAlert: ''
      });
      this.loadRecords();
      if (bpAlert) {
        wx.showModal({ title: '血压异常提醒', content: `${bpAlert}\n本次记录已保存。`, showCancel: false });
      } else {
        wx.showToast({ title: '保存成功', icon: 'success' });
      }
    } catch (error) {
      wx.showModal({
        title: '保存失败',
        content: (error && error.errMsg) || '请关闭后重试。',
        showCancel: false
      });
    }
  },

  deleteRecord(event) {
    const date = event.currentTarget.dataset.date;
    if (!date) return;
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后无法恢复，请确认。',
      confirmText: '删除',
      confirmColor: '#b6423a',
      success: result => {
        if (!result.confirm) return;
        try {
          const records = wx.getStorageSync(STORAGE_KEY) || [];
          const remaining = records.filter(record => record.date !== date);
          if (remaining.length === records.length) {
            wx.showToast({ title: '这条记录已不存在', icon: 'none' });
            return;
          }
          wx.setStorageSync(STORAGE_KEY, remaining);
          this.loadRecords();
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (error) {
          wx.showModal({ title: '删除失败', content: (error && error.errMsg) || '请稍后重试。', showCancel: false });
        }
      }
    });
  },

  closeConfirm() {
    this.setData({ showConfirm: false });
  }
});

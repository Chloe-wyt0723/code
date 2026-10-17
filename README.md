# 一碰通小程序与腾讯云 OCR

## OCR 调用链

小程序将拍摄的血压计照片压缩后，以 Base64 发送到已部署的 HTTPS 服务端 /api/ocr。服务端调用腾讯云文字识别的 GeneralAccurateOCR（通用文字识别高精度版），再把识别文本返回小程序。原图不写入服务端文件或数据库。

腾讯云要求图片 Base64 不超过 10 MB；代码会在服务端检查大小。用户仍需核对 OCR 结果后保存。

## 配置腾讯云密钥

1. 在腾讯云控制台开通文字识别服务，并创建仅具备 OCR 调用权限的访问密钥。
2. 进入 backend 目录，将 .env.example 复制为 .env，填写 TENCENTCLOUD_SECRET_ID 与 TENCENTCLOUD_SECRET_KEY。不要把密钥填进小程序代码或提交到代码仓库。
3. 在 backend 目录运行 npm install，再运行 npm start。
4. 将 backend 部署到支持 Node.js 18+ 的服务器，并配置 HTTPS。
5. 编辑项目根目录 config.js，把 API_BASE_URL 改成服务端 HTTPS 根地址，不要添加 /api/ocr。
6. 在微信小程序管理后台的服务器域名中配置该 HTTPS 域名，然后重新编译、真机预览。

本地运行后可访问 /health 查看服务是否启动。OCR 需要有效的腾讯云密钥、已开通的 OCR 服务和网络连接。

## 腾讯云接口

本项目服务端调用 GeneralAccurateOCR，API 版本 2018-11-19；密钥仅从服务端环境变量读取。
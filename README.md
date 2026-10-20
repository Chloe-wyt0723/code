# 一碰通小程序与腾讯云 OCR

## OCR 调用链

小程序将拍摄的血压计照片压缩后，以 Base64 发送到已部署的 HTTPS 服务端 /api/ocr。服务端使用 OpenCV 检测并透视校正屏幕区域，裁切后转灰度、增强对比度并自适应二值化，再调用腾讯云文字识别 GeneralAccurateOCR。未检测到屏幕矩形时会处理整张照片；二值图没有识别到文字时，会用原图再识别一次。原图只在内存中处理，不写入服务端文件或数据库。

腾讯云要求图片 Base64 不超过 10 MB；代码会在服务端检查大小。用户仍需核对 OCR 结果后保存。

## 配置腾讯云密钥

1. 在腾讯云控制台开通文字识别服务，并创建仅具备 OCR 调用权限的访问密钥。
2. 进入 backend 目录，将 .env.example 复制为 .env，填写 TENCENTCLOUD_SECRET_ID 与 TENCENTCLOUD_SECRET_KEY。不要把密钥填进小程序代码或提交到代码仓库。
3. 在 backend 目录运行 npm install，再运行 `python -m pip install -r requirements.txt`，然后运行 npm start。也可以使用项目提供的 Dockerfile 构建镜像，镜像会安装 OpenCV。
4. 将 backend 部署到支持 Node.js 18+、Python 3、OpenCV 和 NumPy 的服务器，并配置 HTTPS。
5. 编辑项目根目录 config.js，把 API_BASE_URL 改成服务端 HTTPS 根地址，不要添加 /api/ocr。
6. 在微信小程序管理后台的服务器域名中配置该 HTTPS 域名，然后重新编译、真机预览。

本地运行后可访问 /health 查看服务是否启动。OCR 需要有效的腾讯云密钥、已开通的 OCR 服务和网络连接。

## 腾讯云接口

本项目服务端调用 GeneralAccurateOCR，API 版本 2018-11-19；密钥仅从服务端环境变量读取。

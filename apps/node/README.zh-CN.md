# my_midway_project

## 快速入门

<!-- 在此次添加使用文档 -->

如需进一步了解，参见 [midway 文档][midway]。

### 本地开发

```bash
$ npm i
$ npm run dev
$ open http://localhost:7001/
```

### 部署

```bash
$ npm start
```

### 内置指令

- 使用 `npm run lint` 来做代码风格检查。
- 使用 `npm test` 来执行单元测试。

### OSS 接入

项目已预留阿里云 OSS 配置，配置项在 `.env.example`：

- `OSS_ENABLED`
- `OSS_REGION`
- `OSS_BUCKET`
- `OSS_ENDPOINT`
- `OSS_PUBLIC_BASE_URL`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_STS_TOKEN`
- `OSS_SECURE`
- `OSS_TIMEOUT_MS`
- `OSS_UPLOAD_PREFIX`
- `OSS_SIGNED_URL_EXPIRE_SECONDS`

配置完成后，可调用受保护接口生成前端直传 OSS 的签名地址：

```bash
POST /api/storage/oss/sign-upload
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileName": "avatar.png",
  "folder": "avatars",
  "contentType": "image/png"
}
```

返回结果会包含：

- `uploadUrl`：前端直接 `PUT` 文件到 OSS 使用
- `publicUrl`：上传成功后可访问的资源地址
- `objectKey`：OSS 内对象路径
- `headers`：上传时需要一并带上的请求头

### 腾讯云 COS 接入

腾讯云对象存储产品名称是 `COS`。项目已新增一套并行的腾讯云 COS 接入。

配置项在 `.env.example`：

- `TENCENT_COS_ENABLED`
- `TENCENT_COS_REGION`
- `TENCENT_COS_BUCKET`
- `TENCENT_COS_SECRET_ID`
- `TENCENT_COS_SECRET_KEY`
- `TENCENT_COS_SECURITY_TOKEN`
- `TENCENT_COS_PROTOCOL`
- `TENCENT_COS_DOMAIN`
- `TENCENT_COS_PUBLIC_BASE_URL`
- `TENCENT_COS_UPLOAD_PREFIX`
- `TENCENT_COS_SIGNED_URL_EXPIRE_SECONDS`

生成腾讯云 COS 签名上传地址的接口：

```bash
POST /api/storage/cos/sign-upload
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileName": "avatar.png",
  "folder": "avatars",
  "contentType": "image/png"
}
```

返回结构与阿里云 OSS 接口保持一致：

- `uploadUrl`
- `publicUrl`
- `objectKey`
- `headers`

### AI 语音识别配置

语音消息识别使用单独的一组模型配置，配置项在 `.env.example`：

- `SPEECH_TO_TEXT_API_KEY`
- `SPEECH_TO_TEXT_BASE_URL`
- `SPEECH_TO_TEXT_MODEL`

配置完成后，后端会在接收用户语音消息时尝试执行语音转文字，并把识别结果存入消息表中。


[midway]: https://midwayjs.org

# my_midway_project

## 快速入门

<!-- 在此次添加使用文档 -->

如需进一步了解，参见 [midway 文档][midway]。

### 本地开发

```bash
$ pnpm install
$ cp ../../.env.example ../../.env
$ pnpm run dev
$ open http://localhost:7001/
```

### 部署

```bash
$ pnpm start
```

### 内置指令

- 使用 `pnpm run lint` 来做代码风格检查。
- 使用 `pnpm test` 来执行单元测试。

### 文件上传

小程序端当前通过 Node 中转上传文件，Node 接收 `multipart/form-data` 后使用腾讯云 COS SDK 存储，不再让小程序直接持有 COS 预签名上传地址。

```bash
POST /api/storage/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file=<本地文件>
folder=avatars
fileName=avatar.png
contentType=image/png
```

返回结果：

- `objectKey`：COS 内对象路径，业务表保存这个值
- `publicUrl`：上传成功后可访问的资源地址

腾讯云对象存储产品名称是 `COS`。配置项在仓库根目录 `.env.example`：

- `NODE_TENCENT_COS_ENABLED`
- `NODE_TENCENT_COS_REGION`
- `NODE_TENCENT_COS_BUCKET`
- `NODE_TENCENT_COS_SECRET_ID`
- `NODE_TENCENT_COS_SECRET_KEY`
- `NODE_TENCENT_COS_SECURITY_TOKEN`
- `NODE_TENCENT_COS_PROTOCOL`
- `NODE_TENCENT_COS_DOMAIN`
- `NODE_TENCENT_COS_PUBLIC_BASE_URL`
- `NODE_TENCENT_COS_UPLOAD_PREFIX`

### 历史签名上传接口

项目仍保留旧的签名上传接口，便于回滚或兼容历史调用；小程序头像、聊天图片等上传链路不再使用这些接口。

#### 阿里云 OSS

项目仍保留阿里云 OSS 配置，统一放在仓库根目录 `.env.example`，Node 相关配置使用 `NODE_` 前缀：

- `NODE_OSS_ENABLED`
- `NODE_OSS_REGION`
- `NODE_OSS_BUCKET`
- `NODE_OSS_ENDPOINT`
- `NODE_OSS_PUBLIC_BASE_URL`
- `NODE_OSS_ACCESS_KEY_ID`
- `NODE_OSS_ACCESS_KEY_SECRET`
- `NODE_OSS_STS_TOKEN`
- `NODE_OSS_SECURE`
- `NODE_OSS_TIMEOUT_MS`
- `NODE_OSS_UPLOAD_PREFIX`
- `NODE_OSS_SIGNED_URL_EXPIRE_SECONDS`

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

#### 腾讯云 COS 签名上传

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

语音消息识别使用单独的一组模型配置，配置项在仓库根目录 `.env.example`：

- `NODE_SPEECH_TO_TEXT_API_KEY`
- `NODE_SPEECH_TO_TEXT_BASE_URL`
- `NODE_SPEECH_TO_TEXT_MODEL`

配置完成后，后端会在接收用户语音消息时尝试执行语音转文字，并把识别结果存入消息表中。

### AI 语音合成配置

语音合成使用单独的一组模型配置，配置项在仓库根目录 `.env.example`：

- `NODE_TEXT_TO_SPEECH_API_KEY`
- `NODE_TEXT_TO_SPEECH_BASE_URL`
- `NODE_TEXT_TO_SPEECH_MODEL`
- `NODE_TEXT_TO_SPEECH_VOICE`
- `NODE_TEXT_TO_SPEECH_LANGUAGE_TYPE`

当前示例模型为 `qwen3-tts-vc-2026-01-22`。
其中 `NODE_TEXT_TO_SPEECH_VOICE` 需要填写已复刻完成的音色名称。
语音消息触发的联系人回复会优先尝试走这组 TTS 配置；若配置缺失或合成失败，则自动回退为文本回复。


[midway]: https://midwayjs.org

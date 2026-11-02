# 人脸识别（家人相册）运维手册

## 组件

| 组件 | 作用 | 端口 |
| --- | --- | --- |
| `tzl_face_sidecar` | 检测 + 质量分 + 128 维编码（CPU，dlib） | 内网 8899 |
| `tzl_node` | 识别内核（多模板/三档决策）、聊天集成、内部接口 | 7001 |
| `tzl_admin_node` | 管理端接口 `/admin_api/face/*` | 7002 |
| `tzl_admin_web` | 用户详情 →「家人相册」页面 | 80/443 |

数据：`user_known_person`（人）、`user_known_person_face`（人脸模板）、`face_recognition_log`（日志，90 天 TTL）。

## 常用操作

### 给某个家人登记人脸

管理后台 → 用户与关系 → 用户详情 →「家人相册」→ 选人 →「登记人脸」→ 上传 3~5 张照片。
照片会上传到 COS `face-albums/`，后台调用 sidecar 编码；小于 80px 或明显模糊的照片自动跳过。

### 识别测试

「家人相册」→「识别测试」→ 上传一张图 → 显示每张脸的判定（确认/反问/不认识）、最像的人、距离、质量。

### 合并重复的家人

「家人相册」→「合并到…」→ 选择目标；源档案的人脸模板迁移过去，源档案归档（不再参与识别）。

### 开关与阈值（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NODE_FACE_RECOGNITION_ENABLED` | true | 总开关（false 时聊天不调识别） |
| `NODE_FACE_SIDECAR_URL` | `http://tzl_face_sidecar:8899` | sidecar 地址 |
| `NODE_FACE_CONFIRM_DISTANCE` | 0.45 | 确认档距离上限 |
| `NODE_FACE_ASK_DISTANCE` | 0.60 | 反问档距离上限 |
| `NODE_FACE_CONFIRM_MARGIN` | 0.08 | 确认档 top1/top2 间隔 |
| `NODE_FACE_MIN_FACE_SIZE` | 80 | 人脸最小边长（px） |
| `NODE_FACE_MIN_BLUR` | 40 | 拉普拉斯方差下限 |
| `NODE_FACE_MAX_YAW` | 0.35 | 侧脸容忍度 |
| `NODE_FACE_EMBEDDING_KEY` | 空 | 配置后向量 AES-256-GCM 加密落库 |
| `NODE_FACE_REQUIRE_CONSENT` | false | true 时未同意不做识别 |

## 同意与合规

- 用户同意存 `user.faceRecognitionConsent{granted,at,source,version}`；
- 管理端接口 `GET/POST /admin_api/face/consent` 可查/记录（线下授权场景）；
- **撤回 = 删除**：`granted=false` 时自动清空该用户全部人脸模板；
- 日志只保留 `objectKeyHash`（不存原图路径），90 天自动删除；
- 开启强制同意前，需小程序端先上线同意弹窗，再设 `NODE_FACE_REQUIRE_CONSENT=true`。

## 真实数据阈值标定（需授权后执行）

```bash
# 1) 抽样 30 位有头像的用户（只抽样，不下载）
python3 apps/face-sidecar/tools/sample_avatars.py --limit 30 --dry-run

# 2) 确认授权后下载到头像临时目录
python3 apps/face-sidecar/tools/sample_avatars.py --limit 30 --out /tmp/face-eval/raw

# 3) 在 sidecar 内跑标定（同人/跨人分布 + FAR/FRR + 小库决策模拟）
docker cp /tmp/face-eval tzl_face_sidecar:/tmp/face-eval
docker exec tzl_face_sidecar python3 /app/tools/threshold_eval.py

# 4) 立刻清理
rm -rf /tmp/face-eval
```

## 回滚

```bash
# 关闭识别（不影响对话）
docker exec tzl_node sh -lc 'echo NODE_FACE_RECOGNITION_ENABLED=false'
# 或停 sidecar（node 侧调用失败会自动降级，不阻断聊天）
docker stop tzl_face_sidecar

# 回滚代码
git reset --hard <上一个已验证提交> && /usr/local/sbin/tzl-deploy-release ...
```

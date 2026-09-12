# 本地向量库（第二层检索评测用）

第二层（原文检索）需要向量库。本地评测机用仓库 `docker-compose.yml` 里的
etcd + minio + milvus standalone，端口与 `.env` 对齐（`127.0.0.1:17953`）。

## 启动 / 停止

```bash
docker start tzl-etcd tzl_minio        # 先起依赖
sleep 5
docker start tzl-milvus-standalone     # 健康检查 http://127.0.0.1:19091/healthz
# 停止
docker stop tzl-milvus-standalone tzl_minio tzl-etcd
```

`.env` 里需要 `NODE_MILVUS_ENABLED=true`、`MILVUS_ADDRESS=127.0.0.1:17953`，
并提供 embedding 配置（`NODE_EMBEDDING_*`）。

## 第二层探针

```bash
cd apps/node
MIRROR_DB=tzl_mirror_s1 DOTENV_CONFIG_PATH=../../.env \
  node scripts/memory-eval/retrieval-probe.js --user=<userId> --run=<runId>
# 产物：.task-evidence/memory-eval/probe-<runId>.json
```

探针做三件事：把镜像库里的用户原话按人物标签与全量两种方式写入**本地**向量库；
用靠后的原话当查询检索；核对之前的旧话能否被取回（按人物 / 按话题两条路径）。
只写本地镜像库与本地向量库，不连生产。

## 没有向量库时

回放脚本会把"本该入库的原话条目"记进镜像库的 `eval_anchor_unit`，
`anchor-coverage.js` 可以核对原话留存率与人物标签覆盖率。
真实语义召回仍以本探针为准。

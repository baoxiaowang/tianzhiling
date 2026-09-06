# Memory Worker 运行与验收

## 运行边界

- `tzl_node` 使用 `NODE_RUNTIME_ROLE=web`：保留四个聊天实例，只生产 `memory-pipeline` 任务，不消费该队列。
- `tzl_memory_worker` 使用 `NODE_RUNTIME_ROLE=memory-worker`：只消费 `memory-pipeline`，PM2 实例数为 1，初始并发为 1。
- `NODE_MEMORY_WORKER_CONCURRENCY` 只接受正整数，并在程序内限制为最多 2。提升到 2 必须基于生产稳定性数据另行决定。

## 发布验收标准

发布脚本必须自动验证以下硬条件；任一失败即回滚：

1. `tzl_node` 健康响应中角色为 `web`，本地 `memory-pipeline` Worker 数为 0，`conversation-reply` Worker 数为 1。
2. `tzl_memory_worker` 健康响应中角色为 `memory-worker`，本地 `memory-pipeline` Worker 数为 1，`conversation-reply` Worker 数为 0，并发配置为 1。
3. Web 四实例及 Memory Worker 单实例在稳定观察窗口内均无重启，内部健康检查和公网健康检查通过。
4. 写入一条正常聊天后，记忆任务能够完成，队列 `pending`、`processing` 和最老等待时长不持续增长；聊天回复不依赖 Memory Worker 同步完成。
5. 每个实际执行的记忆任务产生一条 `[memory-pipeline-metrics]` 日志，包含任务类型、结果、耗时、模型逻辑调用数、供应商尝试数、Embedding/视觉调用数，以及 RSS、heap、external、arrayBuffers 的前后值和差值。

## 内存归因和 Heap Snapshot

先按任务类型聚合 `[memory-pipeline-metrics]`，观察 GC 后的 `heapUsedAfter` 低位基线，而不是用单个任务的 RSS 增量判断泄漏。只有同一任务类型在多个 GC 周期后仍持续抬高基线，且队列吞吐、模型调用量无法解释时，才对隔离 Worker 采集 snapshot。

`tzl_memory_worker` 默认以 `--heapsnapshot-signal=SIGUSR2` 启动。Heap snapshot 可能包含聊天内容、模型请求及其他敏感对象，只能在受控目录采集、限制访问并在分析完成后按生产数据规范清理；不能在 Web 四实例上采集。

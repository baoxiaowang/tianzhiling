# 记忆积压/召回：隔离诊断与本地候选

不是新框架，是隔离验证目录。所有脚本**不联网、不改生产**；原话只在受限目录。

## 补丁与验证（权威）
- `.task-evidence/cpu-recall-20260915/proposed.patch`：相对生产提交 `a237b35` 的 diff，已干跑可干净应用。
- `.task-evidence/cpu-recall-20260915/candidate-src/`：`prod-src` 应用该补丁后的隔离副本。
- `run-patched-tests.cjs`：**直接加载并调用补丁后的实际函数**（不再另写候选逻辑），覆盖：
  - 空检索键仍检索、且用完整原话查询；
  - 有关键词时仍保留句中的具体事情（"爸爸我明天坐高铁回去读书"）；
  - 短回复"嗯/好的"不新增搜索；
  - 不因缺字面键删候选；
  - 同来源原话优先，且不挤掉其他人物精确命中；
  - 请求 10 条给到 10；
  - 写入侧复现：事实句可入索引、"事实+情绪/祈愿"被整句排除。
  结果：`patched-tests-result.json`。

## 积压复现
- `backlog-repro.cjs`：本地 Redis（127.0.0.1:17380）+ BullMQ，独立前缀，复现
  “门槛拒绝 → Bull 任务完成、DB 仍 pending → 同 jobId 重排被保留记录挡住 → 不自愈”，
  并验证最小修复（重排前清终态 job 记录）：门槛恢复后可重跑、重复协调不重复执行、失败可恢复、不删任务不标完成。
  结果：`backlog-repro-result.json`。

## 现状复现（不代表修复）
- `run-cases.cjs`：用生产提交的纯函数复现**当前**自动入口的触发/过滤/排序/上限（含 vs 候选的对照展示）。
  其中分支逻辑只是说明用；**权威验证看 `run-patched-tests.cjs`**。

## 运行
```
node apps/node/scripts/memory-recall-candidate/run-patched-tests.cjs
node apps/node/scripts/memory-recall-candidate/backlog-repro.cjs
node apps/node/scripts/memory-recall-candidate/run-cases.cjs
```

## 未包含
生产发布/重启/改任务状态/删数据/全量重建；换 embedding；扩大并发；自动注入条数仍为 1。
构造用例只证明机制，不代表真实召回效果。

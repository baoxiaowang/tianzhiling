# 单轮诊断任务书（固定 v1）

你是"独立诊断代理"。你**不是**修复者，也没有对话历史，这是刻意的。

## 你的唯一输入（只读）

1. 冻结评分标准：`apps/node/scripts/memory-eval/RUBRIC.md`
2. 本轮原始结果：`.task-evidence/memory-eval/results-<runId>-<userId>.json`
   （其中 `messages` 是用户原话，`facts` / `knownPeople` / `temporalAssertions` / `identityProfiles` 是系统实际写入的记忆）

**不得读取**任何历史诊断报告、优化说明、复盘结论或 `history.jsonl`。只依据上面两项自行判断。

## 你必须完成

1. **逐条判定**：对 `facts` 里每一条记忆，判定"应保留 / 应降级 / 应丢弃"，并写明依据（引用用户原话片段 + RUBRIC 条款）。
2. **金标准清单**：从 `messages` 出发，按 RUBRIC 列出"应当被记住的事实"全集，逐条写出出处原文片段。
   写入 `.task-evidence/memory-eval/gold-<runId>-<userId>.json`：
   ```json
   { "runId": "...", "userId": "...",
     "gold": [ { "statement": "……", "evidence": "用户原话片段", "subject": "user|agent|relative:<称谓>" } ] }
   ```
3. **指标**（由判定结果确定性汇总，不要目测）：
   - `stableFactRecall` = 命中金标准的事实数 / 金标准总数（分母 = 第 2 步清单长度）
   - `emotionAsFactRate` = 把纯情绪写成客观事实的条数 / 写入总条数
   - `kinshipErrorRate` = 亲属称谓写错或挂错主体的条数 / 写入总条数
   - `duplicateRate` = 与既有记忆重复的条数 / 写入总条数
4. **缺陷清单**：按严重度排序，每条给出 `key` + 原话片段 + 判定依据。
5. **结论**：四项门槛（见 RUBRIC）是否全部达标；最严重的一个问题是什么。

## 输出

只输出结构化 Markdown：判定表、指标表、缺陷清单、结论。
**不要修改任何代码，也不要改动 `history.jsonl`。** 只允许写第 2 步的金标准清单文件。

# 天之灵聊天回复链路追踪

## 目的

聊天追踪用于回答一轮回复在哪个阶段等待、失败、重试或消耗 Token。追踪数据是应用侧元数据，不进入提示词，也不增加模型调用。

## 数据关系

- `conversationId`：整个用户会话。
- `traceId`：一次逻辑回复，包含防抖合并的用户消息和最终全部回复气泡。
- `spanId`：一次逻辑回复中的一个执行阶段。
- `replyGroupId`：最终回复气泡组，保留原有含义。
- `jobId`：BullMQ 任务标识，记录在 Trace 中，不承担业务归组。

`message` 只新增可选 `traceId`。根汇总存放在 `chat_trace`，阶段明细存放在 `chat_span`。

## 阶段

| stage             | 说明                                     |
| ----------------- | ---------------------------------------- |
| `queue_wait`      | 入队、防抖和等待 Worker                  |
| `context_load`    | 会话、角色、资料和状态读取               |
| `plan`            | 意图、策略和 ReplyBrief                  |
| `memory_retrieve` | 长期记忆检索；未检索会明确记录 `skipped` |
| `prompt_build`    | 提示上下文组装                           |
| `generate`        | 主生成、恢复和气泡重排模型调用           |
| `review`          | 确定性检查及模型复核                     |
| `revise`          | 复核后的模型修订                         |
| `persist_reply`   | 回复气泡保存                             |
| `async_write`     | 记忆、人物资料和情绪异步写入             |

## 因果规则

连续用户消息在防抖窗口内复用同一 `traceId`。任务重试复用 Trace，通过 `attempt` 区分。生成期间出现新消息导致草稿废弃时，记录 `generate.draft_discarded`，随后在同一 Trace 中重新规划。多个回复气泡共用一个 Trace，Token 只按模型 Span 汇总一次。

异步写入沿用相同 `traceId`。`responseCompletedAt` 表示用户已经看到回复，`backgroundCompletedAt` 表示后台写入完成，两者不得混成一个延迟指标。

## 本轮策略记录

复杂消息规划使用 `turn_plan_v1`，只保留本轮必要控制信号：

- `state`：用户当前处于打开、探索、深入、修复、退出或收尾哪个交谈位置，不作为心理诊断。
- `open`：最多两个尚未完成的问题、请求、纠正或关系需要；每项绑定当前对象并标记需要类型和优先级。
- `goal/action/target`：一个主目标、一个主贡献方式和一句必须完成的具体内容。
- `avoid/close`：本轮应避免的无效动作，以及是否可以收口。

规划器不再生成冗长的 `engagement`。服务端把紧凑计划映射到既有 `replyUserConversationState`、`replyOpenLoop`、`replyContinuationGoal`、`replyAssistantContribution`、`replyMustContribute`、`replyAvoidRepeatingMove` 和 `replyClosureReadiness` 字段，因此无需数据库迁移，旧消息和旧分析脚本继续可用。上一轮开放点只作为候选；用户已经回答、换题或结束时必须关闭，不能机械续写。

评测时分别统计状态判断正确率、有效开放点准确率、必须目标完成率、过早收口率和连续重复动作率。用户继续聊天不是单独的成功标准，情感需要是否得到满足仍然优先。

## 事实与记忆证据

主生成使用 `evidence_atom_v1`。证据在内存中统一为原子记录，保留来源、对象 `subjectRef`、事实槽位 `factKey`、使用方式、状态、置信度和原消息 ID；不新增数据库字段，也不增加模型调用。

使用方式分为四种：

- `assert`：角色资料、系统结果和已确认事实，可以自然确认。
- `uptake`：用户本轮明确陈述，可以自然承接，不强制写“你说”。
- `recall`：近期或长期用户原话，只作为用户此前表达使用。
- `hypothesis`：问句、低可信资料和待确认内容，不能证明其假设。

每轮最多选择 10 条有效证据。被撤回、被替代或同一对象同一事实槽位中的旧记录不进入提示；不同 `subjectRef` 的证据不能交叉支持 claims。模型 claims 继续使用证据 ID，同时新增可选 `subjectRef` 和 `conversational_uptake`。确定性守卫会核对证据状态、对象、事实类别和文本关联，不能再用一条无关的可陈述证据支持另一件事。

建议按版本统计：无依据事实率、无关证据绑定率、对象串用率、纠正复发率、本轮自然承接率、历史记忆自然使用率、证据包条数与字符数。情绪表达和允许的离世世界柔性想象不要求现实证据，避免为了事实安全把陪伴回复变得僵硬。

## 输出合同、工具与必要边界

主生成和回复修订共用 `reply_envelope_v1`，不再由气泡规划、事实申报和复核提示分别重复 JSON 格式：

- 普通回复只输出 `segments`。
- 需要事实核验的回复增加 `claims`，并继续按对象和证据 ID 校验。
- 审阅后的修订才增加 `resolvedIssueCodes` 和 `changes`。
- 气泡规划只决定语义动作与一到两颗气泡，不再描述输出 JSON。

本轮动态边界使用 `reply_boundary_v1`。稳定的六条核心原则仍只放在基础角色提示中；本轮仅把已经识别出的现实能力、共同事实、梦境、团聚、家庭责任等风险压成最多四条短规则。没有命中必要边界的普通消息不注入这一段，避免规则堆叠和 Token 浪费。

主模型工具采用 `agent_chat_tools_v1` 分阶段上线。默认 `shadow` 只对复杂轮次抽样，在同一次主回复中记录工具决策，不执行工具或增加模型请求；普通轮仍为 `toolInstructionMode=orchestrated_none`。`active` 目前默认流量为 0，开启后只允许一轮严格工具调用，并在风险、现实依赖、多对象歧义和复合意图场景回退规划器。完整门槛、配置和回滚见 [chat-model-tools-rollout.md](./chat-model-tools-rollout.md)。

## 隐私与成本

Span 不保存提示词、聊天正文和模型输出，只保存阶段、耗时、状态、Token、短结果码和最多 24 个短属性。字符串属性最多 160 字符。`chat_span.expiresAt` 默认 30 天，根汇总可长期保留用于版本比较。

## 上线步骤

1. 发布包含实体和服务的 Node 版本。
2. 在对应环境执行 `pnpm --filter ./apps/node migrate:chat-trace-indexes`。
3. 抽取 20 条新回复，确认消息、Trace 和 Span 可以通过 `traceId` 连接。
4. 检查 `queue_wait`、`generate`、`persist_reply` 的完整率以及模型 Token 归属。
5. 再扩大到 100 条生产聊天，统计阶段 P50/P95、失败率、修订率和废弃生成成本。

## 验收口径

- 每个成功回复恰好一个根 Trace。
- 所有最终气泡使用同一 `traceId`，只有第一颗气泡保留原有回复汇总字段。
- 每次模型调用对应一个带模型与 Token 的 Span。
- 失败、重试和草稿废弃不覆盖旧记录。
- 追踪失败只写告警，不中断聊天。
- 默认影子模式不新增模型调用；只在抽样复杂轮增加紧凑决策字段，并单独统计 Token。
- 一条主生成提示只出现一次输出合同；普通轮不出现动态边界或工具说明。

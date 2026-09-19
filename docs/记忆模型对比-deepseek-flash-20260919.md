# DeepSeek Flash × 记忆抽取：质量 / 成本对比（2026-09-19）

## 一、结论

1. **质量打平**。15 条标注用例（7 正 / 8 负）上，`qwen-plus`、`deepseek-v4-flash`（百炼）、
   `deepseek-flash`（官方，思考开 / 关）四方全部 **15/15，tp=7 fp=0 fn=0 tn=8，0 报错**。
   这个样本量不足以区分质量，只能说明 DeepSeek Flash **没有明显劣化**。
2. **成本的主开关是「思考模式」，不是「换不换模型」**：
   - `deepseek-flash` 官方 **关闭思考 + 空闲时段** ≈ **1.32×** qwen-plus；高峰时段 **2.64×**；
   - 同一模型**开着思考** → **2.43×（空闲）/ 4.86×（高峰）**，钱几乎全烧在 reasoning tokens 上
     （reasoning 占输出的 81%，1665/2056）；
   - 百炼通道的 `deepseek-v4-flash` → **3.00×**（百炼输出价 2 元/1M 比官方便宜，
     但缓存命中价 0.2 元/1M 比官方 0.02 元/1M 贵 10 倍，且命中率只有 48%）。
3. **换不换**：现有样本下 **DeepSeek Flash 并不比 qwen-plus 便宜**（最好情况也是 1.32×）。
   唯一明显优势是延迟（思考关时平均 630ms vs 855ms）。
   **不建议为了省钱而换**；真正的杠杆是「关掉思考」和「提高缓存命中」。
4. 现网记忆主链路（`MemoryDecisionModelService`）**本来就已经用 `deepseek-flash` 官方通道，且已经显式关闭思考**
   （`thinking: { type: 'disabled' }`），所以主链路这一侧没有可再降的空间，也没有质量风险。

## 二、口径

| 项 | 值 |
| --- | --- |
| 任务 | 记忆「未了结事项抽取」（`buildOpenItemExtractionPrompt` + `parseOpenItemExtractionOutput`，`temperature=0, top_p=0.1, max_tokens=1200`） |
| 用例 | 15 条中文标注语料，7 条应抽出（就医/考研/面试/装修/领证/戒烟/等报告），8 条不应抽出（回忆、情绪、已完成、泛泛而谈、拒绝） |
| 执行 | 生产 `tzl_node` 容器内离线跑，用编译产物 `dist/service/memory/memory-open-item-extraction.js`，**不写任何业务数据** |
| 时间 | 2026-09-19（周六，北京时间全天为 DeepSeek 空闲时段） |
| 密钥 | 百炼用 `DASHSCOPE_API_KEY`；DeepSeek 官方用 `NODE_MEMORY_API_KEY`（有效） |

价格来源（均为官方原价，元 / 百万 tokens）：

- DeepSeek 官方：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>
  `deepseek-flash`：输入未命中 空闲 1 / 高峰 2；输入命中 空闲 0.02 / 高峰 0.04；输出 空闲 4 / 高峰 8。
  高峰 = 北京时间周一至周五 9:00-12:00、14:00-18:00（法定节假日除外），其余为空闲。
  旧名 `deepseek-v4-flash` 仍可调用，但已下线，实际由 V4.1-Flash 提供服务、按 Flash 价计费。
- 百炼 `qwen-plus`（华北2，输入 ≤128k）：<https://help.aliyun.com/zh/model-studio/qwen-plus>
  输入 0.8；缓存命中 0.16；输出 2。
- 百炼 `deepseek-v4-flash`（华北2）：<https://help.aliyun.com/zh/model-studio/deepseek-v4-flash>
  输入 1；缓存命中 0.2；输出 2。

## 三、质量

| 方案 | 准确率 | precision | recall | F1 | tp | fp | fn | tn | 报错 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| qwen-plus | 100% | 100% | 100% | 100% | 7 | 0 | 0 | 8 | 0 |
| deepseek-v4-flash（百炼，思考开） | 100% | 100% | 100% | 100% | 7 | 0 | 0 | 8 | 0 |
| deepseek-flash（官方，思考开） | 100% | 100% | 100% | 100% | 7 | 0 | 0 | 8 | 0 |
| deepseek-flash（官方，思考关） | 100% | 100% | 100% | 100% | 7 | 0 | 0 | 8 | 0 |

结论：本批语料下**没有质量差异**。要判断能不能换，需要更大、更难的用例集
（尤其是「模糊未了结 / 已了结」「时间已过期」这类边界样本），当前 15 条不具备区分度。

## 四、Token 与缓存

单批 15 次调用合计（同一次运行内、四个方案串行执行）：

| 方案 | prompt | 命中 | 未命中 | 输出 | reasoning | 缓存命中率 | 平均耗时 | 最慢 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| qwen-plus | 17256 | 15360 | 1896 | 362 | 0 | 89.0% | 855ms | 1684ms |
| deepseek-v4-flash（百炼，思考开） | 15982 | 7680 | 8302 | 2131 | 1736 | 48.1% | 2377ms | 5727ms |
| deepseek-flash（官方，思考开） | 16372 | 13440 | 2932 | 2056 | 1665 | 82.1% | 1192ms | 2723ms |
| deepseek-flash（官方，思考关） | 15997 | 11520 | 4477 | 374 | 0 | 72.0% | 630ms | 970ms |

要点：

- **思考模式是成本主导项**。开着思考时 reasoning 占输出的 81%（1665/2056），
  输出 token 成本是 qwen-plus 的 5.7 倍；关掉之后输出回到 374，与 qwen-plus 的 362 基本一致。
- **官方通道的缓存命中率（82.1%）明显高于百炼通道（48.1%）**，因为官方按
  `prompt_cache_hit_tokens` 细粒度计费，百炼这边只报 512 的整数倍。
- **缓存命中率随「缓存预热程度」显著漂移**：同一份脚本连续跑三轮，qwen-plus 的命中率
  依次是 **65.3% → 77.1% → 89.0%**，`deepseek-flash` 官方思考关是 **67.2% → 72.0%**。
  前缀是否稳定、缓存是否刚被别的请求命中，都会影响这一项，单轮数字不要当稳定值用。

## 五、成本

按上面实测 token 折算（15 次调用）：

| 方案 | 未命中 | 命中 | 输出 | 元 / 15 次 | 元 / 千次 | 相对 qwen-plus |
| --- | --- | --- | --- | --- | --- | --- |
| qwen-plus | 1896 | 15360 | 362 | 0.004698 | **0.313** | 1.00× |
| deepseek-flash 官方·思考关·空闲 | 4477 | 11520 | 374 | 0.006203 | **0.414** | 1.32× |
| deepseek-flash 官方·思考关·高峰 | 4477 | 11520 | 374 | 0.012407 | 0.827 | 2.64× |
| deepseek-flash 官方·思考开·空闲 | 2932 | 13440 | 2056 | 0.011425 | 0.762 | 2.43× |
| deepseek-flash 官方·思考开·高峰 | 2932 | 13440 | 2056 | 0.022850 | 1.523 | 4.86× |
| deepseek-v4-flash 百炼（思考开） | 8302 | 7680 | 2131 | 0.014100 | 0.940 | 3.00× |

按现网体量粗算：未了结抽取是**每用户每天一次**的离线任务（`enqueueOpenItemExtraction`），
单次成本在 0.0003-0.0015 元量级，**绝对金额很低，价差更多是方向性参考，不是账单问题**。

## 六、缓存命中埋点现状

- 埋点代码 `apps/node/src/service/memory/memory-cache-stats.ts` 随 `e04db6d` 已发布，
  `MEMORY_CACHE_STATS=1` 已写入生产 `.env`，`tzl_node` / `tzl_memory_worker` 容器内均已生效。
- 容器内已实测验证日志格式正确（`MEMORY_CACHE_CALL kind=… model=… prompt_tokens=… cached_tokens=… cache_miss_tokens=… completion_tokens=… hit_ratio=…`），
  兼容 DashScope（`prompt_tokens_details.cached_tokens`）与 DeepSeek（`prompt_cache_hit_tokens`）两种字段。
- **但线上还没打出任何一条**（`midway-app.log` 里 `MEMORY_CACHE_CALL` 计数为 0），原因是两条埋点链路当前都没有流量：
  1. `memory-decision:*` —— `NODE_MEMORY_VALUE_MODE=off`，记忆价值链对所有用户关闭
     （`memory-value-rollout.ts` 里 off / shadow / active 的判定）；
  2. `open-item:*` —— `memory_open_item` 最后更新停在 **2026-09-14**，之后再没跑过未了结抽取。
- 也就是说：**埋点没问题，是没流量**。要拿到真实缓存命中率，需要把 `NODE_MEMORY_VALUE_MODE` 打开
  （`shadow` 或 `active`，配合 `NODE_MEMORY_VALUE_USER_IDS` / cohort 文件），或让未了结抽取重新跑起来。

## 七、建议

1. **不建议为省钱换模型**：质量无差异，成本最好情况也只有 1.32×，高峰时段反而 2.64×。
2. 若确实要切 DeepSeek 到未了结抽取链路，**必须同时显式传 `thinking: { type: 'disabled' }`**
   （主链路 `MemoryDecisionModelService` 已经这么做了，未了结抽取没有），否则输出成本翻 5 倍。
3. 想真正降本，优先做这两件事：
   - 把 system prompt 固定成稳定前缀（现在官方通道命中率 72%-82%，还有空间）；
   - 把离线任务排到**空闲时段**（避开工作日 9-12、14-18），DeepSeek 官方空闲价是高峰的一半。
4. 若要判断质量是否可换，需要扩到 50-100 条边界语料再评一轮。

## 八、附：`NODE_CHAT_FALLBACK_API_KEY` 是另一回事

排查中发现两个 DeepSeek 密钥是独立的：

- `NODE_MEMORY_API_KEY`（`sk-…a23a`，35 位）——**有效**，记忆主链路在用，模型 `deepseek-flash`；
- `NODE_CHAT_FALLBACK_API_KEY`（`sk-…776b`，35 位）——**401 无效**，对话应急兜底
  （`NODE_CHAT_FALLBACK_MODEL=deepseek-v4-flash`）实际是坏的。最近 24h 没有触发过兜底，
  所以没有暴雷，但需要补一把有效密钥。

## 九、复现

对比脚本：`scripts/memory-model-comparison.js`，设计为在生产 `tzl_node` 容器内执行
（容器里有 `openai` 依赖和编译产物），需要环境变量 `DASHSCOPE_API_KEY`、`NODE_MEMORY_API_KEY`、`NODE_MEMORY_BASE_URL`。

```sh
docker cp scripts/memory-model-comparison.js tzl_node:/workspace/apps/node/
docker exec -w /workspace/apps/node tzl_node node /workspace/apps/node/memory-model-comparison.js
```

脚本会输出每个方案的 `SUMMARY` 行（准确率 / tp-fp-fn-tn / prompt / cached / completion / reasoning / 命中率 / 耗时）
和一行 `DETAIL` JSON 明细。

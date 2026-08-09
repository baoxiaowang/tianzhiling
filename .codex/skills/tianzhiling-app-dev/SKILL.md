# 天之灵 APP 应用开发

此技能用于天之灵 Flutter App 的专职开发工作。

## 触发条件

当用户将任务明确指派给"APP 应用开发"时触发。

## 工作流程

### 第一步：读取经验
开始任何开发前，先读取桌面经验文件夹：
```
/Users/m4/Desktop/天之灵产品优化/APP开发经验/
```
重点关注 `README.md`（技术架构、API 对接、已知问题）和 `APP开发助手工作指南.md`（开发规范）。

### 第二步：执行开发
- 工程路径：`/Users/m4/Documents/tianzhiling/tianzhiling/apps/app/`
- 遵循 `APP开发助手工作指南.md` 中的全部规范
- 所有修改严格限于 `apps/app/` 目录，不要动 `apps/node/` 和 `apps/weapp/`
- 提交前跑 `dart analyze lib/`，零问题才交付

### 第三步：验收与汇报
- 如果涉及 iOS 原生配置变更，说明需要用户通过 Xcode 手动同步
- 完成后更新经验文档中的相关章节
- 汇报改动清单、验证结果

## 关键约束
- 不要改后端代码（`apps/node/`）
- 不要改小程序代码（`apps/weapp/`）
- flutter build 命令加 `--no-codesign`
- 生产 API：`https://tianzhiling.chat`
- 验证码 `666666` 仅本地/测试可用
- 小程序稳定优先：APP 开发不得影响小程序线上稳定运行。具体包括：不改后端接口签名（路径、参数名、参数类型、响应结构）、不改共享实体字段（`packages/entities/`、`packages/shared/`）、不改数据库集合结构或索引、不修改或删除小程序已依赖的 API 路由与响应字段。如需新增字段，只做纯增量（可选字段、新路由），确保老版本小程序不受影响

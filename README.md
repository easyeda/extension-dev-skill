**[English](README_EN.md)** | 中文

# extension-dev-skill

用于 嘉立创EDA / EasyEDA 专业版扩展插件开发的 AI Skill。让 AI Agent 自动完成插件的 API 查询、代码生成、插件构建流程。

## 功能特性

- 针对[pro-api-sdk](https://github.com/easyeda/pro-api-sdk)优化
- 基于easyeda-api-skill文档驱动的代码生成
- 支持 MCP 调试工具链，实现 AI 自动构建 → 导入 → 日志监听


## 快速开始

### 1. 找到或创建 Skills 目录

根据你使用的 AI Agent 文档，找到或创建存放 Skill 的目录：

| Agent 类型 | 目录路径 |
|-----------|---------|
| 项目级 | `.agents/skills/` |
| 全局级 | `~/.agents/skills/` |

### 2. 克隆仓库

```bash
git clone https://github.com/easyeda/extension-dev-skill
```

### 3. 验证

在你的 AI Agent 中确认 Skill 已加载。

例如在 OpenCode 中执行 `/skills`，检查是否存在 `extension-dev-skill`。

## 工作原理

Skill 定义了一套工作流，AI Agent 在生成插件代码时会遵循：

```
计划 → 初始化 → API 查询 → 签名验证 → 方案确认 → 代码生成 → 约束检查 → 文档生成 → 部署
```

### 执行流程详解

| 步骤 | 名称 | 说明 |
|------|------|------|
| 1 | 计划 | 理解需求，确认目标编辑器和核心功能 |
| 2 | 初始化 | 工作区未初始化时执行项目初始化 |
| 3 | 查询 | 四步法查询 API，每个 API 必须在文档中验证 |
| 4 | 验证 | 确认所有类型签名完整，不确定则回退查询 |
| 5 | 确认 | 向用户展示实现方案，等待确认 |
| 6 | 执行 | 生成代码，API 调用包裹 try/catch |
| 7 | 检查 | 运行时约束检查、菜单 ID 唯一性校验 |
| 8 | 文档 | 生成/更新 README.md 和 CHANGELOG.md |
| 9 | 部署 | 构建并导入插件 |

### API 查询流程

1. 在 `resources/references/classes/` 中查找目标类
2. 在 `EDA.md` 中验证类的挂载路径（`eda.xxx_YYY`）
3. 确认方法签名、参数类型和返回类型
4. 递归查询返回接口的可用方法

## MCP 调试工具（可选）

[extension-dev-mcp-tools](https://github.com/easyeda/extension-dev-mcp-tools)

安装后 AI Agent 可支持：构建 `.eext` → 导入浏览器 → 获取控制台日志。

## 目录结构

```
extension-dev-skill/
├── SKILL.md                # Skill 核心定义（工作流、运行时约束、错误处理规范）
├── AGENTS.md               # Agent 补充指南（搜索规范、递归查询、代码约定）
├── CHANGELOG.md            # 变更日志
├── README.md               # 项目说明（中文，本文件）
├── README_EN.md            # 项目说明（English）
└── resources/
    ├── api-reference.md    # API 模块总览、eda 属性列表、MCP 工具文档
    ├── experience.md       # 常见踩坑经验总结
    ├── guide/              # 开发者指南（概念、入门、最佳实践）
    └── references/         # 完整 API 参考文档
        ├── _index.md       # 所有 API 实体索引
        ├── _quick-reference.md  # 方法签名速查表
        ├── classes/        # 120 个类文档
        ├── enums/          # 62 个枚举文档
        ├── interfaces/     # 70 个接口文档
        └── types/          # 19 个类型别名文档
```


## 演示视频

基于 OpenCode：

https://github.com/user-attachments/assets/742954b8-9527-43ad-ae08-3f08ec083fa2



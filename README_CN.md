# open-claude-code-router

一个透明的本地代理，封装 `@anthropic-ai/claude-code`，根据任务复杂度自动在 Anthropic 模型（Haiku / Sonnet / Opus）之间路由请求。安装一次后，`claude` 命令的使用方式与之前完全相同——简单任务走低价模型，规划和深度推理走旗舰模型。

[English Documentation](README.md)

## 工作原理

```
用户输入: claude "refactor this file"
                  |
         bin/claude.js (包装器)
                  |
      如代理未运行则后台启动
                  |
    以 ANTHROPIC_BASE_URL=http://127.0.0.1:3456
    启动真正的 claude-code
                  |
          localhost:3456 (代理)
                  |
      分类任务复杂度
      （启发式规则 + 快速 Haiku 调用）
                  |
         重写 model 字段:
         simple   -> claude-haiku-4-5
         default  -> claude-sonnet-4-6
         complex  -> claude-opus-4-8
                  |
         转发到 api.anthropic.com
                  |
         流式返回响应
```

## 安装

```bash
npm install -g @arthurzengg/open-claude-code-router
```

该包将 `@anthropic-ai/claude-code` 作为依赖捆绑，并用一个轻量包装器替换 `claude` 命令。卸载时，如果之前安装过原始的 `claude`，会自动恢复。

## 环境要求

- Node.js 18 或更高版本
- 环境变量 `ANTHROPIC_API_KEY` 中的 Anthropic API 密钥（与 Claude Code 相同）。纯订阅（OAuth）方式会被透传，但路由分类需要 API 密钥。

## 使用方法

像之前一样使用 `claude`：

```bash
claude "help me refactor this module"
```

首次运行时代理会在后台自动启动。每个请求都会被分类并路由到合适的模型，界面上没有任何差异。

### 路由器命令

```bash
claude --router-status   # 代理健康状态、路由规则、最近一次决策
claude --router-log      # 最近的路由决策记录
```

## 路由规则

| 复杂度  | 示例                                  | 模型                |
| ------- | ------------------------------------- | ------------------- |
| simple  | 读文件、grep、重命名、1-2 行小改动    | `claude-haiku-4-5`  |
| default | 多文件编辑、修 bug、写测试、解释代码  | `claude-sonnet-4-6` |
| complex | 架构设计、规划、深度推理              | `claude-opus-4-8`   |

分类优先使用快速启发式规则；模糊情况回退到一次极小的 Haiku API 调用（约 50 输入 token，成本可忽略）。已经指向 Haiku 模型的请求（Claude Code 内部后台调用）会原样透传。

## 配置与状态

运行时状态位于 `~/.claude-router/`：

| 文件         | 用途                                |
| ------------ | ----------------------------------- |
| `proxy.pid`  | 后台代理进程的 PID                  |
| `port`       | 代理绑定的端口（3456-3466 扫描）    |
| `router.log` | 路由决策历史                        |
| `meta.json`  | 用于干净卸载的安装状态元数据        |

## 卸载

```bash
npm uninstall -g @arthurzengg/open-claude-code-router
```

卸载会终止后台代理，并在之前存在的情况下重新安装原始的 `@anthropic-ai/claude-code`。

## 限制

- 上游仅支持 `api.anthropic.com`（不支持 Bedrock / Vertex）。
- 仅支持 POSIX 系统（macOS / Linux）；v1 不支持 Windows。
- 除非命中启发式快速路径，分类器会为每个路由请求增加一次小型 Haiku 调用。

## 许可证

MIT

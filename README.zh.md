<p align="center">
  <img src="docs/assets/readme-header.svg" width="100%" alt="dsh-openai-oauth — DeepSeek Harness 的 OpenAI OAuth 社区插件">
</p>

<h1 align="center">dsh-openai-oauth</h1>

<p align="center"><strong>DeepSeek Harness 的 OpenAI OAuth 插件</strong></p>

<p align="center"><a href="README.md">English</a> | 中文</p>

在 DeepSeek Harness 中直接登录 ChatGPT 并使用可用的 Codex 模型，不需要 OpenAI API Key，也不依赖 Codex CLI。插件保留 DSH 原有的会话、工具、权限和模型选择。

## 能做什么

- 支持浏览器 PKCE 登录和设备代码登录
- 提供 Web 设置页和 headless 登录命令
- 自动刷新登录凭据
- 在 DSH 原生模型选择器中使用 Codex 模型
- 在设置中编辑模型：新增自定义模型，或覆盖内置模型的上下文窗口和最大输出
- 凭据保存在本机 Harness 主目录

## 准备 DSH

- DeepSeek Harness `0.1.7-rc.2` 或 `0.2.0-rc.2`
- Node.js `^22.19.0` 或 `>=24.0.0`
- `pnpm` 已加入 `PATH`
- 当前具有 Codex 使用资格的 ChatGPT 账号

`0.1.0` 支持 macOS 和 Linux，暂不支持 Windows。

## 安装

### 使用 Agent 安装（推荐）

向 Agent 发送以下地址，并让它按照操作清单完成安装：

`https://raw.githubusercontent.com/AdonisSheldon/dsh-openai-oauth/main/AGENTS.md`

安装结束后，你只需决定是否重启 DSH，并亲自完成 ChatGPT 登录。

### DSH 命令安装

包发布后执行：

```sh
dsh plugin --profile web add dsh-openai-oauth@0.1.0
dsh --profile web --dump-config
```

### 从当前 checkout 安装

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add ./dsh-openai-oauth-0.1.0.tgz
dsh --profile web --dump-config
```

如果 DSH Web 已经运行，安装后手动重启一次。

## 登录与使用

1. 打开 DSH 的**设置 → OpenAI OAuth**。
2. 选择**浏览器登录**或**设备代码**。
3. 登录具有 Codex 使用资格的 ChatGPT 账号。
4. 打开 **Models**，选择一个 `openai-codex` 模型。
5. 可选：在同一设置分区里新增或覆盖模型，见[模型清单](#模型清单)。

浏览器登录会等待 `127.0.0.1:1455` 上的回调。端口不可用或浏览器位于另一台机器时，请使用设备代码。

在 headless profile 中使用：

```sh
dsh plugin --profile headless add ./dsh-openai-oauth-0.1.0.tgz
dsh plugin --profile headless exec dsh-openai-login
```

命令会询问登录方式。非交互终端需要明确传入 `--browser` 或 `--device-code`。

## 模型清单

**设置 → OpenAI OAuth → 模型**会列出 `openai-codex` 提供方的全部模型，以及你自己添加的条目。两者都在下一次请求时生效，不需要重启 DSH。

- **添加模型**用于目录里没有的模型：需要填写 id、可选的显示名、上下文窗口和最大输出。
- 对内置行点击**编辑**只会保存该模型的上下文窗口和最大输出，其余字段保持随插件发布；点击**重置**恢复默认值。
- 自定义模型沿用内置的基础推理档位（low、medium、high、xhigh），并接受文本和图片输入。
- 取值范围：id 为 1–64 个字符，只能是字母、数字、`.`、`_`、`:`、`-`，且必须以字母或数字开头；上下文窗口为 1024–10000000；最大输出不小于 1 且不大于上下文窗口；最多保存 64 个自定义模型。
- 模型的最大输出会以 `max_output_tokens` 发送给 OpenAI。
- 条目保存在 `$DSH_HOME/plugins/dsh-openai-oauth/models.json`（仅属主可读写，原子写入）。删除该文件即可恢复到插件自带的模型目录。

## 更新与卸载

```sh
dsh plugin --profile web update dsh-openai-oauth
dsh plugin --profile web remove dsh-openai-oauth
```

安装、更新或卸载插件后需要重启 DSH。登录、退出登录和 token 刷新不需要重启。

如果还要删除保存的凭据，请在卸载前前往**设置 → OpenAI OAuth**退出登录；否则卸载会保留凭据。

## 开发验证

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`check` 会检查类型、重新生成随仓库提交的构建产物，并运行无需真实凭据或网络请求的回归测试。测试覆盖 `role: "tool"` 工具结果、工具调用 ID、HTTP 错误分类、模型目录，以及模型覆盖层（校验、持久化和最大输出请求字段）。

开发依赖和 CI 验证目标均为 DSH `0.2.0-rc.2`，不再兼容 rc.8 的工具结果块或 `CallId` API。

## 说明

- 本插件把 ChatGPT 账号连接到 Codex 模型提供方，不会生成 OpenAI API Key。
- Web 集成只支持绑定到 `127.0.0.1` 的本地 DSH Host。
- 凭据以未加密文件保存在 `$DSH_HOME/plugins/dsh-openai-oauth/credentials.json`。
- 插件自带目录包含 `gpt-6-astra` 和 `gpt-6.1-sol`；实际可用模型和额度取决于已登录的账号，出现在列表中不代表账号一定有权限。
- OpenAI 可能独立修改 Codex OAuth 协议。
- 本项目为非官方社区项目，与 OpenAI、DeepSeek AI 无隶属或背书关系。

安全问题和部署说明见 [SECURITY.md](SECURITY.md)。

[MIT](LICENSE)

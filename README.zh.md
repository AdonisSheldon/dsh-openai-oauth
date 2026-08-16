# dsh-openai-oauth

[English](README.md) | 中文

这是一个非官方、可独立安装的 DeepSeek Harness 插件，通过 ChatGPT 账号 OAuth 连接 `openai-codex` 模型提供方。它保留 Harness 的 agent loop（智能体循环）、工具、提示词、会话回放和模型选择，不会启动 Codex App Server、运行 pi agent，也不会创建由提供方管理的第二段对话。

插件独立安装、配置和发布。它在内部把 `@earendil-works/pi-ai` 用作 OAuth 与模型传输库，但不会集成 pi agent 进程、配置、对话或凭据存储。

这种授权用于通过 ChatGPT 账号访问 Codex 模型提供方。它不是 OpenAI API OAuth，不会配置普通 `openai` 提供方，也不能提供该账号本身没有的模型或额度。

## 兼容性

`0.1.0` 版本面向以下精确版本：

- DeepSeek Harness `0.1.0-rc.6`
- Cordis `4.0.1`
- `@earendil-works/pi-ai` `0.82.1`
- Node.js `^22.19.0` 或 `>=24.0.0`

Web 集成仅支持绑定到 `127.0.0.1` 的本地 Harness Host。本版本不支持远程、反向代理、容器端口转发和 Electron 传输。Web profile 未运行时仍可使用直接登录命令。

## 独立安装契约

插件只使用兼容 DeepSeek Harness 发布版提供的公开运行时，不会修改、替换或要求改动 Harness 源码、agent loop 或已发布包。正常的 `dsh plugin add` 只会改变所选用户 profile 的状态，使 Harness 能解析这个包并应用其中的 `cordis.patch.yml` 组合层。

Cordis、pi-ai、React 和 DSH 运行时包由 Harness 按精确兼容版本提供。插件只安装自己拥有的文件锁依赖，随包提供已经审查的 `lib/`，也没有安装生命周期脚本。因此，无论安装 tarball 还是固定 commit 的 GitHub 版本，都不需要 Harness 源码 checkout，也不需要批准包管理器构建脚本。CI 会打包仓库、把 tarball 安装到 DSH `0.1.0-rc.6` 发布版的干净 Web 和 headless profile、启动 Web profile、查询 OAuth 状态路由、运行已安装的登录命令并卸载插件，以持续验证这项契约。

## 安装

需要在 Harness 设置页登录时，把已发布的包安装到 Web profile：

```sh
dsh plugin --profile web add dsh-openai-oauth@0.1.0
dsh --profile web --dump-config
dsh --profile web
```

只使用终端的 Harness 可以把同一个包安装到 headless profile，无需启动 Web server：

```sh
dsh plugin --profile headless add dsh-openai-oauth@0.1.0
dsh --profile headless --dump-config
pnpm --dir ~/.dsh/profiles/headless exec dsh-openai-login --device-code
```

npm 正式发布前，可以从可信 checkout 构建 tarball，再安装这个不可变产物：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add /absolute/path/dsh-openai-oauth-0.1.0.tgz
```

本仓库提交了 `lib/`，所以也能从 GitHub 安装；请固定经过审查的 commit，不要使用会移动的分支：

```sh
dsh plugin --profile web add github:YOUR_ACCOUNT/dsh-openai-oauth#COMMIT_SHA
```

安装会改变 profile 的组合。安装、更新或移除包后，已经运行的 Harness 进程需要重启一次。登录、退出登录、取消和刷新状态不需要重启。

## 在 Web UI 中登录

打开 **OpenAI OAuth** 设置区，在选择 **登录** 前选择一种方式：

- **浏览器登录（推荐）**会启动 PKCE 流程、打开 OpenAI 授权 URL，并等待 `127.0.0.1:1455` 上的一次性回调。这个回调不是机器绑定。端口 `1455` 被占用或浏览器运行在另一台机器时，请使用设备代码。
- **设备代码**会显示 OpenAI 验证 URL、一次性用户代码和过期时间，同时由本地 Host 轮询完成状态。token 不会经过浏览器 UI。

状态变成**已连接**后，内置的 Models 设置页可以发现已经注册的 `openai-codex` 模型；在那里按通常方式选择模型。可用模型取决于 OpenAI 账号。

## 在终端中登录

安装步骤通过 `--dump-config` 或首次启动 Web 完成所选 DSH profile 的初始化后，从该 profile 中运行已安装的命令；此时 Web 服务不需要继续运行。使用默认 Harness 主目录时，Web 和 headless 安装分别使用：

```sh
pnpm --dir ~/.dsh/profiles/web exec dsh-openai-login
pnpm --dir ~/.dsh/profiles/headless exec dsh-openai-login
```

交互式命令会要求选择浏览器或设备代码。脚本和非交互终端必须明确指定：

```sh
pnpm --dir ~/.dsh/profiles/web exec dsh-openai-login --browser
pnpm --dir ~/.dsh/profiles/web exec dsh-openai-login --device-code
```

自定义 `DSH_HOME` 时，请使用其中对应的 profile 目录，并保持该环境变量有效，使命令与 Harness 使用同一份凭据文件。

## 凭据和网络行为

凭据保存在 `$DSH_HOME/plugins/dsh-openai-oauth/credentials.json` 中（Harness 默认主目录是 `~/.dsh`）。插件在支持的 POSIX 文件系统上强制目录和文件仅限所有者访问，拒绝符号链接凭据目标，串行化跨进程更新，并原子替换带版本的文件。文件没有静态加密；请保护操作系统账号和 Harness 主目录。

插件内部的提供方库会向 OpenAI 发送 OAuth 凭据和模型请求。Web 路由只返回脱敏连接状态、模型 id、浏览器授权 URL 或设备代码说明；它拒绝非环回请求和跨源写操作，也不会启用 CORS。会话日志包含模型可见的对话数据和回放元数据，但不包含 OAuth 凭据。

报告漏洞或部署插件前，请阅读 [SECURITY.md](SECURITY.md)。

## 限制

- 浏览器登录需要当前提供方库固定的回调端口 `1455`；端口不可用时请选择设备代码。
- OpenAI 可以独立修改非官方 Codex OAuth 协议或账号策略。
- 插件会拒绝 `maxTokens` 和停止序列，因为当前 Codex 传输无法忠实地提供这些请求控制。
- 推理选项只列出当前模型传输支持的值；本版本不会展示传输层无法保证的 `off` 设置。

## 移除

如果需要删除凭据，请先在 **OpenAI OAuth** 设置中退出登录，然后移除组合包并重启正在运行的 Harness 进程：

```sh
dsh plugin --profile web remove dsh-openai-oauth
dsh plugin --profile headless remove dsh-openai-oauth
```

移除包会撤销适配器、路由和设置区，但会有意保留没有明确删除的插件凭据，避免卸载过程静默销毁账号状态。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

构建后的 `lib/` 文件会提交到仓库，因此固定 commit 的 GitHub 安装可以直接执行已审查的产物，不需要安装时构建脚本。

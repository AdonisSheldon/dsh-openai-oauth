# dsh-openai-oauth

[English](README.md) | 中文

在 DeepSeek Harness 中直接登录 ChatGPT 并使用可用的 Codex 模型，不需要 OpenAI API Key，也不依赖 Codex CLI。插件保留 DSH 原有的会话、工具、权限和模型选择。

## 能做什么

- 支持浏览器 PKCE 登录和设备代码登录
- 提供 Web 设置页和 headless 登录命令
- 自动刷新登录凭据
- 在 DSH 原生模型选择器中使用 Codex 模型
- 凭据保存在本机 Harness 主目录

## 准备 DSH

- DeepSeek Harness `0.1.0-rc.6`
- Node.js `^22.19.0` 或 `>=24.0.0`
- `pnpm` 已加入 `PATH`
- 当前具有 Codex 使用资格的 ChatGPT 账号

`0.1.0` 支持 macOS 和 Linux，暂不支持 Windows。

## 安装

### 从当前 checkout 安装

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add ./dsh-openai-oauth-0.1.0.tgz
dsh --profile web --dump-config
```

### 从 npm 安装

包发布后执行：

```sh
dsh plugin --profile web add dsh-openai-oauth@0.1.0
dsh --profile web --dump-config
```

### 让编码 Agent 安装

把下面这段指令复制给能够操作本机终端的 Agent。示例默认使用全局安装的 `dsh`；如果 Agent 位于 DeepSeek Harness 源码 checkout 中，应统一改用 `pnpm dsh`。

```text
请把 dsh-openai-oauth 作为外部插件安装到 DeepSeek Harness 的 web profile。

要求：
1. 不要修改或提交 DeepSeek Harness 源码目录中的任何文件，不要把插件源码复制进该仓库，也不要手动修改 cordis.yml 或 profile 的包管理文件。
2. 先检查 `node --version`、`pnpm --version` 和可用的 DSH 启动命令。本插件要求 Node.js ^22.19.0 或 >=24.0.0，以及 DeepSeek Harness 0.1.0-rc.6。如果 Harness 版本不一致，停止安装并报告版本差异，不要通过修改 Harness 代码来兼容。
3. 已全局安装 DSH 时使用 `dsh`；只有 Harness 源码 checkout 时，所有 DSH 命令统一使用 `pnpm dsh`。
4. 执行 `<dsh启动命令> plugin --profile web add github:AdonisSheldon/dsh-openai-oauth`。如果我指定了 tag 或 commit，在 GitHub spec 后追加 `#<tag或commit>`。不要批准无关的安装脚本，也不要扩大文件系统权限。
5. 执行 `<dsh启动命令> web --dump-config`，确认输出包含 `dsh-openai-oauth`。
6. 如果 DSH Web 已在运行，不要在 3080 端口上再启动一个进程。只重启由你启动或能够确认归属的 DSH 进程；否则告诉我需要手动重启一次。
7. 不要代替我登录 ChatGPT，也不要输出任何凭据。安装完成后，告诉我打开“设置 -> OpenAI OAuth”，选择“浏览器登录”或“设备代码”，由我亲自完成登录。
8. 如果安装或验证失败，返回完整命令和原始错误。不要通过修改 DeepSeek Harness 源码来绕过错误。

最后报告安装到的 profile、包来源、验证结果，以及是否仍需重启。
```

如果 DSH Web 已经运行，安装后手动重启一次。

## 登录与使用

1. 打开 DSH 的**设置 → OpenAI OAuth**。
2. 选择**浏览器登录**或**设备代码**。
3. 登录具有 Codex 使用资格的 ChatGPT 账号。
4. 打开 **Models**，选择一个 `openai-codex` 模型。

浏览器登录会等待 `127.0.0.1:1455` 上的回调。端口不可用或浏览器位于另一台机器时，请使用设备代码。

在 headless profile 中使用：

```sh
dsh plugin --profile headless add ./dsh-openai-oauth-0.1.0.tgz
dsh plugin --profile headless exec dsh-openai-login
```

命令会询问登录方式。非交互终端需要明确传入 `--browser` 或 `--device-code`。

## 更新与卸载

```sh
dsh plugin --profile web update dsh-openai-oauth
dsh plugin --profile web remove dsh-openai-oauth
```

安装、更新或卸载插件后需要重启 DSH。登录、退出登录和 token 刷新不需要重启。

如果还要删除保存的凭据，请在卸载前前往**设置 → OpenAI OAuth**退出登录；否则卸载会保留凭据。

## 说明

- 本插件把 ChatGPT 账号连接到 Codex 模型提供方，不会生成 OpenAI API Key。
- Web 集成只支持绑定到 `127.0.0.1` 的本地 DSH Host。
- 凭据以未加密文件保存在 `$DSH_HOME/plugins/dsh-openai-oauth/credentials.json`。
- 可用模型和额度取决于已登录的账号。
- OpenAI 可能独立修改 Codex OAuth 协议。
- 本项目为非官方社区项目，与 OpenAI、DeepSeek AI 无隶属或背书关系。

安全问题和部署说明见 [SECURITY.md](SECURITY.md)。

[MIT](LICENSE)

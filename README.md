# @YueZeyi/dsh-glm-quota

在 Harness Web UI 里直接查看**智谱 GLM Coding Plan** 的**剩余**额度：当**当前模型是 GLM 时**，
输入框下方出现一枚徽标，只有两个剩余百分比 —— 先是 5 小时窗口，再是周窗口：

```
GLM LITE   90% · 98%
```

鼠标悬停提示会说明这两个数字分别是什么。悬浮层里保留完整信息（窗口名、剩余量、进度条、
重置时间），并且**详情直接铺开、无需再点一次折叠**：

```
GLM 用量 · LITE                          刷新
5 小时积分                              90%
剩余 1800 / 2000
[=================bar==================]
22:19 重置 · 1 小时后
周积分                                  98%
剩余 9800 / 10000
[====================bar===============]
21:19 重置 · 1 天后
──────────────────────────────────────────
更新于 21:19
```

浮层里的进度条按**剩余**画：满格 = 额度充足，越用越短；百分比颜色档位由**已用**决定，
所以剩余不多时会变黄/变红。剩余数量取接口自己返回的 `remaining` 字段
（与官方控制台一致），缺失时才退回 `total - used`。

模型不是 GLM 时徽标完全隐藏，也不会去请求额度接口。

## 它是怎么工作的

| 半边 | 文件 | 做什么 |
| --- | --- | --- |
| Host | `index.js` | 读 API Key，请求 `https://bigmodel.cn/api/monitor/usage/quota/limit`，整理成快照并做 60 秒缓存；通过 Typert Remote 端点 `glmQuota/current` 暴露给浏览器。快照里一并下发「哪些模型算 GLM」。 |
| Client | `client.js` | `ctx.remote.$mount()` 挂载端点；从 `ctx.modelDirectories` 读当前会话的模型选择（与输入框上的模型座同一份数据），只在该模型属于智谱时渲染。 |

Host 半边只依赖 Node 内置模块（`node:fs` / `node:os` / `node:path`），不需要任何 npm 依赖；
Client 半边用 Harness 的模块表取 React，不打包任何 Harness Client 包。

## 可见性判定

只显示，当**当前模型**满足：

1. `provider` 命中 `config.providers`（默认 `['zai-coding-cn']`，键就是 `llm-pi-ai` 的
   provider id），或
2. 模型 id 含 `config.models` 里的子串（默认 `['glm']`，provider 别名写错时的兜底）。

模型选择还没加载出来时按「乐观可见」处理 —— 否则会出现「要显示才去拉数据、要拉到数据
才显示」的死锁。模型一确定就会收掉，所以最坏情况是短暂闪一下。

如果这个 profile 里没有模型选择插件（`ctx.modelDirectories` 不存在），slot 注册会被跳过，
徽标不显示。

## API Key 来源

按顺序取第一个命中的：

1. 行配置 `apiKey`（明文，不推荐）
2. `apiKeyEnv` 指定的环境变量，默认 `ZHIPU_API_KEY`
3. `configPath` 指向的 TOML（默认 `~/.kimi-code/config.toml`）里 `base_url` 含 `bigmodel.cn`
   的 provider 的 `api_key`
4. 环境变量 `ZAI_CODING_CN_API_KEY`

> ⚠️ 第 3 条默认去读 **Kimi Code** 的配置文件。它只是兜底，但如果你不想让插件碰那个文件，
> 在配置里把 `configPath` 指向别处，或者设上 `ZHIPU_API_KEY`（第 2 条会先生效）。

## 配置

在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里按行 id `glm-quota` 覆盖，改完重启生效：

```yaml
- id: glm-quota
  name: '@YueZeyi/dsh-glm-quota'
  config:
    apiKeyEnv: ZHIPU_API_KEY   # 换个环境变量名
    cacheTtlMs: 60000          # Host 侧缓存时长
    timeoutMs: 15000           # 单次请求超时
    providers:                 # 只有这些 provider 才显示（键 = llm-pi-ai 的 provider id）
      - zai-coding-cn
    models:                    # provider 对不上时的模型 id 兜底
      - glm
```

## 安装

**从 Git（推荐）** —— Plugins 面板 → 添加插件，填入仓库地址：

```
https://github.com/YueZeyi/dsh-glm-quota
```

或者命令行：

```powershell
dsh plugin --profile <profile> add github:YueZeyi/dsh-glm-quota
```

**从本地目录**（开发时用）：

```powershell
dsh plugin --profile <profile> add "C:\path\to\dsh-glm-quota"
```

> `desktop` profile 只能通过桌面端自己的 Plugins 面板管理，命令行会被拒绝。
> 本地目录安装时 pnpm 建的是 `link:` 软链，改源码即生效，不用重装；
> Host 半边改动需要重启应用，Client 半边（`client.js`）需要重启或重挂插件才会重新加载。

## 更新与卸载

Harness **不支持插件自动更新**：升级要先卸载再装新版。

```powershell
dsh plugin --profile <profile> remove @YueZeyi/dsh-glm-quota
dsh plugin --profile <profile> add github:YueZeyi/dsh-glm-quota#v1.1.0
```

从 Git 安装时，用 tag 或 commit 固定版本更稳（例如 `#v1.0.0`）。

## 兼容性

- 验证过的 Harness 版本：**0.2.0-rc.2**（Desktop）。
- 本插件**不依赖任何 `@deepseek-ai/*` 包**，因此不会触发 profile 的插件版本门禁；
  代价是它复刻了几个内部契约：Typert 的 `typertRemote` 绑定、手搭的 Remote descriptor、
  slot 名 `conversation.composer.dock`。如果 Harness 升级改了这些，插件会以
  **明确的报错**失效（不会静默出错）。
- 数据只发往 `https://bigmodel.cn`，没有其他网络请求；API Key 只用于这个请求的 Authorization 头。


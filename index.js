/**
 * glm-quota — Harness Host 半边。
 *
 * 职责：读取智谱（bigmodel.cn）Coding Plan 的额度接口，把结果整理成一份
 * 稳定快照，并通过 Typert Remote 端点 `glmQuota/current` 交给浏览器半边。
 *
 * API Key 解析顺序（第一个命中的生效）：
 *   1. 行配置 config.apiKey（明文，不推荐）
 *   2. config.apiKeyEnv 指定的环境变量（默认 ZHIPU_API_KEY）
 *   3. config.configPath（默认 ~/.kimi-code/config.toml）中 base_url 含
 *      bigmodel.cn 的 provider 的 api_key
 *   4. 环境变量 ZAI_CODING_CN_API_KEY
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const QUOTA_URL = 'https://bigmodel.cn/api/monitor/usage/quota/limit'
const DEFAULT_CONFIG_PATH = () => join(homedir(), '.kimi-code', 'config.toml')

/**
 * 只有当前模型属于这些 provider 时才显示徽标。
 * 键就是 profile 里 llm-pi-ai 的 provider id（bundle 默认写 zai-coding-cn）。
 */
const DEFAULT_PROVIDERS = ['zai-coding-cn']
/** 兜底：provider 对不上时，模型 id 命中这些子串也算。 */
const DEFAULT_MODEL_PATTERNS = ['glm']

/** 该包作为 Typert 贡献者的身份；namespace/service/method 都必须是 RPC 段名。 */
export const PACKAGE = '@YueZeyi/dsh-glm-quota'
const SCHEMA_NAME = 'GlmQuotaSnapshot'
/** 结果 codec 的 typeSymbol，格式 `<package>#<schema name>`；Client 侧必须逐字相同。 */
const TYPE_SYMBOL = `${PACKAGE}#${SCHEMA_NAME}` // => '@YueZeyi/dsh-glm-quota#GlmQuotaSnapshot'
const SERVICE_KEY = 'glmQuota'

let schemaCache
/** 结果形状的运行时校验 schema（只用到 parse，故不依赖任何 schema 库）。 */
function snapshotSchema() {
  return (schemaCache ??= buildSchema())
}

function buildSchema() {
  // 一层浅校验：列出必填键，可选键单独指定校验函数，未列出的键直接拒绝。
  const record = (shape, optional = {}) => ({
    parse(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`glm-quota: expected an object, received ${JSON.stringify(value)}`)
      }
      for (const key of Object.keys(value)) {
        if (!(key in shape) && !(key in optional)) {
          throw new TypeError(`glm-quota: unexpected field "${key}"`)
        }
      }
      for (const [key, check] of Object.entries(shape)) {
        const field = value[key]
        if (check === 'string') {
          if (typeof field !== 'string') throw new TypeError(`glm-quota: ${key} must be a string`)
          continue
        }
        if (check === 'number') {
          if (typeof field !== 'number' || !Number.isFinite(field)) {
            throw new TypeError(`glm-quota: ${key} must be a finite number`)
          }
          continue
        }
        check(field, key)
      }
      for (const [key, check] of Object.entries(optional)) {
        if (value[key] !== undefined) check(value[key], key)
      }
      return value
    },
  })
  const window = () =>
    record({
      used: 'number',
      total: 'number',
      remaining: 'number',
      percent: 'number',
      resetAt: (value, key) => {
        if (value !== null && typeof value !== 'number') {
          throw new TypeError(`glm-quota: ${key} must be a number or null`)
        }
      },
    })
  const windowOrNull = (value, key) => {
    if (value !== null) window().parse(value)
  }
  const stringList = (value, key) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new TypeError(`glm-quota: ${key} must be a string array`)
    }
  }
  const data = record({
    plan: 'string',
    fetchedAt: 'number',
    expiresAt: 'number',
    fiveHour: (value, key) => windowOrNull(value, key),
    weekly: (value, key) => windowOrNull(value, key),
    // 浏览器半边据此决定「当前模型是不是 GLM」——配置只从 Host 走，Client 不重复一份。
    providers: (value, key) => stringList(value, key),
    models: (value, key) => stringList(value, key),
  })
  const dataOrNull = (value, key) => {
    if (value !== null) data.parse(value)
  }
  return {
    parse(value) {
      if (value === null || typeof value !== 'object') {
        throw new TypeError('glm-quota: result must be an object')
      }
      if (value.ok === true) {
        dataOrNull(value.data, 'data')
        return value
      }
      if (value.ok === false) {
        if (typeof value.code !== 'string') throw new TypeError('glm-quota: code must be a string')
        if (typeof value.message !== 'string') {
          throw new TypeError('glm-quota: message must be a string')
        }
        return value
      }
      throw new TypeError('glm-quota: result.ok must be a boolean')
    },
  }
}

/** Typert 贡献：端点 + 结果 schema，注册进 ctx.typert 后 Host 才能派发该端点。 */
export const typertContribution = Object.freeze({
  package: PACKAGE,
  face: 'host',
  schemas: [{ name: SCHEMA_NAME, create: snapshotSchema }],
  invocations: [
    {
      id: `${PACKAGE}#${SERVICE_KEY}/current`,
      service: SERVICE_KEY,
      namespace: SERVICE_KEY,
      method: 'current',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: TYPE_SYMBOL, create: snapshotSchema },
    },
  ],
  model: { services: [], events: [], objects: [] },
})

/** 从 config.toml 文本里挑出 base_url 指向 bigmodel.cn 的 provider 的 api_key。 */
export function apiKeyFromToml(text) {
  for (const section of String(text).split(/^\[/m).slice(1)) {
    if (!/bigmodel\.cn/.test(section)) continue
    const key = section.match(/api_key\s*=\s*"([^"]*)"/)?.[1]
    if (key && key.trim()) return key.trim()
  }
  return null
}

function resolveApiKey(config) {
  const direct = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  if (direct) return direct
  const envName = typeof config.apiKeyEnv === 'string' && config.apiKeyEnv ? config.apiKeyEnv : 'ZHIPU_API_KEY'
  const fromEnv = process.env[envName]?.trim()
  if (fromEnv) return fromEnv
  const configPath =
    typeof config.configPath === 'string' && config.configPath ? config.configPath : DEFAULT_CONFIG_PATH()
  try {
    const fromFile = apiKeyFromToml(readFileSync(configPath, 'utf8'))
    if (fromFile) return fromFile
  } catch {
    /* 文件不存在或不可读时继续走下一个来源 */
  }
  const fallback = process.env.ZAI_CODING_CN_API_KEY?.trim()
  if (fallback) return fallback
  return null
}

/** unit/number → 窗口归类。5 小时窗口的 number 是 5，周窗口的 number 是 1。 */
function windowOf(limit) {
  if (limit?.number === 5) return 'fiveHour'
  if (limit?.number === 1) return 'weekly'
  return null
}

function toWindow(limit) {
  const total = Number(limit?.usage ?? 0)
  const used = Number(limit?.currentValue ?? 0)
  // percent 是「已用百分比」，用来决定颜色档位（剩余越少越警戒）。
  const percent = total > 0 ? Math.round((used / total) * 100) : Number(limit?.percentage ?? 0)
  const resetAt = Number(limit?.nextResetTime ?? 0)
  // 剩余取接口自己的字段（官方控制台也显示它，可能因为取整/在途请求与
  // total-used 差 1）；缺失时退回计算值。
  const reported = Number(limit?.remaining)
  const remaining = Number.isFinite(reported) ? reported : Math.max(total - used, 0)
  return { used, total, remaining, percent, resetAt: Number.isFinite(resetAt) && resetAt > 0 ? resetAt : null }
}

function planLabel(level) {
  return typeof level === 'string' && level ? level.toUpperCase() : 'UNKNOWN'
}

/** 配置里的字符串数组；缺省或非法时退回默认值（配置错误不该让插件整个挂掉）。 */
function stringListOrDefault(value, fallback) {
  const items = (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : [...fallback]
}

/**
 * Host 侧额度服务：持有一次短 TTL 缓存，并让并发读共享同一个在途请求。
 *
 * 它是普通 Cordis 服务（不是 TypertRemoteService），因此不需要额外依赖包；
 * typertRemote 绑定与端点派发见构造函数和 typertContribution。
 */
class GlmQuotaService {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = config
    this.cacheTtlMs = Number.isFinite(config.cacheTtlMs) ? Number(config.cacheTtlMs) : 60_000
    this.timeoutMs = Number.isFinite(config.timeoutMs) ? Number(config.timeoutMs) : 15_000
    this.providers = stringListOrDefault(config.providers, DEFAULT_PROVIDERS)
    this.models = stringListOrDefault(config.models, DEFAULT_MODEL_PATTERNS)
    this.pending = null
    this.cached = null

    // 网关派发前会做 validateBinding/readBinding 校验（见 dsh-api-gateway）：
    //   isObject(binding)
    //   binding.service   === originalOf(receiver)   ← 原始实例本身
    //   binding.serviceKey === descriptor.service
    //   binding.namespace  === descriptor.namespace
    // 官方做法是继承 TypertRemoteService 或调用 bindTypertRemote()，两者都要
    // 从插件里 import @deepseek-ai/dsh-typert-protocol。但 profile 插件是按软链
    // 真实路径解析裸包名的（…\Desktop\1\glm-quota-plugin 往上没有 @deepseek-ai），
    // 那个 import 有解析失败的风险，所以这里手写字段完全一致的冻结对象。
    this.typertRemote = Object.freeze({
      service: this,
      serviceKey: SERVICE_KEY,
      namespace: SERVICE_KEY,
    })
  }

  invalidate() {
    this.cached = null
  }

  /**
   * 当前额度快照。
   * @returns 成功时 { ok: true, data }，失败时 { ok: false, code, message }；不抛异常。
   */
  async current() {
    if (this.cached !== null && this.cached.data.expiresAt > Date.now()) {
      return { ok: true, data: this.cached.data }
    }
    if (this.pending === null) {
      this.pending = this.load().finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }

  async load() {
    const apiKey = resolveApiKey(this.config)
    if (apiKey === null) {
      return {
        ok: false,
        code: 'NO_API_KEY',
        message:
          '未找到智谱 API Key。请在插件配置里填 apiKey，或设置 ZHIPU_API_KEY，' +
          '或在 ~/.kimi-code/config.toml 中配置一个 base_url 含 bigmodel.cn 的 provider。',
      }
    }
    const signal = AbortSignal.timeout(this.timeoutMs)
    let payload
    try {
      const response = await fetch(QUOTA_URL, {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal,
      })
      if (!response.ok) {
        return {
          ok: false,
          code: `HTTP_${response.status}`,
          message: `额度接口返回 HTTP ${response.status}`,
        }
      }
      payload = await response.json()
    } catch (error) {
      const timedOut = signal.aborted
      return {
        ok: false,
        code: timedOut ? 'TIMEOUT' : 'NETWORK',
        message: timedOut
          ? `额度接口在 ${this.timeoutMs}ms 内没有响应`
          : `请求额度接口失败：${error?.message ?? String(error)}`,
      }
    }
    if (payload?.success !== true) {
      return {
        ok: false,
        code: String(payload?.code ?? 'API_ERROR'),
        message: String(payload?.msg ?? '额度接口返回了失败状态'),
      }
    }
    const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : []
    const snapshot = {
      plan: planLabel(payload?.data?.level),
      fetchedAt: Date.now(),
      expiresAt: Date.now() + this.cacheTtlMs,
      fiveHour: null,
      weekly: null,
      // 把「哪些模型算 GLM」下发给浏览器半边，配置只在 Host 维护一份。
      providers: this.providers,
      models: this.models,
    }
    for (const limit of limits) {
      const kind = windowOf(limit)
      if (kind !== null) snapshot[kind] = toWindow(limit)
    }
    this.cached = { data: snapshot }
    return { ok: true, data: snapshot }
  }
}

/**
 * 声明依赖：typert 注册表。
 *
 * 必须声明 —— Cordis 的属性访问有注入守卫，没声明就读 `ctx.typert` 会抛
 * "cannot get property typert without inject"，整个 Host 半边激活失败，
 * 于是端点根本没注册、Client 拿到的只会是一个 RPC 失败。
 * 声明之后还顺带保证了注册表先就位。
 */
export const inject = ['typert']

/**
 * Host 插件入口。
 * @param ctx - Host Cordis 上下文。
 * @param config - 行配置（apiKey/apiKeyEnv/configPath/cacheTtlMs/timeoutMs）。
 */
export function apply(ctx, config = {}) {
  const service = new GlmQuotaService(ctx, config)
  // 1) 把服务挂到 Cordis 的 glmQuota 键上，端点派发时按 descriptor.service 取。
  //    ctx.provide() 自身就是一个 effect，随本插件 fiber 卸载。
  ctx.provide(SERVICE_KEY, service)
  // 2) 注册 Typert 贡献，让 glmQuota/current 成为 Host 的严格定义端点。
  ctx.effect(() => ctx.typert.register(typertContribution), 'glm-quota: typert')
}

window.__ModuleLoader__.load({
  id: '@YueZeyi/dsh-glm-quota',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'glmQuota'
    const LOCAL_ID = '@YueZeyi/dsh-glm-quota'
    const REFRESH_MS = 120000
    const STYLE_ID = 'dsh-glm-quota-style/theme.css'
    const STYLE_PLUGIN = '@YueZeyi/dsh-glm-quota'

    // apply() 里填好；组件只读这些闭包变量。
    // 注意：remote 必须在每次调用时从 ctx 现取，不能在 apply 时缓存引用——
    // 那一次渲染可能早于命名空间 $mount 完成（会拿到 undefined）。
    let appCtx = null
    let mountPromise = null
    let t = (key) => key

    /** 轮询间隔内复用的最近一次成功快照（模型切换时用来判断可见性，不必等下一次请求）。 */
    let lastData = null
    /** 当前会话的模型选择 store；渲染期惰性解析，见 resolveModelStore。 */
    let modelStore = null
    let modelStoreBound = false

    /**
     * 惰性解析当前会话的模型选择 store。
     * 刻意不用 ctx.inject(['modelDirectories']) 把整个 slot 注册挂在它后面：
     * 那个服务在 client 树里的时序不由我们掌握，一旦没到就整条 slot 都不注册（静默消失）。
     * 这里退一步——拿不到就退回「无条件显示」，至少不会整个插件不出现。
     */
    function resolveModelStore(sessionId) {
      if (modelStoreBound) return modelStore
      modelStoreBound = true
      // sessionId 不是字符串就绝不调 directoryFor：用 undefined 去查可能拿到
      // 一个「别的会话」的目录（其当前模型可能是 DeepSeek），徽标就永远不显示了。
      // 这种情况按「模型未知」处理 → 无条件显示。
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      try {
        const directories = appCtx?.get?.('modelDirectories')
        if (directories === void 0) return null
        modelStore = directories.directoryFor(sessionId).store
      } catch (error) {
        modelStore = null
      }
      return modelStore
    }

    /**
     * 取当前模型选择。
     * 注意 directory.getSnapshot() 返回的对象引用永远不变（内部用 produce 原地改），
     * 所以这里自己保存副本 + 版本号，保证 useSyncExternalStore 能感知变化。
     */
    let modelVersion = 0
    let lastStore = null
    let lastSelection = { provider: void 0, model: void 0 }

    function readSelection() {
      const store = modelStore
      if (store == null) return { provider: void 0, model: void 0 }
      // store 换过（换会话）就重置版本，让 useSyncExternalStore 重新取值。
      if (store !== lastStore) {
        lastStore = store
        modelVersion += 1
      }
      const current = store.getSnapshot()?.current
      return { provider: current?.provider, model: current?.model }
    }

    /** 稳定引用的 subscribe：React 依赖它判等，所以不能每次渲染新建。 */
    function subscribeSelection(onChange) {
      const store = modelStore
      if (store == null) return () => {}
      return store.subscribe(() => {
        lastSelection = readSelection()
        modelVersion += 1
        onChange()
      })
    }

    /** 稳定引用的 getSnapshot：必须缓存返回对象 —— React 要求 store 未变时
     *  两次 getSnapshot 的结果 Object.is 相等，否则判定为无限循环并崩掉整个条目。 */
    let cachedSelection = { version: -1, provider: void 0, model: void 0 }
    function getSelectionSnapshot() {
      lastSelection = readSelection()
      if (
        cachedSelection.version !== modelVersion
        || cachedSelection.provider !== lastSelection.provider
        || cachedSelection.model !== lastSelection.model
      ) {
        cachedSelection = { version: modelVersion, provider: lastSelection.provider, model: lastSelection.model }
      }
      return cachedSelection
    }

    /**
     * 门控名单的内置兜底，与 Host 侧 index.js 的 DEFAULT_PROVIDERS / DEFAULT_MODEL_PATTERNS 一致。
     * 必须内置：额度请求只在「已判定可见」时才发，而 providers/models 又要从首次
     * 响应里带回来 —— 不兜底就是「要显示才去拉、要拉到名单才显示」的死锁，
     * 切到 GLM 也永远 visible=false（实际踩过的坑）。配置改过名单后，首次成功
     * 响应会覆盖这里的默认值。
     */
    const DEFAULT_PROVIDERS = ['zai-coding-cn']
    const DEFAULT_MODELS = ['glm']

    /** 当前模型是否算「智谱 GLM」。 */
    function isGlmSelected() {
      const providers = lastData?.providers?.length ? lastData.providers : DEFAULT_PROVIDERS
      const patterns = lastData?.models?.length ? lastData.models : DEFAULT_MODELS
      const selection = lastSelection
      // provider 还没解析出来：按未知处理，先乐观显示；一确定就会收敛。
      if (typeof selection.provider !== 'string') return true
      if (providers.includes(selection.provider)) return true
      // provider 已知且不匹配；模型 id 兜底（provider 别名写错时的安全网）。
      const modelId = typeof selection.model === 'string' ? selection.model.toLowerCase() : ''
      return modelId.length > 0 && patterns.some((pattern) => modelId.includes(String(pattern).toLowerCase()))
    }

    const CSS = `
.dsh-glm-quota-anchor { position: relative; display: inline-flex; }
.dsh-glm-quota {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  user-select: none;
}
.dsh-glm-quota:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-glm-quota:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-glm-quota[data-open='true'] {
  background: var(--dsw-alias-button-ghost-active-fill);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border);
  color: var(--dsw-alias-label-primary);
}
.dsh-glm-quota-plan {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}
.dsh-glm-quota-value { font-variant-numeric: tabular-nums; }
.dsh-glm-quota-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-state-business-primary);
}
.dsh-glm-quota-fill[data-level='warn'] { background: var(--dsw-alias-state-warn-primary); }
.dsh-glm-quota-fill[data-level='error'] { background: var(--dsw-alias-state-error-primary); }
.dsh-glm-quota-card {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 30;
  width: 264px;
  max-width: 80vw;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 8px 24px var(--dsw-alias-bg-mask-1);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  text-align: left;
}
.dsh-glm-quota-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 18px;
}
.dsh-glm-quota-refresh {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--dsw-alias-link);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.dsh-glm-quota-refresh:hover { text-decoration: underline; }
.dsh-glm-quota-rows { display: grid; gap: 12px; }
.dsh-glm-quota-row { display: grid; gap: 3px; }
.dsh-glm-quota-row-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.dsh-glm-quota-row-label { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-glm-quota-row-percent {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.dsh-glm-quota-row-percent[data-level='warn'] { color: var(--dsw-alias-state-warn-primary); }
.dsh-glm-quota-row-percent[data-level='error'] { color: var(--dsw-alias-state-error-primary); }
.dsh-glm-quota-row-sub {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
.dsh-glm-quota-row-track {
  display: block;
  height: 6px;
  margin: 1px 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3);
  overflow: hidden;
}
.dsh-glm-quota-row-reset { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.dsh-glm-quota-foot {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}
.dsh-glm-quota-hint {
  margin: 8px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}
.dsh-glm-quota-error { color: var(--dsw-alias-label-error); }
`

    function installStyles() {
      if (typeof document === 'undefined') return
      // 与 Harness 自带的样式注入同一套约定：带 data-plugin 标记，插件卸载时可被回收。
      const selector = `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`
      if (document.querySelector(selector) !== null) return
      const tag = document.createElement('style')
      tag.dataset.pluginCss = STYLE_ID
      tag.dataset.plugin = STYLE_PLUGIN
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function levelOf(percent) {
      if (percent >= 90) return 'error'
      if (percent >= 70) return 'warn'
      return 'ok'
    }

    function clamp(percent) {
      return Math.min(Math.max(Number(percent) || 0, 0), 100)
    }

    function clockOf(epochMs) {
      if (!epochMs) return '—'
      return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    /** 距离重置还有多久，例如「1 天后」；已到点返回「即将重置」。 */
    function durationUntil(epochMs) {
      if (!epochMs) return ''
      const minutes = Math.round((epochMs - Date.now()) / 60000)
      if (minutes <= 0) return t('resetReady')
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      const rest = minutes % 60
      const parts = []
      if (days > 0) parts.push(t('durationDays', { n: days }))
      if (hours > 0) parts.push(t('durationHours', { n: hours }))
      if (rest > 0 || parts.length === 0) parts.push(t('durationMinutes', { n: rest }))
      return t('inDuration', { duration: parts.join('') })
    }

    /** 重置行：「22:14 重置 · 1 天后」。没有重置时间就不渲染这一行。 */
    function resetLine(window) {
      if (!window?.resetAt) return null
      const when = durationUntil(window.resetAt)
      return `${t('resetsAt', { time: clockOf(window.resetAt) })}${when ? ` · ${when}` : ''}`
    }

    /** 剩余数量：优先用 Host 透传的接口原值，缺失时退回 total-used。 */
    function remainingOf(window) {
      if (!window) return 0
      if (typeof window.remaining === 'number' && Number.isFinite(window.remaining)) return window.remaining
      return Math.max(Number(window.total ?? 0) - Number(window.used ?? 0), 0)
    }

    /** 剩余百分比（进度条按它画：满格 = 额度充足，越用越短）。 */
    function remainingPercentOf(window) {
      const total = Number(window?.total ?? 0)
      if (!(total > 0)) return 0
      return Math.round((remainingOf(window) / total) * 100)
    }

    function Fill(props) {
      return h('span', {
        className: 'dsh-glm-quota-fill',
        // 颜色档位由「已用」决定：剩余越少越警戒，与进度条长度方向相反是有意的。
        'data-level': props.level ?? levelOf(100 - clamp(props.percent)),
        style: { width: `${clamp(props.percent)}%` },
      })
    }

    /** 一个额度窗口：标题行（名称 + 剩余%）+ 剩余/总量 + 进度条 + 重置行。 */
    function QuotaWindow(props) {
      const window = props.window
      const level = levelOf(window.percent)
      const reset = resetLine(window)
      return h(
        'div',
        { className: 'dsh-glm-quota-row' },
        h(
          'div',
          { className: 'dsh-glm-quota-row-head' },
          h('span', { className: 'dsh-glm-quota-row-label' }, props.label),
          h(
            'span',
            { className: 'dsh-glm-quota-row-percent', 'data-level': level },
            `${props.remainingPercent}%`,
          ),
        ),
        h(
          'div',
          { className: 'dsh-glm-quota-row-sub' },
          `${t('remaining')} ${remainingOf(window)} / ${window.total}`,
        ),
        h(
          'div',
          { className: 'dsh-glm-quota-row-track' },
          h(Fill, { percent: props.remainingPercent, level }),
        ),
        reset === null ? null : h('div', { className: 'dsh-glm-quota-row-reset' }, reset),
      )
    }

    function QuotaChip(slotProps) {
      const [state, setState] = React.useState({ status: 'loading' })
      const [open, setOpen] = React.useState(false)

      // 渲染期把 store 解析出来（只做一次），这样下面的 subscribe 能同步拿到它。
      resolveModelStore(slotProps?.sessionId)

      // 跟着模型选择的 store 重渲染；只有当前模型是 GLM 时才轮询与显示。
      React.useSyncExternalStore(
        subscribeSelection,
        getSelectionSnapshot,
        getSelectionSnapshot,
      )
      const visible = isGlmSelected()
      // 每次判定变化都打一条日志：切换模型后看 console 就知道读到了什么。
      diag(
        `model=${String(lastSelection.provider)}/${String(lastSelection.model)} ` +
        `store=${modelStore === null ? 'none' : 'bound'} visible=${visible}`,
      )

      const read = React.useCallback(async () => {
        try {
          // 等 $mount 完成再取方法；这里每次现取，不用 apply 时的缓存引用。
          if (mountPromise !== null) await mountPromise
          // 必须用 ctx.get() 而不是属性访问 ctx.remote.glmQuota：
          // 命名空间服务是 $mount 之后动态创建的，属性访问会触发 Cordis 的
          // inject 声明检查（"cannot get property ... without inject"），
          // ctx.get() 是不经过该检查的正规读法（Gateway 自己探测命名空间也用它）。
          const namespace = appCtx?.get?.('remote.glmQuota')
          if (namespace === void 0 || namespace === null || typeof namespace.current !== 'function') {
            setState({ status: 'error', code: 'NO_REMOTE', message: t('remoteUnavailable') })
            return
          }
          // 真实的 Remote 调用返回两层信封：
          //   ctx.remote.<ns>.<method>() -> { ok: true, value } | { ok: false, error }
          // Host 方法的业务返回放在 value 里，是 { ok: true, data } 或
          // { ok: false, code, message }。两层都必须拆，否则只会看到
          // "UNKNOWN: 未知错误"（value 里本来就没有 code/message）。
          const envelope = await namespace.current()
          if (envelope === null || typeof envelope !== 'object') {
            setState({ status: 'error', code: 'NO_RESULT', message: t('unknownError') })
            return
          }
          if (envelope.ok !== true) {
            const failure = envelope.error ?? {}
            setState({
              status: 'error',
              code: failure.code ?? 'REMOTE',
              message: failure.message ?? t('unknownError'),
            })
            return
          }
          const payload = envelope.value
          if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
            setState({
              status: 'error',
              code: payload?.code ?? 'UNKNOWN',
              message: payload?.message ?? t('unknownError'),
            })
            return
          }
          lastData = payload.data
          setState({ status: 'ready', data: payload.data })
        } catch (error) {
          setState({ status: 'error', code: 'CLIENT', message: error?.message ?? String(error) })
        }
      }, [])

      React.useEffect(() => {
        if (!visible) return void 0
        let alive = true
        const tick = () => {
          if (alive) void read()
        }
        // 首次刷新要等首次成功快照把 providers/models 带回来，才能判定可见性，
        // 所以这里无条件拉一次，之后的轮询才依赖 visible。
        tick()
        const timer = window.setInterval(tick, REFRESH_MS)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [read, visible])

      if (!visible) return null

      const data = state.data
      const windows = []
      if (state.status === 'ready' && data) {
        if (data.fiveHour) {
          windows.push({
            key: 'window5h',
            label: t('window5h'),
            window: data.fiveHour,
            remainingPercent: remainingPercentOf(data.fiveHour),
          })
        }
        if (data.weekly) {
          windows.push({
            key: 'windowWeekly',
            label: t('windowWeekly'),
            window: data.weekly,
            remainingPercent: remainingPercentOf(data.weekly),
          })
        }
      }
      // 底部只放两个剩余百分比，顺序固定：先是 5 小时窗口，再是周窗口。
      // 具体哪个数字对应哪个窗口由浮层说明，所以这里不再加 5h/1w 前缀。
      const summary =
        state.status === 'loading'
          ? t('loading')
          : state.status === 'error'
            ? t('unavailable')
            : windows.length > 0
              ? windows.map((entry) => `${entry.remainingPercent}%`).join(' · ')
              : t('noPlan')

      const chip = h(
        'button',
        {
          type: 'button',
          className: 'dsh-glm-quota',
          'data-open': String(open),
          'aria-expanded': open,
          // 只有百分比，靠 tooltip 说清楚这两个数字是什么。
          title: `${t('title')} · ${t('summaryHint')}`,
          onClick: () => {
            const next = !open
            setOpen(next)
            if (next) void read()
          },
        },
        h('span', { className: 'dsh-glm-quota-plan' }, data?.plan && data.plan !== 'UNKNOWN' ? `GLM ${data.plan}` : 'GLM'),
        h('span', { className: 'dsh-glm-quota-value' }, summary),
      )

      let card = null
      if (open) {
        card = h(
          'div',
          { className: 'dsh-glm-quota-card' },
          h(
            'div',
            { className: 'dsh-glm-quota-title' },
            h(
              'span',
              null,
              data?.plan && data.plan !== 'UNKNOWN' ? `${t('title')} · ${data.plan}` : t('title'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-glm-quota-refresh',
                onClick: () => {
                  setState({ status: 'loading' })
                  void read()
                },
              },
              t('refresh'),
            ),
          ),
          state.status === 'ready'
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'dsh-glm-quota-rows' },
                  windows.map((entry) =>
                    h(QuotaWindow, {
                      key: entry.key,
                      label: entry.label,
                      window: entry.window,
                      remainingPercent: entry.remainingPercent,
                    }),
                  ),
                ),
                // 详情直接铺开，不再折叠；只留一行更新时间作页脚。
                h('div', { className: 'dsh-glm-quota-foot' }, `${t('fetchedAt')} ${clockOf(data.fetchedAt)}`),
              )
            : h(
                'p',
                { className: 'dsh-glm-quota-hint dsh-glm-quota-error' },
                state.status === 'loading' ? t('loading') : `${state.code}: ${state.message}`,
              ),
        )
      }

      return h('div', { className: 'dsh-glm-quota-anchor' }, chip, card)
    }

    const ZN = {
      title: 'GLM 用量',
      window5h: '5 小时积分',
      windowWeekly: '周积分',
      remaining: '剩余',
      summaryHint: '前为 5 小时积分，后为周积分',
      loading: '读取中…',
      unavailable: '不可用',
      noPlan: '无生效套餐',
      refresh: '刷新',
      fetchedAt: '更新于',
      resetsAt: '{time} 重置',
      inDuration: '{duration}后',
      resetReady: '即将重置',
      durationDays: '{n} 天',
      durationHours: '{n} 小时',
      durationMinutes: '{n} 分钟',
      unknownError: '未知错误',
      remoteUnavailable: 'Host 端点未就绪',
    }
    const EN = {
      title: 'GLM usage',
      window5h: '5-hour credits',
      windowWeekly: 'Weekly credits',
      remaining: 'Left',
      summaryHint: 'first is 5-hour credits, second is weekly',
      loading: 'Loading…',
      unavailable: 'Unavailable',
      noPlan: 'No active plan',
      refresh: 'Refresh',
      fetchedAt: 'Updated',
      resetsAt: 'resets {time}',
      inDuration: 'in {duration}',
      resetReady: 'resetting',
      durationDays: '{n}d ',
      durationHours: '{n}h ',
      durationMinutes: '{n}m',
      unknownError: 'Unknown error',
      remoteUnavailable: 'Host endpoint not ready',
    }

    /**
     * 消费侧端点定义，与 Host 侧 index.js 的 typertContribution 描述同一个端点。
     * $mount 之后 ctx.remote.glmQuota.current() 才可调用。
     */
    const DESCRIPTOR = {
      id: `${LOCAL_ID}#glmQuota/current`,
      service: 'glmQuota',
      namespace: 'glmQuota',
      method: 'current',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: `${LOCAL_ID}#GlmQuotaSnapshot`,
        create: () => ({ parse: (value) => value }),
      },
    }

    /** 只在值变化时打一条带前缀的日志，方便从 console 直接定位问题层。 */
    let lastLogLine = ''
    function diag(line) {
      if (line === lastLogLine) return
      lastLogLine = line
      const emit = typeof console !== 'undefined' ? console.info : () => {}
      emit(`[glm-quota] ${line}`)
    }

    return {
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        installStyles()
        appCtx = ctx

        // slot 注册放在最前面：后面任何一步失败，徽标也至少能挂上。
        // sessionId 用条目自己的 inject 回调拿（与官方 queue dock 同款写法）。
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'glm-quota',
              order: 30,
              locale: NS,
              inject: (sessionId) => ({ sessionId }),
            },
            QuotaChip,
          ),
        )
        diag('slot registered')

        try {
          ctx.effect(
            () => ctx.locale.register(NS, { zh: ZN, en: EN }),
            'glm-quota: locale',
          )
          t = ctx.locale.bind(NS)
        } catch (error) {
          diag(`locale failed: ${error?.message ?? error}`)
        }

        // $mount 安装 remote.glmQuota 命名空间；返回后 ctx.remote.glmQuota 才有方法。
        // 这里只保存 promise，组件在每次调用前 await 它，避免早于挂载完成就取引用。
        mountPromise = Promise.resolve(
          ctx.remote.$mount({ package: LOCAL_ID, descriptors: [DESCRIPTOR] }),
        ).then(
          (dispose) => {
            diag('remote mounted')
            return dispose
          },
          (error) => {
            diag(`remote mount failed: ${error?.message ?? error}`)
            throw error
          },
        )
      },
    }
  },
})

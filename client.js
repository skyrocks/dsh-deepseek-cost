// Client 半：输入框下方常驻显示 DeepSeek 余额与本轮/今日/本周/本月/累计金额。
// 手写 lazy-CJS bundle：脚本执行时只注册 factory，模块体在 materialize 时才运行。
window.__ModuleLoader__.load({
  id: "dsh-deepseek-cost",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    const DEFAULT_POLL_MS = 30000;
    /** 只有官方路由会扣 DeepSeek 余额。 */
    const OFFICIAL_PROVIDERS = ["deepseek-official", "deepseek-account"];

    // 客户端只声明调用形状；结果校验在 Host 侧完成，这里直通即可。
    const passThrough = () => ({ parse: (value) => value });
    const REMOTE = {
      package: "dsh-deepseek-cost",
      descriptors: [
        {
          id: "dsh-deepseek-cost#deepseekCost/read",
          service: "deepseekCost",
          namespace: "deepseekCost",
          method: "read",
          invocation: { kind: "direct" },
          parameters: [],
          result: {
            mode: "strict",
            typeSymbol: "dsh-deepseek-cost#DeepSeekCostResult",
            create: passThrough,
          },
        },
        {
          id: "dsh-deepseek-cost#deepseekCost/refresh",
          service: "deepseekCost",
          namespace: "deepseekCost",
          method: "refresh",
          invocation: { kind: "direct" },
          parameters: [],
          result: {
            mode: "strict",
            typeSymbol: "dsh-deepseek-cost#DeepSeekCostResult",
            create: passThrough,
          },
        },
      ],
    };

    const CSS = [
      ".dsh-dc-dock{position:relative;display:inline-flex;align-items:center;gap:9px;height:18px;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary,#8a8f98);cursor:pointer;user-select:none;font-variant-numeric:tabular-nums;outline:none;}",
      "[data-composer-dock] .dsh-dc-dock,[data-composer-dock] > :has(> .dsh-dc-dock){order:99;}",
      ".dsh-dc-dock:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:3px;border-radius:4px;}",
      ".dsh-dc-brand{font-size:10px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#6b7280);opacity:.85;}",
      ".dsh-dc-item{display:inline-flex;align-items:baseline;gap:4px;white-space:nowrap;}",
      ".dsh-dc-label{opacity:.65;font-size:10px;}",
      ".dsh-dc-value{font-size:10.5px;color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dsh-dc-item.is-balance .dsh-dc-value{color:var(--dsw-alias-label-primary,#1f2329);font-weight:600;}",
      ".dsh-dc-item.is-turn .dsh-dc-value{color:var(--dsw-alias-state-business-primary,#4d6bfe);}",
      ".dsh-dc-item.is-negative .dsh-dc-value{color:var(--dsw-alias-state-error-primary,#e5484d);}",
      ".dsh-dc-item.is-missing .dsh-dc-value{color:var(--dsw-alias-state-warning-primary,#e6a23c);}",
      ".dsh-dc-sep{width:1px;height:10px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.28));flex:none;}",
      ".dsh-dc-status{opacity:.7;font-size:10.5px;white-space:nowrap;}",
      ".dsh-dc-dock.is-busy .dsh-dc-status{animation:dsh-dc-pulse 1.1s ease-in-out infinite;}",
      "@keyframes dsh-dc-pulse{0%,100%{opacity:.35}50%{opacity:.9}}",
      ".dsh-dc-pop{position:absolute;left:0;bottom:calc(100% + 8px);z-index:40;width:268px;padding:10px 12px 11px;border-radius:10px;background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));box-shadow:0 8px 24px rgba(0,0,0,.14);color:var(--dsw-alias-label-primary,#1f2329);cursor:default;}",
      ".dsh-dc-pop-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:7px;}",
      ".dsh-dc-pop-title{font-size:11.5px;font-weight:600;}",
      ".dsh-dc-pop-meta{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;}",
      ".dsh-dc-row{display:grid;grid-template-columns:40px 1fr auto;align-items:baseline;gap:8px;margin-top:6px;font-size:10.5px;}",
      ".dsh-dc-row-name{color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dsh-dc-row-detail{color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:10px;text-align:right;white-space:nowrap;}",
      ".dsh-dc-row-value{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".dsh-dc-row-value.is-strong{font-weight:600;}",
      ".dsh-dc-sub{margin:-2px 0 4px 48px;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-dc-foot{margin-top:9px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));font-size:9.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-dc-foot b{font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);}",
      "@media (max-width:820px){.dsh-dc-brand{display:none}.dsh-dc-item.is-month,.dsh-dc-item.is-total{display:none}}",
      "@media (max-width:640px){.dsh-dc-item.is-week{display:none}.dsh-dc-label{display:none}}",
    ].join("");

    let ctxRef = null;
    let mountReady = null;

    /** 通过 Remote 取一次数据；force 时先让 Host 清缓存。 */
    async function requestUsage(force) {
      await mountReady;
      const api = ctxRef === null ? undefined : ctxRef.get("remote.deepseekCost");
      if (api === undefined) throw new Error("remote-unavailable");
      if (force) {
        try {
          await api.refresh();
        } catch {
          // 刷新失败时仍尝试读缓存。
        }
      }
      const result = await api.read();
      if (!result || result.ok === false) {
        const reason = result && result.error ? result.error.message || String(result.error) : "remote-failed";
        throw new Error(reason);
      }
      return result.value;
    }

    function symbolOf(currency) {
      return currency === "USD" ? "$" : "¥";
    }

    /** 去掉小数末尾多余的 0：0.020 → 0.02。 */
    function trimZeros(text) {
      return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
    }

    /** 金额格式：支持负数（余额可能透支）；小额三位去尾零，大额两位，极大值压缩成 k。 */
    function money(value, currency) {
      const symbol = symbolOf(currency);
      if (typeof value !== "number" || !Number.isFinite(value)) return `${symbol}—`;
      const sign = value < 0 ? "-" : "";
      const abs = Math.abs(value);
      if (abs === 0) return `${symbol}0`;
      if (abs < 0.001) return `${sign}<${symbol}0.001`;
      if (abs < 1) return `${sign}${symbol}${trimZeros(abs.toFixed(3))}`;
      if (abs < 1000) return `${sign}${symbol}${abs.toFixed(2)}`;
      return `${sign}${symbol}${(abs / 1000).toFixed(1)}k`;
    }

    /** token 数：1234 → 1.2k；1234567 → 1.2M。 */
    function tokens(value) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "0";
      if (value < 1000) return String(Math.round(value));
      if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
      return `${(value / 1_000_000).toFixed(2)}M`;
    }

    /** 一个桶的 token 明细，例如 `12.3k in · 0.8k out`。 */
    function detailOf(bucket) {
      if (!bucket) return "";
      const parts = [];
      const prompt = (bucket.input || 0) + (bucket.cacheRead || 0) + (bucket.cacheWrite || 0);
      if (prompt > 0) parts.push(`${tokens(prompt)} in`);
      if (bucket.output > 0) parts.push(`${tokens(bucket.output)} out`);
      if (bucket.calls > 0) parts.push(`${bucket.calls} 次`);
      return parts.join(" · ");
    }

    /** 官网桶：不可用时显示 —，可用时显示金额。 */
    function bucketValue(bucket, currency) {
      if (!bucket || bucket.source === "unavailable") return "—";
      return money(bucket.cost, currency);
    }

    /** 官网桶说明：优先模型名，其次本地 token 明细。 */
    function bucketDetail(bucket) {
      if (!bucket || bucket.source === "unavailable") return "";
      if (Array.isArray(bucket.models) && bucket.models.length > 0) return bucket.models.join(" · ");
      return detailOf(bucket);
    }

    function describeError(error) {
      if (error === "no-key") return "未配置 DeepSeek API Key";
      if (error === "signed-out") return "未登录 DeepSeek 账号";
      if (error === "unauthorized") return "API Key 已失效（401）";
      if (error === "forbidden") return "无权读取余额（403）";
      if (error === "network") return "余额请求失败";
      if (error === "empty") return "余额接口未返回金额";
      if (error === "bad-json") return "余额接口返回无法解析";
      if (error === "account-empty") return "账号钱包为空";
      if (error === "account-failed") return "账号余额读取失败";
      if (typeof error === "string" && error.startsWith("http-")) return `余额接口返回 ${error.slice(5)}`;
      return error ? String(error) : "余额不可用";
    }

    function Row(props) {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          { className: "dsh-dc-row" },
          React.createElement("span", { className: "dsh-dc-row-name" }, props.label),
          React.createElement("span", { className: "dsh-dc-row-detail" }, props.detail || ""),
          React.createElement(
            "span",
            { className: props.strong ? "dsh-dc-row-value is-strong" : "dsh-dc-row-value" },
            props.value,
          ),
        ),
        props.sub ? React.createElement("div", { className: "dsh-dc-sub" }, props.sub) : null,
      );
    }

    function Popup(props) {
      const data = props.data;
      const balance = data.balance;
      const currency = data.currency;
      const turn = data.turns && props.sessionId ? data.turns[props.sessionId] : undefined;
      const updated = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "";
      const sub = balance
        ? `充值 ${money(balance.toppedUp, currency)} · 赠送 ${money(balance.granted, currency)}`
        : data.balanceError
          ? describeError(data.balanceError)
          : null;

      return React.createElement(
        "div",
        { className: "dsh-dc-pop" },
        React.createElement(
          "div",
          { className: "dsh-dc-pop-head" },
          React.createElement("span", { className: "dsh-dc-pop-title" }, "DeepSeek 余额与花费"),
          updated ? React.createElement("span", { className: "dsh-dc-pop-meta" }, `更新 ${updated}`) : null,
        ),
        React.createElement(Row, {
          label: "余额",
          value: balance ? money(balance.total, currency) : "—",
          sub,
          strong: true,
        }),
        React.createElement(Row, {
          label: "本轮",
          value: turn ? money(turn.cost, currency) : money(0, currency),
          detail: turn ? detailOf(turn) : "本会话暂无调用",
        }),
        React.createElement(Row, {
          label: "今日",
          value: bucketValue(data.day, currency),
          detail: bucketDetail(data.day),
          sub: data.day.source === "official" ? null : "官网未返回",
        }),
        React.createElement(Row, {
          label: "本周",
          value: bucketValue(data.week, currency),
          detail: bucketDetail(data.week),
          sub: data.week.source === "official" ? null : "官网未返回",
        }),
        React.createElement(Row, {
          label: "本月",
          value: bucketValue(data.month, currency),
          detail: bucketDetail(data.month),
          sub: data.month.source === "official" ? null : "官网未返回",
        }),
        React.createElement(Row, {
          label: "累计",
          value: bucketValue(data.total, currency),
          detail: "",
          sub: data.total.source === "official" ? "官网账号累计（含其它客户端）" : "官网未返回",
        }),
        React.createElement(
          "div",
          { className: "dsh-dc-foot" },
          React.createElement("b", null, "数据来源"),
          "：余额 / 今日 / 本周 / 本月 / 累计 直接读官网账号；本轮由本地按官方价目表估算（官网不提供该粒度）。",
          data.status !== "official"
            ? React.createElement("div", null, "未登录官网账号，官网数据不可用")
            : null,
          React.createElement("div", null, "点击立即刷新"),
        ),
      );
    }

    function Dock(props) {
      const sessionId = props && props.sessionId;
      const [data, setData] = React.useState(null);
      const [status, setStatus] = React.useState("loading");
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [hover, setHover] = React.useState(false);
      const [provider, setProvider] = React.useState(undefined);
      const alive = React.useRef(true);
      const generation = React.useRef(0);

      const load = React.useCallback(async (force) => {
        const id = generation.current + 1;
        generation.current = id;
        setStatus((current) => (current === "ready" ? current : "loading"));
        try {
          const value = await requestUsage(force);
          if (!alive.current || generation.current !== id) return;
          setData(value);
          setStatus("ready");
          setError(value && value.balanceError ? value.balanceError : null);
        } catch (failure) {
          if (!alive.current || generation.current !== id) return;
          setStatus("error");
          setError(failure && failure.message ? failure.message : String(failure));
        }
      }, []);

      React.useEffect(() => {
        return () => {
          alive.current = false;
        };
      }, []);

      // 当前会话的模型来源：非官方路由（opencode-go / 自建中转等）整条隐藏。
      React.useEffect(() => {
        if (!sessionId) {
          setProvider("unknown");
          return undefined;
        }
        let store = null;
        try {
          const directories = ctxRef === null ? undefined : ctxRef.get("modelDirectories");
          if (directories !== undefined) store = directories.directoryFor(sessionId).store;
        } catch {
          store = null;
        }
        if (!store) {
          setProvider("unknown");
          return undefined;
        }
        const read = () => {
          try {
            const snapshot = store.getSnapshot();
            const current = snapshot && snapshot.current;
            setProvider(current && typeof current.provider === "string" ? current.provider : "unknown");
          } catch {
            setProvider("unknown");
          }
        };
        read();
        const dispose = typeof store.subscribe === "function" ? store.subscribe(read) : undefined;
        return () => {
          if (typeof dispose === "function") dispose();
        };
      }, [sessionId]);

      // undefined＝还没解析出模型来源，先不显示，避免非官方会话闪一下。
      const visible = provider === "unknown" || OFFICIAL_PROVIDERS.includes(provider);
      const pollMs = (data && typeof data.refreshMs === "number" && data.refreshMs) || DEFAULT_POLL_MS;

      React.useEffect(() => {
        if (!visible) return undefined;
        load(false);
        const handle = setInterval(() => {
          load(false);
        }, pollMs);
        return () => clearInterval(handle);
      }, [load, pollMs, visible]);

      // 会话切换后立刻读一次，让「本轮」跟上当前会话；首帧由下面的轮询负责。
      const firstSession = React.useRef(true);
      React.useEffect(() => {
        if (firstSession.current) {
          firstSession.current = false;
          return;
        }
        if (sessionId && visible) load(false);
      }, [sessionId, load, visible]);

      const activate = () => {
        if (busy) return;
        setBusy(true);
        load(true).finally(() => {
          if (alive.current) setBusy(false);
        });
      };

      const currency = (data && data.currency) || "CNY";
      const balance = data && data.balance;
      const turn = data && data.turns && sessionId ? data.turns[sessionId] : undefined;
      const balanceText = balance ? money(balance.total, currency) : data ? "—" : "…";

      const items = [
        {
          key: "balance",
          label: "余额",
          value: balanceText,
          cls: balance && balance.total < 0 ? "is-balance is-negative" : "is-balance",
          title: balance ? "DeepSeek 账户余额" : describeError(data && data.balanceError),
        },
        { key: "turn", label: "轮", value: turn ? money(turn.cost, currency) : money(0, currency), cls: "is-turn", title: "当前轮次花费" },
        {
          key: "day",
          label: "日",
          value: data ? bucketValue(data.day, currency) : "…",
          cls: data && data.day.source !== "official" ? "is-day is-missing" : "is-day",
          title: "今日花费（官网）",
        },
        {
          key: "week",
          label: "周",
          value: data ? bucketValue(data.week, currency) : "…",
          cls: data && data.week.source !== "official" ? "is-week is-missing" : "is-week",
          title: "本周花费（官网）",
        },
        {
          key: "month",
          label: "月",
          value: data ? bucketValue(data.month, currency) : "…",
          cls: data && data.month.source !== "official" ? "is-month is-missing" : "is-month",
          title: "本月花费（官网）",
        },
        {
          key: "total",
          label: "总",
          value: data ? bucketValue(data.total, currency) : "…",
          cls: data && data.total.source !== "official" ? "is-total is-missing" : "is-total",
          title: "累计花费（官网）",
        },
      ];

      const title =
        status === "ready"
          ? `${items.map((item) => `${item.title} ${item.value}`).join(" · ")}（点击刷新）`
          : status === "error"
            ? `${describeError(error)}（点击重试）`
            : "DeepSeek 余额与花费";

      const content = [];
      content.push(React.createElement("span", { className: "dsh-dc-brand", key: "brand" }, "DS"));
      if (status === "error" && data === null) {
        content.push(
          React.createElement(
            "span",
            { className: "dsh-dc-status", key: "status" },
            busy ? "刷新中…" : "不可用",
          ),
        );
      } else if (status === "loading" && data === null) {
        content.push(React.createElement("span", { className: "dsh-dc-status", key: "status" }, "读取中…"));
      } else {
        items.forEach((item, index) => {
          if (index > 0) content.push(React.createElement("span", { className: "dsh-dc-sep", key: `sep-${item.key}` }));
          content.push(
            React.createElement(
              "span",
              { className: `dsh-dc-item ${item.cls}`, key: item.key, title: item.title },
              React.createElement("span", { className: "dsh-dc-label" }, item.label),
              React.createElement("span", { className: "dsh-dc-value" }, item.value),
            ),
          );
        });
      }
      if (hover && status === "ready" && data) {
        content.push(React.createElement(Popup, { key: "popup", data, sessionId }));
      }

      if (!visible) return null;

      return React.createElement(
        "div",
        {
          className: busy ? "dsh-dc-dock is-busy" : "dsh-dc-dock",
          role: "button",
          tabIndex: 0,
          title,
          "aria-label": title,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onClick: activate,
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              activate();
            }
          },
        },
        content,
      );
    }

    function ensureStyle() {
      if (typeof document === "undefined") return () => {};
      const id = "dsh-deepseek-cost-style";
      const existing = document.getElementById(id);
      if (existing) return () => {};
      const element = document.createElement("style");
      element.id = id;
      element.textContent = CSS;
      document.head.appendChild(element);
      return () => {
        element.remove();
      };
    }

    function apply(ctx) {
      ctxRef = ctx;
      mountReady = ctx.remote.$mount(REMOTE);
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      ctx.effect(() => ensureStyle());
      slots.inject("conversation.composer.dock", () =>
        slots.register(
          { name: "conversation.composer.dock", id: "deepseek-cost-dock", order: 6 },
          (props) => React.createElement(Dock, { sessionId: props && props.sessionId }),
        ),
      );
    }

    exports.apply = apply;
    exports.inject = ["slots", "remote"];
    return module.exports;
  },
});

# Changelog

## 0.2.2

- `cordis.patch.yml` 的插件行名改为包名 `@skyrocks/dsh-deepseek-cost`：包名带 scope 后，
  行名必须与安装后的模块名一致，否则 Host 启动时找不到插件。
- 安装说明改为 GitHub 唯一来源（`github:skyrocks/dsh-deepseek-cost`），暂时不走 npm。
- 去掉未发布的 npm 徽章。

## 0.2.1

- npm 包名改为 `@skyrocks/dsh-deepseek-cost`：npm 上已有同名包（作者 miaoxintechnology），
  本项目改用带 scope 的名字，避免装错。
- README 增加 npm / GitHub 两种安装来源与作者提示；补 npm、license、DSH 版本徽章。
- `author` 改为 `skyrocks`，补 `publishConfig.access: public`。

## 0.2.0

- **余额、累计、本月、本周、今日全部改为直接读官网账号接口**，不再本地估算：
  - `get_user_summary` → 钱包余额 + `total_costs`（账号累计）
  - `usage/by_api_key/cost` → 按天时间桶的官方消费金额
- 只有「本轮」保留本地估算（官网不提供该粒度），价目表为官方人民币价并区分高峰/空闲。
- 移除 `cumulativeBase`（此前用于人为对齐累计，属于本地补差，已删除）。
- 未登录官网账号时：余额回退 API Key `/user/balance`，日/周/月/累计如实显示 `—`。

## 0.1.1

- 价目表改为官方人民币价，并按调用时刻自动选高峰/空闲价。
- 默认只统计官方路由，订阅渠道不再计入。
- 客户端门控：当前会话不是官方模型时整条隐藏。
- 修复负余额显示（`-¥0.49` 不再被当成「<¥0.001」）。

## 0.1.0

- 输入框下方 dock：余额 + 本轮 / 今日 / 本周 / 本月 / 累计金额。
- 历史会话后台扫描（按 `sessionId#seq` 幂等去重），活跃会话增量折叠。

# 发布清单（维护者用）

这份文件不会随 tarball 发布，只用于把仓库整理成可公开的状态。

## 1. 检查

```sh
node test/smoke.mjs            # 19 项单元测试
node --check client.js         # 客户端 bundle 语法
grep -n "YOUR_GITHUB_NAME" README.md README.en.md package.json   # 应无输出
```

## 2. 上传

仓库根目录是 **本目录的内容**（`package.json` 与 `cordis.patch.yml` 在根），
不要把外层父目录一起上传，否则 `github:skyrocks/dsh-deepseek-cost` 安装会找不到插件清单。

```sh
git init -b main
git add -A
git commit -m "feat: DeepSeek balance and spend plugin for DeepSeek Harness"
gh repo create skyrocks/dsh-deepseek-cost --public --source=. --remote=origin --push
git tag v0.2.0
git push origin v0.2.0
```

## 3. Release

```sh
pnpm pack                      # 生成 dsh-deepseek-cost-0.2.0.tgz
gh release create v0.2.0 ./dsh-deepseek-cost-0.2.0.tgz \
  --title "v0.2.0" --generate-notes
```

## 4. 发布前检查

- [x] `node test/smoke.mjs` 通过（19 项）
- [x] 所有模块 `node --check` 通过
- [x] README 预览图为 PNG（`docs/preview-*.png`），源文件为同目录 SVG
- [x] `package.json` 含 `repository` / `homepage` / `bugs`
- [ ] CI 在 Ubuntu / macOS / Windows 上全绿（推送后自动跑）
- [ ] 安装路径实测：粘贴 `github:skyrocks/dsh-deepseek-cost` 后完全退出重启
- [ ] Release 附件与 `package.json` 版本一致

## 5. 数据口径（避免再次误解）

- 余额 / 今日 / 本周 / 本月 / 累计：**官网同源接口**，不做任何本地补差。
- 本轮：本地按官方价目表估算（官网无此粒度）。
- 历史版本里的 `cumulativeBase` 已删除，不要重新引入人工基数。

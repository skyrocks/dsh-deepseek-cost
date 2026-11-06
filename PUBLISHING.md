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
pnpm pack                      # 生成 skyrocks-dsh-deepseek-cost-0.2.1.tgz
npm publish --access public    # 发布到 npm（名字带 scope）
gh release create v0.2.1 ./skyrocks-dsh-deepseek-cost-0.2.1.tgz \
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

## 5. 本机发布记录（2026-10-30）

- 仓库已创建并推送：<https://github.com/skyrocks/dsh-deepseek-cost>，tag `v0.2.1`。
- 本机 SSH(22) 与 HTTPS(443) 均不可达 github.com，只有 `api.github.com` 可用，
  因此首次发布走 GitHub Git Data API（blob → tree → commit → ref）完成。
- `.github/workflows/ci.yml` **未推送**：当前 gh token 的 scope 是
  `gist, read:org, repo`，缺 `workflow`。补推步骤：

  ```sh
  gh auth refresh -h github.com -s workflow
  gh api -X PUT /repos/skyrocks/dsh-deepseek-cost/contents/.github/workflows/ci.yml \
    -f message="ci: add workflow" \
    -f content="$(base64 -i .github/workflows/ci.yml)"
  ```

- 网络恢复后把本地历史对齐到远端：

  ```sh
  git fetch origin
  git reset --hard origin/main   # 本地提交内容与远端一致，只差 ci.yml
  git commit -am "ci: add workflow" && git push -u origin main
  ```

## 6. 数据口径（避免再次误解）

- 余额 / 今日 / 本周 / 本月 / 累计：**官网同源接口**，不做任何本地补差。
- 本轮：本地按官方价目表估算（官网无此粒度）。
- 历史版本里的 `cumulativeBase` 已删除，不要重新引入人工基数。

# 末栏 · ARG三部曲

沉浸式网页恐怖解谜 ARG 游戏。**纯静态站点**，无需服务器、无需后端、无需构建、无需 API Key。
已完全脱离豆包/妙搭平台：所有图片、字体、音频与逻辑均已内置于本目录。

## 部署到 GitHub Pages

1. 新建仓库，名称建议 `arg-game`，可见性 **Public**。
2. 把本目录**全部文件**（含隐藏文件 `.nojekyll`）上传到仓库**根目录**。
3. 仓库 → **Settings → Pages** → Source 选 `Deploy from a branch`
   → Branch `main` → 目录 `/ (root)` → Save。
4. 等 1–2 分钟，访问 `https://<你的用户名>.github.io/arg-game/`

## 本地预览

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 说明

- 任意路径都能跑：根目录、子目录（`/arg-game/`）均自动适配。
- 进度存在浏览器 localStorage，刷新即从头开始（游戏设定）。
- 目录结构：`index.html` + `assets/`（JS/CSS/图片都在这里）。

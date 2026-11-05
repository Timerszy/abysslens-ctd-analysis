# 渊鉴 · AbyssLens

海洋装备数据诊断网页，使用 GitHub Pages 静态托管。

打开站点即可查看内置示例。使用“导入文件夹”选择 CTD 数据目录，可一并分析 CTD、keydata、level、mot 和日志；也可以单独导入 CSV 或日志文件。图表缩放、浮标状态回放、日志筛选和 PNG 导出均在浏览器中运行。

导入的文件只在本机浏览器中读取，不会上传到 GitHub Pages。不同标签页可通过同源浏览器消息同步本次导入。

此静态版本不能自动扫描托管服务器上的仪器数据目录。页面不会把数据目录提交到本仓库。

## 部署

仓库使用 GitHub Actions 发布到 GitHub Pages。将仓库的 Pages 来源设为 **GitHub Actions**。每次向 `main` 分支提交网页文件后，站点会自动更新。

入口为 `index.html`；日志页为 `ctd-logs.html`。页面资源使用相对路径，支持发布在 GitHub Pages 项目子路径下。

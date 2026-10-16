# Claude MV Remote Connector

把 `Joker-chichi/claude-mv-skill` 的手绘动画工作流封装成 Claude 网页端可连接的远程 MCP 服务，并提供云端 MP4 渲染容器。

> 状态：源码与部署配置提交后，还必须在 Render 等支持 Docker 的平台完成部署，并实测 MCP 与 MP4 渲染。GitHub Pages 不能运行此 Node/Docker 后端。

## 架构
- Claude 网页端：通过自定义 Remote MCP Connector 调用工具
- Node.js / Express：MCP Streamable HTTP endpoint `/mcp`，以及项目与素材上传 API
- Docker：Chromium + FFmpeg + 上游手绘动画模板
- 持久磁盘：保存项目、音频、歌词、预览和 MP4

## 部署到 Render
1. 在 Render 新建 **Web Service**，连接此仓库，Runtime 选择 Docker。
2. 添加持久磁盘，挂载到 `/app/workspaces`（建议至少 5 GB；长视频会占用更多空间）。
3. 配置环境变量：
   - `NODE_ENV=production`
   - `ACCESS_TOKEN`：随机生成的长令牌（至少 24 字符）
   - `PUBLIC_BASE_URL`：部署后服务的 HTTPS URL
   - `WORKSPACES=/app/workspaces`
4. 等待 Docker build 成功后访问 `/api/health`。只有 `engineReady: true` 才表示检测到动画引擎；这不代表已完成完整 MP4 端到端验证。
5. 在 Claude 网页端的 Settings → Connectors（名称可能因版本/账户不同）添加远程 MCP，URL 为 `https://你的服务域名/mcp`，配置请求头 `Authorization: Bearer 你的ACCESS_TOKEN`。若账户/组织未开放自定义连接器，此方式无法在该账户直接启用。

## 使用流程
1. 上传真实音频与 LRC（`POST /api/projects`，multipart 字段 `audio`、`lrc`）。
2. 在 Claude 中创建项目、生成分镜并征求用户确认。
3. 生成场景代码、渲染并检查关键帧预览；经用户批准后才能执行完整渲染。
4. 只有状态接口确认 MP4 存在且文件大小有效时，才返回下载地址。

## API
- `GET /api/health`
- `POST /api/projects`（multipart：title、idea、duration_seconds、audio、lrc）
- `GET /api/projects`
- `GET /api/projects/:id`
- `GET /api/projects/:id/lyrics`
- `GET /api/projects/:id/preview`
- `GET /api/projects/:id/video`
- `POST /api/projects/:id/storyboard`
- `POST /mcp`（MCP Streamable HTTP）

受保护的 API/MCP 请求需要 Bearer 令牌。不要把访问令牌写入网页源码或公开仓库。

## 本地检查
```bash
npm ci
npm run check
npm test
```

本项目以原仓库 `https://github.com/Joker-chichi/claude-mv-skill` 为上游；部署时应保留上游许可证与署名。歌词对齐仍需基于真实 LRC 并检查预览，不能仅凭自动生成保证逐字同步。

# ReelForge 部署指南（VPS + Docker 版）

ReelForge 现在按纯后端接口项目部署：一个 HTTP API、一个 FFmpeg worker、一个 Redis。

---

## 0. 部署完之后长什么样

跑起来之后，你的 VPS 上会同时跑这 3 个容器：

| 容器 | 端口 | 用途 |
| --- | --- | --- |
| `vgs-redis` | 6379 | 任务队列（可不对公网暴露） |
| `vgs-api` | 3005 | HTTP 接口，Swagger 文档在 `/docs` |
| `vgs-worker-ffmpeg` | - | 后台跑视频拼接 / 成片，没有端口 |

访问入口：

- API Swagger：`http://你的VPS的IP:3005/docs`
- 健康检查：`http://你的VPS的IP:3005/health`

整套用一份 `docker-compose.yml` 编排，源码改动后执行：

```bash
docker compose --profile app up -d --build
```

---

## 1. VPS 配置

最低建议：

- CPU：2 核起
- 内存：4 GB 起
- 磁盘：40 GB 起
- 系统：Ubuntu 22.04 / Debian 12
- 网络：能访问 npm registry、LLM/TTS 服务、Pexels 和对象存储

---

## 2. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
exit
```

重新登录后验证：

```bash
docker version
docker compose version
```

如果没有 compose v2 plugin：

```bash
sudo apt-get update && sudo apt-get install -y docker-compose-plugin
```

准备部署目录：

```bash
sudo mkdir -p /opt/reelforge
sudo chown -R "$USER:$USER" /opt/reelforge
```

防火墙至少放行：

- `3005`（API）
- `22`（SSH）

---

## 3. 获取代码

```bash
cd /opt/reelforge
git clone https://github.com/<你>/<这个仓库>.git current
cd current
```

---

## 4. 生产环境变量

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

关键项：

```ini
NODE_ENV=production
LOG_LEVEL=info

API_PORT=3005
API_HOST=0.0.0.0
WEBHOOK_SIGNING_SECRET=请改成长一点的随机字符串

REDIS_HOST=127.0.0.1
REDIS_PORT=6379

S3_ENDPOINT=https://cn-nb1.rains3.com
S3_REGION=rainyun
S3_BUCKET=video
S3_ACCESS_KEY=你的 AK
S3_SECRET_KEY=你的 SK
S3_FORCE_PATH_STYLE=false

LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_TIMEOUT_MS=60000
OPENAI_API_KEY=你的 key
OPENAI_BASE_URL=https://api.openai.com/v1

SILICONFLOW_API_KEY=你的 key
PEXELS_API_KEY=你的 key

WECHAT_EXTRACT_API_BASE=https://你的服务商域名
WECHAT_EXTRACT_TOKEN=你的 token
```

本地或临时调试可设置：

```ini
DEV_API_KEY=dev-key
```

---

## 5. 启动

```bash
cd /opt/reelforge/current
docker compose --profile app up -d --build
docker compose --profile app ps
```

看日志：

```bash
docker compose --profile app logs -f api
docker compose --profile app logs -f worker-ffmpeg
```

验证：

```bash
curl -fsS http://127.0.0.1:3005/health
curl http://127.0.0.1:3005/v1/tts/voices \
  -H "X-API-Key: dev-key"
```

---

## 6. 日常运维

改 `.env` 后重启：

```bash
docker compose --profile app up -d
```

拉新代码并发版：

```bash
git pull
docker compose --profile app up -d --build --remove-orphans
```

重启 / 停止：

```bash
docker compose --profile app restart
docker compose --profile app restart api
docker compose --profile app down
```

进容器排查：

```bash
docker exec -it vgs-api sh
docker exec -it vgs-worker-ffmpeg sh
```

---

## 7. Nginx 反代 + HTTPS

示例只公开 API：

```nginx
server {
    listen 80;
    server_name api.reelforge.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 600M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/reelforge.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.reelforge.your-domain.com
```

---

## 8. BGM 说明

当前代码会初始化默认 BGM 分类：

- Lo-Fi
- 动感
- 电影感
- 商务
- 自定义

首次访问 `/v1/bgm`、`/v1/bgm/categories` 或 `/v1/bgm/:id/preview` 时，API 会把内置系统 BGM 写入对象存储和 Redis。当前内置曲目包括 `Chill Loopable`、`Optimistic Day Remixed`、`City Loop` 和 `Determined Pursuit`，均来自 OpenGameArt，许可为 CC0；素材说明见 `packages/storage/src/assets/bgm/README.md`。

前端试听时先调用 `/v1/bgm` 获取曲目列表，再调用 `GET /v1/bgm/:id/preview` 获取临时试听 URL。

也可以继续通过 `POST /v1/bgm` 上传自定义 BGM。自定义上传会强制归入 `custom` 分类；系统 BGM 不允许删除。

---

## 9. 踩坑速查

### API 起来了但 worker 不干活

先看 worker 日志：

```bash
docker compose --profile app logs --tail=200 worker-ffmpeg
```

常见原因是 LLM / TTS / S3 / Pexels 配置错误。

### 任务卡在 18%

`LLM_TIMEOUT_MS` 太短。长文章建议设置为 `60000` 或 `90000`，然后重启 API 和 worker。

### VPS 磁盘满了

常见来源：

- `/tmp/vgs-media-cache`：Pexels 素材缓存，默认上限 20GB
- 旧 Docker 镜像 / 容器 / volume

清理：

```bash
docker system prune -af
docker volume prune -f
```

### 上传素材报 413 / 文件过大

如果挂了 Nginx，加上：

```nginx
client_max_body_size 600M;
```

直连 3005 时限制走 `MAX_MATERIAL_FILE_SIZE_MB`。

---

## 附：相关文件

- `docker-compose.yml`：Redis + API + worker 编排
- `Dockerfile.api`：API 镜像
- `Dockerfile.worker-ffmpeg`：FFmpeg worker 镜像
- `scripts/deploy-remote.sh`：服务器侧解包 + 启动脚本
- `.github/workflows/deploy.yml`：自动部署 workflow
- `.env.example`：配置样例

# ReelForge 部署指南（VPS + Docker 版）

这篇文档是写给"我刚买了一台 VPS，想把 ReelForge 跑起来"的你。
不绕弯子，按顺序做完，半小时之内能看到 Web 管理台。

> 如果你卡住了，先翻到文末的「踩坑速查」，大概率你的问题在那里。

---

## 0. 部署完之后长什么样

跑起来之后，你的 VPS 上会同时跑这 4 个容器：

| 容器              | 端口 | 干嘛的                                       |
| ----------------- | ---- | -------------------------------------------- |
| `vgs-redis`       | 6379 | 任务队列（不对外暴露也行）                   |
| `vgs-api`         | 3005 | HTTP 接口，Swagger 文档在 `/docs`            |
| `vgs-worker-ffmpeg` | -    | 后台跑视频拼接 / 成片，没有端口             |
| `vgs-web`         | 3006 | Next.js 管理台，浏览器打开就能用             |

访问入口：

- 管理台：`http://你的VPS的IP:3006`
- API Swagger：`http://你的VPS的IP:3005/docs`

整套用一份 `docker-compose.yml` 编排，源码改动也是改完直接 `docker compose up -d --build` 一把梭。

---

## 1. VPS 该买什么样

不踩雷的最低配置：

- **CPU**：2 核（视频拼接是 FFmpeg 干活，CPU 越多越快）
- **内存**：4 GB（Remotion 渲染会吃内存，2GB 容易 OOM）
- **磁盘**：40 GB 起步（媒体缓存 `/tmp/vgs-media-cache` 默认上限 20GB）
- **系统**：Ubuntu 22.04 / Debian 12（其他发行版也行，命令稍微变一下）
- **架构**：x86_64 或 arm64 都可以
- **网络**：能访问 npm registry、Google Fonts（构建时要拉），以及你选的 LLM/TTS/对象存储

> ⚠️ 1 核 1G 的小机器跑得起来，但视频一长就翻车，别省这点钱。

---

## 2. 装这台 VPS 该装的东西

SSH 登上 VPS，把环境一次装齐。

### 2.1 装 Docker（官方一键脚本）

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# 退出当前会话再重新登录，让 docker 组生效
exit
```

重新 SSH 上来，验证一下：

```bash
docker version
docker compose version    # 必须是 v2，输出形如 "Docker Compose version v2.x.x"
```

如果 `docker compose version` 不认（提示找不到子命令），说明你装的是老版 `docker-compose`，把 compose plugin 补上：

```bash
sudo apt-get update && sudo apt-get install -y docker-compose-plugin
```

### 2.2 装一些零碎工具

```bash
sudo apt-get install -y git curl tar
```

### 2.3 准备部署目录

```bash
sudo mkdir -p /opt/reelforge
sudo chown -R "$USER:$USER" /opt/reelforge
```

后面我们就在 `/opt/reelforge` 里折腾。

### 2.4 开放防火墙

云厂商的"安全组" / VPS 面板里至少放行：

- `3005`（API）
- `3006`（Web 管理台）
- `22`（SSH，肯定要留）

如果你前面挂 Nginx 反代，再开 `80 / 443` 即可，3005/3006 不用对公网暴露。

---

## 3. 把代码弄到服务器

```bash
cd /opt/reelforge
git clone https://github.com/<你>/<这个仓库>.git current
cd current
```

私有仓库的话，提前把 deploy key 配到 GitHub 上，或者直接 `scp` 把代码扔上去，别折腾。

---

## 4. 写一份生产 `.env`（最容易翻车的环节）

复制模板：

```bash
cp .env.example .env
nano .env
```

下面这些**必须填**，别想着"先空着试一下"——空着启动也能起来，但用的时候马上 500：

```ini
NODE_ENV=production
LOG_LEVEL=info

API_PORT=3005
API_HOST=0.0.0.0

# 改成一段不会被人猜到的字符串，做接口签名用
WEBHOOK_SIGNING_SECRET=请改成长一点的随机字符串

# 本地 / 容器里都填 127.0.0.1 没关系，docker-compose.yml 会自动覆盖成 redis 服务名
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# === 对象存储（视频和素材都丢这里）===
# 雨云 OSS / AWS S3 / R2 / 阿里 OSS / MinIO 都行，只要兼容 S3
S3_ENDPOINT=https://cn-nb1.rains3.com
S3_REGION=rainyun
S3_BUCKET=video
S3_ACCESS_KEY=你的 AK
S3_SECRET_KEY=你的 SK
S3_FORCE_PATH_STYLE=false        # MinIO 自建才需要 true

# === LLM ===
LLM_PROVIDER=openai              # openai | claude | glm | kimi 任选
LLM_MODEL=gpt-4o-mini
LLM_TIMEOUT_MS=60000             # ⚠️ 别用默认的 15000，长文章一定超时
OPENAI_API_KEY=你的 key
OPENAI_BASE_URL=https://api.openai.com/v1

# === TTS（硅基流动 SiliconFlow）===
SILICONFLOW_API_KEY=你的 key

# === 素材搜索（Pexels）===
PEXELS_API_KEY=你的 key

# === 公众号文章读取（如果你用得到 /v1/wechat 接口才需要）===
WECHAT_EXTRACT_API_BASE=https://你的服务商域名
WECHAT_EXTRACT_TOKEN=你的 token
```

存盘退出。**给它锁权限**，别让别的用户偷看：

```bash
chmod 600 .env
```

> 想让某个开发能直接 `curl` 调试？给一个开发凭据：`DEV_API_KEY=dev-xxx`。
> 生产环境不需要的话留空，真实 key 由后台签发后写 Redis。

---

## 5. 一键拉起来

```bash
cd /opt/reelforge/current
docker compose --profile app up -d --build
```

这条命令会：

1. 按 `Dockerfile.api` / `Dockerfile.worker-ffmpeg` / `Dockerfile.web` 各自构建镜像（第一次大约 5-10 分钟，看网络）
2. 顺手起一个 Redis
3. 把 4 个容器全后台跑起来

看一眼状态：

```bash
docker compose --profile app ps
```

应该看到 4 个容器都 `Up` / `healthy`。

跟着日志看一会儿，确认没炸：

```bash
docker compose --profile app logs -f
# 想只看某个：
docker compose --profile app logs -f api
docker compose --profile app logs -f worker-ffmpeg
```

---

## 6. 验证一下成没成

健康检查（**最快最准**）：

```bash
curl -fsS http://127.0.0.1:3005/health
```

返回 `{"ok":true,...}` 就是 API 起来了。

浏览器访问：

- `http://你的VPS的IP:3006` → 应该看到 Web 管理台
- `http://你的VPS的IP:3005/docs` → Swagger 文档页

跑个真实接口（替换 `dev-key` 为你 `.env` 里的 `DEV_API_KEY`）：

```bash
curl http://127.0.0.1:3005/v1/tts/voices \
  -H "X-API-Key: dev-key"
```

返回一串音色列表就 OK。

---

## 7. 日常运维（你最常做的那几件事）

### 7.1 改了 `.env`，怎么生效

```bash
cd /opt/reelforge/current
nano .env                                          # 改完保存
docker compose --profile app up -d                 # 不用 --build，重启容器就行
```

### 7.2 拉了新代码，怎么发版

```bash
cd /opt/reelforge/current
git pull
docker compose --profile app up -d --build --remove-orphans
```

`--build` 会重新构建镜像，`--remove-orphans` 顺手清掉旧的悬挂容器。

### 7.3 看日志

```bash
docker compose --profile app logs -f --tail=200 api
docker compose --profile app logs -f --tail=200 worker-ffmpeg
```

worker 闷着不出活，多半看 worker 日志能看出问题（API key 错了、S3 403 之类的）。

### 7.4 重启 / 关掉

```bash
docker compose --profile app restart            # 全部重启
docker compose --profile app restart api        # 只重启 API
docker compose --profile app down               # 全部停掉（Redis 数据保留在 volume 里）
```

### 7.5 进容器里翻东西

```bash
docker exec -it vgs-api sh
docker exec -it vgs-worker-ffmpeg sh
```

---

## 8. （进阶）GitHub Actions 自动部署

不想每次手动 SSH 上去 `git pull`？仓库里已经配好了 `.github/workflows/deploy.yml`，
推到 `main` 自动构建 + 上传 + 部署。

**它干的事**：

1. Actions 把代码 typecheck + build
2. 用 `git archive` 打包当前 commit
3. SCP 上传到你的 VPS（不需要 VPS 能访问 GitHub）
4. SSH 到 VPS 跑 `scripts/deploy-remote.sh`，解压到 `releases/<commit-sha>`，启动容器
5. 健康检查通过后，把 `current` 软链接指向新 release
6. 旧 release 自动保留 5 个，方便回滚

### 8.1 GitHub 仓库的 Secrets

进 `Settings → Secrets and variables → Actions → New repository secret`：

| Secret           | 必填 | 填什么                                              |
| ---------------- | ---- | --------------------------------------------------- |
| `DEPLOY_HOST`    | ✅    | VPS 的 IP 或域名                                    |
| `DEPLOY_USER`    | ✅    | SSH 用户名（一般是 `root` 或 `ubuntu`）             |
| `DEPLOY_SSH_KEY` | ✅    | SSH 私钥**全文**（包含 `-----BEGIN ...-----` 行）   |
| `DEPLOY_PATH`    | ✅    | 部署目录，比如 `/opt/reelforge`                     |
| `DEPLOY_PORT`    | 可选 | SSH 端口，默认 `22`                                 |
| `DEPLOY_ENV`     | 强烈建议 | 整份生产 `.env` 的内容（直接整段粘进去）        |

> 私钥怎么来？在你**本地**生成一对部署专用的：
> ```bash
> ssh-keygen -t ed25519 -f ~/.ssh/reelforge-deploy -N ""
> ```
> 把 `reelforge-deploy.pub` 内容追加到 VPS 的 `~/.ssh/authorized_keys`，
> `reelforge-deploy`（私钥）整段粘到 `DEPLOY_SSH_KEY` Secret 里。

### 8.2 可选的 Variables

进 `Settings → Secrets and variables → Actions → Variables`：

| Variable                        | 默认           | 啥用                                |
| ------------------------------- | -------------- | ----------------------------------- |
| `REELFORGE_COMPOSE_PROJECT`     | `reelforge`    | compose project 名                  |
| `REELFORGE_COMPOSE_PROFILES`    | `app`          | 启动的 profile                      |
| `REELFORGE_HEALTHCHECK_URL`     | `http://127.0.0.1:3005/health` | 部署后的健康检查地址                |
| `REELFORGE_SKIP_HEALTHCHECK`    | `false`        | 设成 `true` 跳过健康检查            |
| `REELFORGE_RELEASES_RETAIN`     | `5`            | 服务器保留几个旧 release            |
| `REELFORGE_PRUNE_IMAGES`        | `false`        | 设成 `true` 部署完顺手清悬挂镜像    |

### 8.3 触发部署

```bash
git push origin main
```

或者去 `Actions → Deploy → Run workflow` 手动点。

### 8.4 改生产环境变量

直接改 `DEPLOY_ENV` Secret，再手动跑一次 workflow 就行。
脚本会把新 `.env` 覆盖到 `/opt/reelforge/shared/.env`，并 cp 到当前 release。

紧急情况想直接在服务器改：

```bash
nano /opt/reelforge/shared/.env
cd /opt/reelforge/current
cp /opt/reelforge/shared/.env .env
docker compose --profile app up -d --build
```

### 8.5 回滚

服务器上 release 都还在：

```bash
ls -1 /opt/reelforge/releases
```

回滚到某个旧版本：

```bash
target=/opt/reelforge/releases/<某个 commit-sha>
cp /opt/reelforge/shared/.env "$target/.env"
cd "$target"
docker compose -p reelforge --profile app up -d --build --remove-orphans
ln -sfn "$target" /opt/reelforge/current
```

---

## 9. （选做）挂个 Nginx 反代 + HTTPS

直接把 3006 暴露到公网总归不优雅。装个 Nginx + Certbot 把它套一层：

```nginx
# /etc/nginx/sites-available/reelforge.conf
server {
    listen 80;
    server_name reelforge.your-domain.com;

    # 管理台
    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API（如果想公开 API，否则可以删掉）
    location /v1/ {
        proxy_pass http://127.0.0.1:3005;
        proxy_set_header Host $host;
        client_max_body_size 600M;   # 素材上传 500M 上限，留点余量
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/reelforge.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d reelforge.your-domain.com
```

之后 `3005 / 3006` 可以不暴露到公网，只留本机访问。

---

## 10. 踩坑速查

### "构建到 Web 镜像那步卡住，最后报 Google Fonts 拉不到"

`apps/web/app/layout.tsx` 里用了 `next/font/google`，构建时 Next.js 会去 `fonts.googleapis.com` 拉字体。
你的 VPS 如果在墙内或网络受限，这步会挂。

应对：

- 给 VPS 配个能访问 Google 的代理
- 或者改成本地字体（`next/font/local`）后再部署

### "`docker compose` 命令找不到"

你装的是老版 `docker-compose`（带横线，python 那个），脚本要的是 v2 plugin（不带横线）。
照 §2.1 装 `docker-compose-plugin` 即可。

### "API 起来了但 worker 不干活"

九成是 `.env` 里 LLM / TTS / S3 / Pexels 哪个 key 错了。
先看 worker 日志：

```bash
docker compose --profile app logs --tail=200 worker-ffmpeg
```

具体 key 有问题时日志里都有。

### "任务卡在 18% 不动了"

`LLM_TIMEOUT_MS` 用了默认 `15000`，长文章超时反复重试。
改成 `60000` 或 `90000`，重启 api + worker：

```bash
docker compose --profile app up -d
```

### "首次构建特别慢"

正常。FFmpeg 静态二进制 + Next.js standalone 构建第一次都得拉东西。
之后改代码再 `up -d --build`，因为 Docker 层缓存，会快很多。

### "VPS 磁盘满了"

最常见两个元凶：

- `/tmp/vgs-media-cache`：Pexels 素材缓存，默认上限 20GB（`MEDIA_CACHE_MAX_BYTES`）
- 旧 Docker 镜像 / 容器 / volume

清理：

```bash
docker system prune -af              # 清未使用的镜像和容器
docker volume prune -f               # 清未使用的 volume（注意别清掉 redis-data）
```

### "VPS 访问 OpenAI / Claude 不通"

- 国内 VPS 直接走 OpenAI 大概率不行，换成 GLM / Kimi / 走 OpenAI 兼容代理
- 改 `LLM_PROVIDER` + 对应的 `*_BASE_URL` 即可，不用动代码

### "上传素材报 413 / 文件过大"

如果挂了 Nginx，加上 `client_max_body_size 600M;`（或更大），并重启 nginx。
直连 3005 不会有这个问题，限制走的是 `MAX_MATERIAL_FILE_SIZE_MB`。

---

## 附：相关文件速查

- `docker-compose.yml`：编排定义
- `Dockerfile.api` / `Dockerfile.worker-ffmpeg` / `Dockerfile.web`：3 个镜像的 Dockerfile
- `scripts/deploy-remote.sh`：服务器侧的解包 + 启动脚本（GitHub Actions 也是调它）
- `.github/workflows/deploy.yml`：自动部署 workflow
- `.env.example`：所有配置项的样例 + 注释

跑通之后就别频繁动它了，能跑就别折腾 —— 这是部署的最高心法。

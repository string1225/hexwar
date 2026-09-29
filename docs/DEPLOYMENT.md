# 微信与服务器部署

## 地址与路径

统一域名为 `www.sunny-string.cn`，使用 HTTPS。游戏命名空间为 `/wechat/game/hexwar/`，为后续其他游戏保留 `/wechat/game/` 下的独立路径。

| 内容 | 路径 |
| --- | --- |
| 浏览器试玩 | `https://www.sunny-string.cn/wechat/game/hexwar/` |
| 服务健康状态 | `/wechat/game/hexwar/api/health` |
| 微信登录 | `POST /wechat/game/hexwar/api/auth/wechat` |
| 云存档读取 / 备份 | `GET / PUT /wechat/game/hexwar/api/save` |
| SSH | `aliyun-139` → `139.224.12.141`，用户 `junte` |
| 当前代码 | `/opt/hexwar/current`，指向 `releases/<时间戳>` |
| 服务 | `hexwar.service`，独立系统用户 `hexwar` |
| 监听 | `127.0.0.1:3041`，由现有 HTTPS Nginx 反代 |
| SQLite | `/var/lib/hexwar/game.sqlite`，WAL 模式 |
| 服务器环境 | `/etc/hexwar/server.env`，目录 700、文件 600，root 管理 |

## 凭据

客户端只包含 AppID 和 API 地址。App Secret 仅由服务端读取，用于 `api.weixin.qq.com/sns/jscode2session` 交换登录 code。服务端不返回或记录 App Secret、微信 session_key、原始 OpenID；数据库以 AppID + OpenID 的哈希隔离用户。

上传密钥留在操作者本机，`wechat-ci.local.json` 引用绝对路径；本地配置、私钥、环境文件、数据库及二维码均已忽略，不提交 Git。

预览和上传默认通过临时 SSH 隧道使用 139 的出口 IP。CONNECT 中继只监听两端的 `127.0.0.1:18941`，仅允许微信 CI 官方域名的 443 端口，命令退出后关闭，不新增公网端口，签名密钥不离开本机。若开启微信公众平台「开发管理 → 开发设置 → 小程序代码上传」IP 白名单，需加入 `139.224.12.141`；request 合法域名和服务器 API 白名单不能替代此设置。

若上传白名单已关闭，或当前电脑出口已加入上传白名单，可以构建后直接执行 `node scripts/wechat-ci.cjs preview` / `upload`。SSH 方式分别对应 `node scripts/wechat-via-ssh.mjs preview` / `upload`，两个命令不要同时执行（使用固定隧道端口）。

配置服务器环境文件（格式见 `server/.env.example`），保存于仓库外，然后运行：

```sh
node scripts/provision-server.mjs /absolute/path/to/server.env
```

该脚本通过 SSH 标准输入传输配置，服务器原子替换 root 专用文件；凭据不进入命令行参数、发布归档或 Web 目录。修改后运行部署或重启服务使环境生效。

## 发布

```sh
npm ci
npm run check
npm run wechat:check
npm run deploy
npm run wechat:upload
npm run wechat:preview
```

`deploy` 仅打包 Web 构建、服务代码、共享规则和部署模板，不向服务器安装开发依赖。创建版本目录，保留旧版本；备份 Nginx / systemd 配置，校验 `nginx -t`，重启独立服务并检查回环健康状态后 reload Nginx。现有站点和 `/meeting/` 路由保留。

Nginx 安装脚本针对当前服务器的 `sunny-string.conf` HTTPS include 位置进行一次性接入。如果配置结构已改变，脚本会报错停止，需先查看服务器配置再调整。修改 SSH 目标可使用 `HEXWAR_SSH_HOST`，当前部署目录按 `junte` 用户设计。

## 云存档协议

微信小游戏通过 `wx.login` 获取一次性 code，服务端向微信换取身份，签发随机 256 位会话令牌。数据库只保存令牌哈希，7 天过期，同一账号最多保留 5 个活跃会话。令牌仅存在小游戏当前进程内存；下次启动重新登录。

所有存档请求使用 `Authorization: Bearer <token>`。`GET /save` 返回 `{state, revision, savedAt}`；首次返回 `state: null, revision: 0`。`PUT /save` 发送 `{state, revision}`，服务端检查共享游戏状态格式，再在 SQLite 事务内比较版本；版本不一致返回 409，防止另一设备的新备份被静默覆盖。

打开「云存档」先读取远端版本，不覆盖本地进度。用户可选择「备份当前」或「读取云端」，界面明确提示其覆盖方向。读取云端会验证存档格式并恢复 AI 轮转。此功能是单人战役备份，不是服务器权威战斗或反作弊排行榜。

接口限制 JSON 请求体为 192 KiB；登录按来源 IP 每分钟 20 次，存档 120 次。API 响应禁止缓存。端口不对公网开放，Nginx 重写真实客户端 IP。没有收集昵称、头像或手机号。

## 运维与回滚

```sh
sudo systemctl status hexwar
sudo journalctl -u hexwar --since '10 minutes ago' --no-pager
curl --fail https://www.sunny-string.cn/wechat/game/hexwar/api/health
```

回滚时，将 `/opt/hexwar/current` 符号链接重新指向确认过的旧 `releases/<时间戳>`，然后 `sudo systemctl restart hexwar`。SQLite 独立于版本目录，代码回滚不会删除存档。Nginx 配置备份保存在 `/opt/hexwar/backups/<时间戳>/`；数据库备份应使用 SQLite backup API 或先停止服务复制数据库及 WAL 文件。

`miniprogram-ci@2.1.31` 与参考项目一致，是本次查询时 npm 发布的最新版本。其传递开发依赖存在 npm 审计告警；它只用于构建机上传工具，未打入小游戏 / 网页，也未安装到后端服务。生产运行时没有第三方 npm 依赖。

微信 CI 上传只产生开发版本，预览二维码只用于有权限账号的扫码验收，不代表已提审、已发布或已经过真机测试。

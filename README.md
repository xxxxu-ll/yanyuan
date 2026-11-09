# 像素燕园 · Yanyuan

一个多人在线的像素校园网页游戏：在未名湖边散步、认识校园猫、和朋友一起逛北大。

- **在线游玩**：<https://xxxxu-ll.github.io/yanyuan/>
- **世界服务**：`https://yanyuan-world.yanyuan-pku.workers.dev`（Cloudflare Worker + Durable Object）
- **性质**：非官方学生作品，与北京大学无隶属关系
- **许可**：代码 MIT；地图数据 ODbL（© OpenStreetMap contributors），详见 [`yanyuan/ATTRIBUTION.md`](yanyuan/ATTRIBUTION.md)

---

## 1. 现在能玩什么

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 整个燕园室外地图 | ✅ | 333 栋建筑、510 段道路、14 处水面、66 块绿地、12 片体育场地、8 个校门、33 处文物点 |
| 角色创建 | ✅ | 昵称、肤色、6 种发型、8 种发色、8 种上衣、6 种裤子、4 种鞋、5 种配饰、可选院系/年级/签名 |
| 服务端存档 + 恢复码 | ✅ | 换设备用恢复码登录，服务端只存 SHA-256 哈希；HUD 显示「已保存/待同步/保存中/未保存·重试」，失败自动退避重试、关页面 keepalive 补发、下次进入自动补传本机草稿 |
| 移动 | ✅ | 电脑 WASD/方向键 + Shift 跑 + B 骑车；手机虚拟摇杆 + 触屏按钮 |
| 碰撞 | ✅ | 建筑、水面不可穿过；桥面可通行；出生点已验证不卡墙 |
| 导航 | ✅ | 每个地标预计算「最近可达点」（图书馆偏移 50m），导航终点落在门口而不是楼中心；到达判定 8m；探索按可达点判定 |
| 多人同屏 | ✅ | 轮询同步（约 1.1s），可见彼此位置、朝向、外观、昵称、骑车状态 |
| 玩家互动 | ✅ | 点附近的人弹出名片（院系/年级/签名/像素头像），可挥手（服务端记录，对方收到提示+动画）、合影（照片署名）、跟随（目的地实时跟着对方） |
| 文字聊天 | ✅ | 全校公共频道，120 字上限、2 秒冷却、服务端按身份署名 |
| 小地图 / 全图 | ✅ | 全图可拖动缩放、地标搜索、点击设目的地、屏幕边缘方向指示 |
| 探索记录 | ✅ | 靠近地标自动记录，显示「探索 x/305」 |
| 地点内容 | ✅ | 19 处地点有故事、观察细节与一个动作（西门、博雅塔、图书馆、百讲、未名湖、石舫、钟亭、静园、燕南园、湖心岛、办公楼、五四体育场、农园、学一、二体、临湖轩、勺园、邱德拔、朗润园） |
| 前五分钟引导 | ✅ | 首次进入三个可选邀请（跟猫/去湖边拍照/经典路线），完成后得印章；可跳过且不再打扰 |
| 校园猫 | ✅ | 10 只原创猫，各有作息（有的只在傍晚出现）、性格（陪走型/怕生型/爱睡型）与好感机制 |
| 拍照 | ✅ | 生成带地点/时间/印章的 PNG 并下载，可署名为「与某某一起」 |
| 昼夜与灯光 | ✅ | 按真实时间色调变化；夜间路灯与窗户亮灯 |
| 成就与称号 | ✅ | 14 个成就，解锁时提示并写入存档；步行/骑行里程正确计入 |
| 输入焦点 | ✅ | 打字时只处理文字，弹窗打开时只处理弹窗，Esc 关闭，不再误触快捷键 |
| 离线漫游 | ✅ 降级 | 后端不可达时可进校园走走，明确标注「不保存、看不到其他玩家」，并显示原因与重试按钮 |

**尚未实现**（不在当前版本里，也不会有假入口）：好友/私聊/组队、表情动作、个人房间与家具、玩家活动与社团、幻想精灵养成与战斗、建筑室内、雨雪与季节、其他校区。

---

## 2. 本地运行

需要 Node.js ≥ 22（用到内置 `node:sqlite`）。不需要 npm install，无第三方依赖。

```bash
# 1) 重建地图数据（可选，data/map.json 已生成）
python yanyuan/tools/build_map.py

# 2) 启动本地世界服务 + 静态站点
node yanyuan-api/server/dev-server.mjs
#   游戏： http://127.0.0.1:8787/yanyuan/
#   API ： http://127.0.0.1:8787/api/health
```

本地前端默认走同源 `/api`（见 `yanyuan/src/api-base.js`），无需配置。

### 测试

```bash
# 世界服务 API（16 项：身份、存档隔离、多人可见、聊天、限流、CORS）
node --test yanyuan-api/tests/api.test.mjs

# 打包后的 Worker 产物（3 项，用 SQLite 模拟 Durable Object）
node yanyuan-api/build.mjs
node --test yanyuan-api/tests/worker.test.mjs

# 真实浏览器端到端（28 项：双浏览器互见、聊天、刷新续玩、恢复码、越权、碰撞、手机）
node yanyuan/tools/e2e.mjs
GAME_URL=https://xxxxu-ll.github.io/yanyuan/ node yanyuan/tools/e2e.mjs   # 打线上
```

---

## 3. 部署

### 前端（GitHub Pages）

```bash
node yanyuan-api/deploy/publish-pages.mjs
```

该脚本会：拷贝 `yanyuan/` 到 `pages-repo/yanyuan/` → 注入 `src/api-base.js` 的 `API_BASE` 与构建号 → 提交并推送 `main` → 轮询 Pages 构建 → 校验线上地址与资源。

Pages 设置：`main` 分支根目录，因此游戏在 `/yanyuan/` 子路径下，首页与原有功能不受影响。

### 后端（Cloudflare Workers + Durable Object）

```bash
node yanyuan-api/deploy/cf-deploy.mjs
```

凭证放在 `.secrets/deploy.env`（已被 `.gitignore` 忽略，永不提交）：

```
CLOUDFLARE_API_TOKEN=...        # Workers Scripts:Edit + Account Settings:Read
# 或
CLOUDFLARE_API_KEY=...          # Global API Key
CLOUDFLARE_EMAIL=...
```

脚本会：确认账号 → 申请 `workers.dev` 子域 → 上传 Worker（含 Durable Object 迁移）→ 打开 workers.dev 路由 → 健康检查 → 写 `dist/deployed.json`。

> 存储用 **Durable Object 内置 SQLite**，不需要 D1，免费计划即可。原因：单写者保证世界状态一致，且免去 D1 迁移与配额。

---

## 4. 目录结构

```
yanyuan/                    前端（无构建步骤，原生 ES Module + Canvas 2D）
  index.html
  src/
    main.js                 启动流程：加载地图 → 连接世界 → 捏人/恢复 → 进入
    game.js                 主循环：移动、碰撞、镜头、同步、互动、地图、拍照
    render.js               地面区块缓存、建筑伪立体、树木、水面、昼夜灯光
    sprites.js              程序化像素精灵（角色四向行走、猫、名牌）
    mapdata.js              地图装载、空间网格碰撞、树木/路灯生成、地标检索
    minimap.js              小地图、全图（拖动/缩放/搜索/目的地）
    net.js                  世界服务客户端（超时、重试、错误分类）
    progress.js             探索/猫关系/成就/统计 + 节流存档
    cats.js                 10 只原创校园猫的设定
    photo.js                拍照合成与下载
    ui.js / style.css       界面
  data/map.json             游戏地图（由 tools/build_map.py 生成）
  tools/                    build_map.py、CDP 端到端测试、截图脚本
  ATTRIBUTION.md            数据来源与许可

yanyuan-api/                后端
  src/core.mjs              世界逻辑（路由、校验、限流、存档），与运行时无关
  worker/glue.mjs           Worker 入口（CORS、转发到 DO）
  worker/world.mjs          Durable Object（SQLite 存储）
  server/dev-server.mjs     本地等价服务（node:sqlite）+ 静态文件
  migrations/0001_init.sql  表结构
  tests/                    API 测试、Worker 产物测试
  build.mjs                 拼装单文件 Worker
  deploy/                   Cloudflare 部署、GitHub Pages 发布
```

---

## 5. 设计要点

- **身份**：注册时生成 20 位十六进制随机凭证（80 bit），即「恢复码」；服务端只存 `SHA-256`，请求用 `Authorization: Bearer` 校验。没有邮箱注册，也没有明文凭证。
- **存档隔离**：所有写接口只能改自己那一行；`/session` 只返回本人的角色与进度；同步接口只返回公开字段（id/昵称/外观/坐标/朝向）。
- **输入校验**：昵称 2–12 字且过滤控制符与 `<>\/`；外观字段白名单夹取；聊天 120 字、2 秒冷却；坐标夹在世界范围内并做单次位移上限；进度是白名单结构，超过 8KB 直接拒绝。
- **安全渲染**：聊天与昵称一律 `textContent` / `escapeHtml`，不会把用户输入当 HTML 插入。
- **单写者**：所有 API 请求都进入同一个 Durable Object，玩家位置、聊天、存档只有一个写入点，避免多实例漂移。
- **失败可见**：同步失败会弹「与世界的连接中断，正在重连…」，恢复后提示已重连；存档失败提示稍后重试；撤销身份时提示用恢复码重新登录。

---

## 6. 已知限制

- 地图几何来自 OSM + 公开影像配准，**不是测绘数据**；建筑高度多为推算值，游戏内还做了视觉压缩。详见 `ATTRIBUTION.md`。
- 可行走范围包含校园边界外的蔚秀园、畅春园等相邻园区；跨市政道路的过程被抽象掉。
- 树木、花、路灯是**程序化装饰**，不对应校园里真实的每一棵树。
- 同步是 1.1 秒轮询，不是 WebSocket，人物移动会有轻微延迟与插值。
- 校园猫是原创设定角色，**不是真实校园猫**的记录。
- `*.workers.dev` 在**中国大陆被 DNS 污染**（阿里/腾讯/114 都返回假地址），浏览器解析不到 Cloudflare，表现为「世界服务连不上、只能离线漫游」。这是域名级封锁，与代码无关。解决办法是给 Worker 绑定一个自有域名：
  ```bash
  node yanyuan-api/deploy/attach-domain.mjs --add  example.com   # 打印需要修改的 NS
  node yanyuan-api/deploy/attach-domain.mjs --bind example.com   # NS 生效后绑定并切换前端
  node yanyuan-api/deploy/publish-pages.mjs
  ```
- Durable Object 免费额度：10 万请求/天量级，足够几十人同时在线；超出后需要在 Cloudflare 后台调整。

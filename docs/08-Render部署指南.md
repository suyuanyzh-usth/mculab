# 用 Render 部署（免费/低价、地址固定、电脑不用开）

> 目标：拿到一个形如 `https://mcu-lab.onrender.com` 的**固定地址**，
> 服务跑在云端容器里，关掉你的电脑也不影响学生访问。
>
> 全过程约 40–60 分钟，其中只有"注册账号"和"点几下按钮"需要你操作。

---

## 阶段 0：前置条件（先确认，缺一不可）

| 需要 | 说明 | 检查方式 |
|---|---|---|
| GitHub 账号 | Render 从 Git 仓库拉代码 | 能登录 github.com 即可 |
| Render 账号 | 用 GitHub 账号直接登录，免注册 | 见阶段 2 |
| 本机 git | 用来把代码推到 GitHub | 终端执行 `git --version` |
| 一张银行卡（可选） | 只有选付费方案时用 | 免费方案不需要 |

> **重要前置判断**：本项目**不能**在 Render 免费方案上长期使用。
> 免费实例**没有持久磁盘**，每次重启/重新部署，`/app/data` 会被清空 —— 学生账号、成绩会全部丢失。
> 正式用请选 **Starter（约 $7/月）+ 1GB Disk（约 $0.25/月）**。免费方案只适合先跑通看效果。

---

## 阶段 1：把代码推到 GitHub（约 15 分钟）

### 1.1 目标

得到形如 `https://github.com/你的用户名/mculab` 的仓库，且**仓库体积 < 20MB**
（`toolchain/` 294MB 与 `data/` 53MB 必须排除，仓库里已备好 `.gitignore`）。

### 1.2 操作位置：本机终端（Windows 用 Git Bash）

```bash
cd /c/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab

# ① 确认 .gitignore 生效：这一行的输出里不应出现 toolchain/ 和 data/
git init
git add .
git status --short | head -20
```

**检查点**：`git status` 里**不应出现** `toolchain/`、`data/`、`cloud/`。
如果出现了，说明 `.gitignore` 没生效，先停下排查，否则推送会因体积过大失败。

```bash
# ② 提交
git commit -m "MCU Lab: 教学仿真实验平台（首次部署）"

# ③ 到 github.com 新建一个空仓库（不要勾选 README/.gitignore），假设名为 mculab
git branch -M main
git remote add origin https://github.com/你的用户名/mculab.git
git push -u origin main
```

### 1.3 完成标志

打开 GitHub 仓库页面，能看到 `Dockerfile`、`server/`、`public/`，
**看不到** `toolchain/`、`data/`。

---

## 阶段 2：在 Render 创建 Web Service（约 10 分钟）

### 2.1 目标

让 Render 用仓库里的 `Dockerfile` 构建镜像并跑起来，分配一个 `.onrender.com` 域名。

### 2.2 操作位置：<https://dashboard.render.com>

1. 点 **Sign in with GitHub** 登录（授权访问你的仓库）；
2. 右上角 **New +** → **Web Service**；
3. 选择你刚推的仓库 `mculab` → **Connect**；
4. 填写配置：

| 配置项 | 填什么 | 为什么 |
|---|---|---|
| **Name** | `mcu-lab`（决定域名，可改） | 最终地址形如 `https://mcu-lab.onrender.com` |
| **Region** | 选离学校近的（如 Singapore） | 降低延迟 |
| **Language / Runtime** | **Docker**（识别到 Dockerfile 时会自动选中） | 镜像里装了 SDCC 编译器 |
| **Branch** | `main` | |
| **Instance Type** | 先选 **Free** 试跑；正式用选 **Starter** | 免费实例会休眠且无持久磁盘 |
| **Health Check Path** | `/api/health` | Render 靠它判断服务是否活着 |

5. **Environment Variables** 里加一条：

| Key | Value |
|---|---|
| `MCULAB_TEACHER_PWD` | 你的教师初始密码（**别用 teacher123**） |

> `PORT` 不用填：Render 会自动注入，本应用读的就是它。

### 2.3 点 **Create Web Service**

第一次构建约 3–6 分钟（要 `apt install sdcc` 并做编译自检）。
**构建失败会明确报错**，不会出现"看起来部署成功但跑不起来"。

### 2.4 完成标志

日志末尾出现：

```
微控制器原理及应用 · 教学仿真实验平台
 监听地址     : 0.0.0.0:10000
 SDCC 工具链  : 可用 SDCC : mcs51/...
```

页面顶部状态变成 **Live**，点域名能打开登录页。

---

## 阶段 3：验收（约 5 分钟）

### 3.1 用核查工具

在**本机**执行（把域名和密码换成你的）：

```bash
cd /c/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab
node tools/verify_deploy.mjs "https://mcu-lab.onrender.com/" 你的密码
```

### 3.2 判定标准

必须出现 **"判定为新版本 6/6 项能力就绪"** 和 **"云端 C 编译器可用"**。
若编译器那一项显示不可用，去看 Render 构建日志里 `SDCC 链路自检通过` 是否出现。

### 3.3 手工验证三条关键链路

| 链路 | 怎么验 |
|---|---|
| 在线编译 | 登录 → 载入任一实验起始代码 → 编译，应产出 HEX |
| AI 答疑 | 教师后台配 DeepSeek 密钥 → 答疑页提问，回答不应是"离线助教模式"开头 |
| 数据写入 | 教师后台导入一个学生 → 刷新页面，学生仍在 |

---

## 阶段 4：数据持久化（正式使用必做）

### 4.1 为什么必须做

免费实例的文件系统是**临时的**：重新部署、重启、休眠唤醒都可能清空 `/app/data`。
学生的账号、练习记录、成绩都在这个目录下的 `mculab.db` 里。

### 4.2 操作位置：Render 服务页 → **Disks** → Add Disk

| 配置项 | 填什么 |
|---|---|
| Name | `mculab-data` |
| Mount Path | `/app/data` ← **必须完全一致** |
| Size | 1 GB 足够（约 100 名学生一学期远用不到） |

> 挂载路径必须与镜像里的 `MCULAB_DATA=/app/data` 一致，否则数据仍会丢。
> 创建磁盘后 Render 会重启一次实例，属正常。

### 4.3 验证持久化

导入一个学生 → 在 Render 面板点 **Manual Deploy → Restart** → 刷新页面看学生是否还在。

---

## 阶段 5：以后怎么更新代码

```bash
cd /c/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab
git add -A
git commit -m "说明这次改了什么"
git push
```

Render 检测到推送会**自动重新部署**（约 3–6 分钟）。
由于挂了磁盘，重新部署**不会**丢数据。

---

## 阶段 6：常见问题

| 现象 | 原因与处理 |
|---|---|
| 构建失败，日志里有 `stc89.h` 相关错误 | 镜像里发行版头文件有问题；本仓库 Dockerfile 已用 `platform/include/stc89.h` 覆盖，确认你的仓库包含该文件 |
| 构建卡在 `apt-get update` | 网络问题，重新部署一次 |
| 部署成功但打开是 502 | 服务没监听 `PORT`；本应用已适配，检查日志里的"监听地址"是否为 `0.0.0.0:xxxx` |
| 免费实例第一次访问要等 1 分钟 | 免费方案 15 分钟无请求会休眠，属正常；正式用请升级 Starter |
| 学生数据重置了 | 没挂磁盘，或挂载路径不是 `/app/data` |
| 编译报"未找到可用的 SDCC" | 镜像构建时 apt 安装失败，看构建日志 |
| AI 一直走离线助教 | 教师后台未配 DeepSeek 密钥（云端不再提供内置模型，这是自建部署） |

---

## 成本与候选方案对比

| 方案 | 月成本 | 地址固定 | 电脑需开机 | 数据持久 |
|---|---|---|---|---|
| Render 免费 | 0 | ✅ | ❌ | ❌（会清空） |
| **Render Starter + 1GB Disk** | **≈ $7.3** | ✅ | ❌ | ✅ |
| 国内云主机 + Docker | ≈ ¥30–60 | ✅（需域名） | ❌ | ✅ |
| Cloudflare 隧道（当前临时方案） | 0 | ❌ 每次变 | ✅ 需要 | ✅ |

> 如果校内已有 Linux 服务器，直接用 `docs/07-自建上线清单.md` 的路线 A，
> 成本更低、数据完全自主，比 Render 更合适。

---

## 2026-11-06 23:05 · 部署完成记录

| 项目 | 结果 |
|---|---|
| 代码仓库 | `https://github.com/suyuanyzh-usth/mculab`（Public，main 分支） |
| 线上地址 | **https://mcu-lab.onrender.com** |
| 站点状态 | HTTP 200，浏览器实测 3.6 秒加载，0 控制台报错 |
| 新版本判定 | `/js/ui/view-open.js`、`view-grade.js`、`view-manage.js` 均 200；六项接口全部 401（存在，需登录） |
| C 编译器 | `sdccUsable: true` —— 说明 Dockerfile 里"用修正版 stc89.h 覆盖发行版"这一步生效了 |
| 登录页 | 三个页签（登录/学生注册/教师注册）正常渲染，底部显示"工具链：SDCC 已就绪" |

### 部署踩过的两个小坑

1. **分支名**：本机 `git init` 默认建的是 `master`，直接 `git push origin main` 报
   `src refspec main does not match any`。执行 `git branch -M main` 后正常。
2. **换行符**：Windows 上 `core.autocrlf=true`，仓库内存的是 LF，所以 Dockerfile 里
   没有 CR，Docker 构建不会因 `\r` 失败。已在提交后核对 `git show HEAD:Dockerfile | grep -c $'\r'` = 0。

### 上线后必须做的三件事

1. **挂磁盘**：免费实例没有持久磁盘，重新部署会清空 `/app/data`（学生账号、成绩）。
   正式使用需 Starter 实例 + 1GB Disk，挂载路径 **`/app/data`**。
2. **配 AI 密钥**：自建域名下云服务内置模型不可用（Origin 不匹配，代码会静默跳过），
   AI 会走服务端模型，必须在教师后台配 DeepSeek 密钥，否则是离线模板回答。
3. **注意休眠**：免费实例 15 分钟无请求会休眠，学生首次打开约等 50 秒。

# ==================================================================
# MCU Lab —— 生产镜像（Docker / Render / Railway 通用）
# ------------------------------------------------------------------
# 设计要点：
#   1. 基础镜像 node:22-bookworm-slim；SDCC 走 Debian 官方包（apt），
#      不把 Windows 版工具链塞进镜像（跑不了，还白占 294MB）。
#   2. **修正发行版头文件**：Debian 的 sdcc 4.2.0 自带 stc89.h 有 3 处错误
#      （0xNNNH 后缀、RCAP2L 重复声明 4 次、WDT_CONTR 地址写成 0xC1），
#      直接用会导致所有 #include <stc89.h> 的学生程序编译失败。
#      因此用仓库里修正过的 platform/include/stc89.h 覆盖镜像内那份。
#   3. 自检放在 COPY 之后：这样校验的是"真正会跑起来的那套文件"，
#      而不是裸的 apt 安装结果。任何一处不对，镜像构建当场失败。
#   4. 纯 Node 应用、无 npm 依赖，不需要 npm install。
#   5. /app/data 存学生数据，生产环境请挂卷/挂持久磁盘。
#
# 构建：docker build -t mculab .
# 运行：docker run -d -p 8080:8080 -v mculab-data:/app/data --name mculab mculab
# ==================================================================
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    MCULAB_DATA=/app/data

# SDCC：8051 C 编译器 + packihx（Intel HEX 规范化）
RUN apt-get update \
 && apt-get install -y --no-install-recommends sdcc \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 只复制运行必需的目录（见 .dockerignore）
COPY package.json ./
COPY server ./server
COPY public ./public
COPY platform ./platform
COPY tools ./tools
COPY README.md ./

# ---- 用修正版头文件覆盖发行版自带的那份（必须先于自检）----
RUN set -eux; \
    if [ -f /usr/share/sdcc/include/mcs51/stc89.h ]; then \
      cp /app/platform/include/stc89.h /usr/share/sdcc/include/mcs51/stc89.h; \
      echo "已替换 stc89.h"; \
    else \
      echo "警告：未找到 /usr/share/sdcc/include/mcs51/stc89.h"; \
      find /usr -name 'stc89.h' -maxdepth 6 2>/dev/null || true; \
    fi

# ---- 构建期自检：整条链路必须真的能产出合法 HEX，否则镜像构建失败 ----
# 特别覆盖：stc89.h 可用、T2MOD/RCAP2L 等寄存器可解析、packihx 输出合法 EOF
RUN set -eux; \
    sdcc --version | head -1; \
    command -v packihx; \
    printf '#include <stc89.h>\nvoid main(void){ P1 = 0xFE; T2MOD = 0x00; RCAP2L = 0x00; while(1); }\n' > /tmp/t.c; \
    sdcc -mmcs51 --model-small --stack-auto --iram-size 128 --code-size 8192 \
         --std-c11 --opt-code-speed -o /tmp/t.ihx /tmp/t.c; \
    packihx /tmp/t.ihx > /tmp/t.hex; \
    grep -q ':00000001FF' /tmp/t.hex; \
    echo "SDCC 链路自检通过"; \
    rm -f /tmp/t.c /tmp/t.ihx /tmp/t.hex

# 非 root 运行；data 目录需要可写
RUN mkdir -p /app/data \
 && chown -R node:node /app/data \
 && chmod -R o+rX /app

USER node

EXPOSE 8080

# 健康检查用 node 自身，无需额外装 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

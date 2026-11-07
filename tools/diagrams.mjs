/**
 * diagrams.mjs — 手册用的矢量插图（内嵌 SVG）
 * ------------------------------------------------------------------
 * 说明：以 inline SVG 形式嵌入 HTML，经 Edge 打印成 PDF 后仍是矢量，
 * 放大不虚、黑白打印也不会糊成一片。
 * 配色按"组件类型/阶段"分配，浅色底保证灰度打印可区分。
 */

export const archSvg = `<svg viewBox="0 0 680 372" width="100%" role="img" xmlns="http://www.w3.org/2000/svg">
<title>软件架构图</title>
<desc>蓝白多色架构图：前端蓝、服务端青绿紫、数据灰、外部橙，仿真内核实心蓝突出。</desc>
<defs>
<marker id="mA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</marker>
</defs>

<rect x="40" y="40" width="192" height="28" rx="14" fill="#2F6DB5"/>
<text x="136" y="54" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">客户端（浏览器）</text>

<rect x="268" y="40" width="216" height="28" rx="14" fill="#2A8C8C"/>
<text x="376" y="54" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">服务端（Node.js 22）</text>

<rect x="520" y="40" width="120" height="28" rx="14" fill="#5C6B7A"/>
<text x="580" y="54" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">数据与外部</text>

<rect x="40" y="84" width="192" height="52" rx="6" fill="#EAF2FB" stroke="#2F6DB5" stroke-width="1.4"/>
<text x="136" y="102" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#12345A" text-anchor="middle" dominant-baseline="central">视图层</text>
<text x="136" y="120" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#4A6B8A" text-anchor="middle" dominant-baseline="central">题目·编辑·报告·答疑</text>

<rect x="40" y="150" width="192" height="52" rx="6" fill="#2F6DB5" stroke="#1B4F8C" stroke-width="1.4"/>
<text x="136" y="168" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">仿真内核</text>
<text x="136" y="186" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#D6E6F7" text-anchor="middle" dominant-baseline="central">本地执行，不经服务端</text>

<rect x="40" y="216" width="192" height="52" rx="6" fill="#EAF2FB" stroke="#2F6DB5" stroke-width="1.4"/>
<text x="136" y="234" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#12345A" text-anchor="middle" dominant-baseline="central">原理图与仪器</text>
<text x="136" y="252" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#4A6B8A" text-anchor="middle" dominant-baseline="central">编辑·连线·波形</text>

<rect x="268" y="84" width="216" height="52" rx="6" fill="#E4F3F4" stroke="#2A8C8C" stroke-width="1.4"/>
<text x="376" y="102" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#0F4F4F" text-anchor="middle" dominant-baseline="central">API 与会话</text>
<text x="376" y="120" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#3F7373" text-anchor="middle" dominant-baseline="central">路由·鉴权·静态资源</text>

<rect x="268" y="150" width="216" height="52" rx="6" fill="#EAF4E4" stroke="#4E8B3A" stroke-width="1.4"/>
<text x="376" y="168" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#2E5222" text-anchor="middle" dominant-baseline="central">编译服务</text>
<text x="376" y="186" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#5A7A4A" text-anchor="middle" dominant-baseline="central">API 调用·SDCC 子进程</text>

<rect x="268" y="216" width="216" height="52" rx="6" fill="#F0EBFA" stroke="#6B4FA8" stroke-width="1.4"/>
<text x="376" y="234" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#3A2A63" text-anchor="middle" dominant-baseline="central">大模型网关</text>
<text x="376" y="252" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#6B5B8A" text-anchor="middle" dominant-baseline="central">统一协议·密钥保管</text>

<rect x="520" y="84" width="120" height="52" rx="6" fill="#EFF2F6" stroke="#5C6B7A" stroke-width="1.4"/>
<text x="580" y="102" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#2F3A45" text-anchor="middle" dominant-baseline="central">SQLite</text>
<text x="580" y="120" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#5C6B7A" text-anchor="middle" dominant-baseline="central">单文件存储</text>

<rect x="520" y="150" width="120" height="52" rx="6" fill="#FDF0E3" stroke="#B9701F" stroke-width="1.4"/>
<text x="580" y="168" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#6E3F0E" text-anchor="middle" dominant-baseline="central">SDCC 4.x</text>
<text x="580" y="186" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#8A6330" text-anchor="middle" dominant-baseline="central">C 编译器</text>

<rect x="520" y="216" width="120" height="52" rx="6" fill="#FDF0E3" stroke="#B9701F" stroke-width="1.4"/>
<text x="580" y="234" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#6E3F0E" text-anchor="middle" dominant-baseline="central">大模型 API</text>
<text x="580" y="252" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#8A6330" text-anchor="middle" dominant-baseline="central">OpenAI 协议</text>

<line x1="236" y1="110" x2="266" y2="110" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mA)"/>
<text x="251" y="100" font-family="Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#1B4F8C" text-anchor="middle">HTTP</text>

<line x1="486" y1="110" x2="518" y2="110" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mA)"/>
<text x="502" y="100" font-family="Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#1B4F8C" text-anchor="middle">读写</text>

<line x1="486" y1="176" x2="518" y2="176" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mA)"/>
<text x="502" y="166" font-family="Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#1B4F8C" text-anchor="middle">子进程</text>

<line x1="486" y1="242" x2="518" y2="242" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mA)"/>
<text x="502" y="232" font-family="Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#1B4F8C" text-anchor="middle">调用</text>

<rect x="40" y="288" width="600" height="62" rx="6" fill="#F4F9FF" stroke="#9CC3E8" stroke-width="1"/>
<rect x="40" y="288" width="5" height="62" rx="2.5" fill="#2F6DB5"/>
<text x="60" y="308" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#12345A" dominant-baseline="central">设计要点：仿真在浏览器本地执行，服务端只承担编译与鉴权</text>
<text x="60" y="330" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#4A6B8A" dominant-baseline="central">这是百人同时在线仍能流畅使用的关键；编译与模型调用按需远程，其余全部在本地完成</text>
</svg>`;

export const flowSvg = `<svg viewBox="0 0 680 358" width="100%" role="img" xmlns="http://www.w3.org/2000/svg">
<title>学生实验流程图</title>
<desc>按阶段着色的实验流程：输入蓝、编译绿、仿真青、报告紫、提交实心蓝。</desc>
<defs>
<marker id="mF" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</marker>
</defs>

<rect x="40" y="84" width="132" height="52" rx="6" fill="#EAF2FB" stroke="#2F6DB5" stroke-width="1.4"/>
<text x="106" y="102" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#12345A" text-anchor="middle" dominant-baseline="central">打开实验题目</text>
<text x="106" y="120" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#4A6B8A" text-anchor="middle" dominant-baseline="central">选择实验</text>

<rect x="196" y="84" width="132" height="52" rx="6" fill="#EAF2FB" stroke="#2F6DB5" stroke-width="1.4"/>
<text x="262" y="102" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#12345A" text-anchor="middle" dominant-baseline="central">编写或修改代码</text>
<text x="262" y="120" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#4A6B8A" text-anchor="middle" dominant-baseline="central">参照起始代码</text>

<rect x="352" y="84" width="132" height="52" rx="6" fill="#EAF4E4" stroke="#4E8B3A" stroke-width="1.4"/>
<text x="418" y="102" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#2E5222" text-anchor="middle" dominant-baseline="central">在线编译</text>
<text x="418" y="120" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#5A7A4A" text-anchor="middle" dominant-baseline="central">SDCC 编译</text>

<polygon points="574,68 630,110 574,152 518,110" fill="#FFFFFF" stroke="#1B4F8C" stroke-width="1.6"/>
<text x="574" y="110" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#12345A" text-anchor="middle" dominant-baseline="central">编译通过？</text>

<rect x="508" y="204" width="132" height="52" rx="6" fill="#E4F3F4" stroke="#2A8C8C" stroke-width="1.4"/>
<text x="574" y="222" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#0F4F4F" text-anchor="middle" dominant-baseline="central">仿真运行</text>
<text x="574" y="240" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#3F7373" text-anchor="middle" dominant-baseline="central">外设状态刷新</text>

<rect x="352" y="204" width="132" height="52" rx="6" fill="#E4F3F4" stroke="#2A8C8C" stroke-width="1.4"/>
<text x="418" y="222" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#0F4F4F" text-anchor="middle" dominant-baseline="central">仪器测量波形</text>
<text x="418" y="240" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#3F7373" text-anchor="middle" dominant-baseline="central">逻辑分析仪</text>

<rect x="196" y="204" width="132" height="52" rx="6" fill="#F0EBFA" stroke="#6B4FA8" stroke-width="1.4"/>
<text x="262" y="222" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#3A2A63" text-anchor="middle" dominant-baseline="central">生成报告草稿</text>
<text x="262" y="240" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#6B5B8A" text-anchor="middle" dominant-baseline="central">AI 起草＋修改</text>

<rect x="40" y="204" width="132" height="52" rx="6" fill="#2F6DB5" stroke="#1B4F8C" stroke-width="1.4"/>
<text x="106" y="222" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">提交与评阅</text>
<text x="106" y="240" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#D6E6F7" text-anchor="middle" dominant-baseline="central">教师打分评语</text>

<line x1="174" y1="110" x2="194" y2="110" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mF)"/>
<line x1="330" y1="110" x2="350" y2="110" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mF)"/>
<line x1="486" y1="110" x2="514" y2="110" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mF)"/>

<line x1="574" y1="154" x2="574" y2="202" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mF)"/>
<text x="586" y="180" font-family="Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#1B4F8C">是</text>

<path d="M574 66 L574 46 L262 46 L262 80" fill="none" stroke="#4A6B8A" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#mF)"/>
<text x="586" y="60" font-family="Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#1B4F8C">否</text>
<text x="418" y="38" font-family="Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#1B4F8C" text-anchor="middle">错误定位到具体行，改完再编译</text>

<line x1="506" y1="230" x2="486" y2="230" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mF)"/>
<line x1="350" y1="230" x2="330" y2="230" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mF)"/>
<line x1="194" y1="230" x2="174" y2="230" stroke="#4A6B8A" stroke-width="1.8" marker-end="url(#mF)"/>

<rect x="40" y="286" width="600" height="54" rx="6" fill="#F4F9FF" stroke="#9CC3E8" stroke-width="1"/>
<rect x="40" y="286" width="5" height="54" rx="2.5" fill="#2F6DB5"/>
<text x="60" y="304" font-family="Microsoft YaHei, sans-serif" font-size="12" font-weight="700" fill="#12345A" dominant-baseline="central">编译失败不中断流程：回到编辑器并定位到出错行号，改完重新编译即可</text>
<text x="60" y="324" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#4A6B8A" dominant-baseline="central">仿真与测量全程在浏览器本地完成，不占用服务端资源</text>
</svg>`;

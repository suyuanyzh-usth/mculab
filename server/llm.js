/*
 * llm.js — 大模型接入（OpenAI 兼容）+ 离线规则助教
 * ==================================================================
 * 两条通路：
 *   ① 大模型（OpenAI 兼容 /chat/completions）——支持任意厂商：
 *      智谱 / 通义 / DeepSeek / Moonshot / 本地 Ollama / vLLM …
 *      密钥只保存在服务端数据库，绝不下发到浏览器。
 *   ② 离线规则助教（LocalTutor）——无需网络与密钥，基于 8051 教学知识库
 *      做代码静态检查与常见错误诊断。校园内网无外网时自动降级到这一路。
 */

export class LLM {
  constructor(db) { this.db = db; }
  get config() {
    return this.db.getJSON('llm', {
      enabled: false, baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini',
      temperature: 0.3, maxTokens: 1200, systemExtra: ''
    });
  }
  save(patch) {
    const c = { ...this.config, ...patch };
    // 密钥留空表示"不修改"
    if (patch && patch.apiKey === '') c.apiKey = this.config.apiKey;
    if (patch && patch.apiKey === '__CLEAR__') c.apiKey = '';
    this.db.setSetting('llm', c);
    return this.publicConfig();
  }
  publicConfig() {
    const c = this.config;
    return {
      enabled: c.enabled, baseUrl: c.baseUrl, model: c.model, temperature: c.temperature,
      maxTokens: c.maxTokens, systemExtra: c.systemExtra,
      hasKey: !!c.apiKey, keyMasked: c.apiKey ? (c.apiKey.slice(0, 3) + '****' + c.apiKey.slice(-3)) : ''
    };
  }

  async chat(messages, opts = {}) {
    const c = this.config;
    if (!c.enabled) throw new Error('大模型未启用，请在教师后台的"AI 设置"中填写接口地址、密钥并勾选启用。');
    if (!c.apiKey && !/localhost|127\.0\.0\.1/.test(c.baseUrl)) throw new Error('尚未配置 API 密钥。');
    const url = c.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const body = {
      model: opts.model || c.model,
      messages,
      temperature: opts.temperature ?? c.temperature,
      max_tokens: opts.maxTokens ?? c.maxTokens,
      stream: false
    };
    /*
     * DeepSeek V4 系列**默认开启思考模式**（effort=high），思维链写在 reasoning_content 里。
     * 长文生成（如实验报告）时，思考会把 max_tokens 吃光，导致 content 为空、
     * finish_reason=length —— 前端拿到一份空白报告。
     * 因此长文场景显式关闭思考：{"thinking":{"type":"disabled"}}。
     * 其它厂商（OpenAI/GLM/Ollama）不认识该字段，只在 DeepSeek 地址下附加。
     */
    const isDeepSeek = /deepseek\.com/i.test(c.baseUrl || '');
    if (isDeepSeek && opts.noThinking) body.thinking = { type: 'disabled' };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs || 60000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: 'Bearer ' + c.apiKey } : {}) },
        body: JSON.stringify(body),
        signal: ac.signal
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error('无法连接大模型服务：' + e.message + '。若处于校园内网，请在教师后台配置内网可达的模型服务（如 Ollama），或依赖离线助教。');
    }
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`大模型返回 ${res.status}：${text.slice(0, 400)}`);
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('大模型返回非 JSON：' + text.slice(0, 200)); }
    const content = j.choices?.[0]?.message?.content
      ?? j.choices?.[0]?.text
      ?? j.data?.[0]?.content
      ?? '';
    const finish = j.choices?.[0]?.finish_reason || '';
    /*
     * 空内容不能当作"成功"返回：调用方会把它当成一份空报告展示给学生。
     * 这里抛错，让上层回退到离线模板，并给出可操作的提示。
     */
    if (!String(content).trim()) {
      const hadReasoning = !!(j.choices?.[0]?.message?.reasoning_content);
      throw new Error(
        hadReasoning
          ? `模型只输出了思考过程，最终内容为空（finish_reason=${finish || '未知'}）。请调大 maxTokens，或保持"关闭思考"设置后重试。`
          : `模型返回了空内容（finish_reason=${finish || '未知'}），请检查模型名称与账户额度。`
      );
    }
    return { content, finish, usage: j.usage || null, model: j.model || body.model, raw: j };
  }
}

/* ================================================================ 提示词 */
export const SYSTEM_TUTOR = `你是一位《微控制器原理及应用》课程的助教，面向本科生，主讲 STC89C52（8051 内核）。
你的职责：
1. 帮助学生定位 C51 代码与硬件连接问题，用启发式提问引导，不要直接代写完整作业代码。
2. 涉及硬件时，必须区分"仿真中能跑"与"实际电路能否工作"，并指出电流、上拉、时序等真实约束。
3. 解释 8051 特有概念时务必准确：准双向 I/O、P0 开漏需上拉、EA 引脚、12T 机器周期（1 机器周期=12 振荡周期）、
   定时器初值计算、TMOD/TCON/SCON 位定义、中断向量地址（INT0=0003H, T0=000BH, INT1=0013H, T1=001BH, 串口=0023H）。
4. 回答用简体中文，条理清晰，代码片段用 Markdown 代码块。
5. 不确定的内容明确说明，不要编造寄存器位定义或电气参数。`;

export const SYSTEM_TEACHER = `你是一位嵌入式教学数据分析专家，帮助高校教师分析《微控制器原理及应用》课程的学生练习数据。
请输出：
1) 学情概览（完成度、卡点题目、活跃度分布）
2) 典型错误聚类（按错误类型分组，给出可能的教学原因）
3) 教学建议（需要补讲的知识点、需要增加/调整的实验）
要求：基于给定数据说话，不要编造未提供的数据；结论要具体可执行；使用简体中文。`;

/* ================================================================ 离线规则助教
 * 不依赖任何外部服务，用规则库做代码/硬件诊断。
 * 覆盖初学者在 8051 上最高频的错误。
 */
export const LocalTutor = {
  RULES: [
    {
      id: 'EA_NOT_SET', re: /(?![^]*\bEA\s*=\s*1\b)/, onlyIf: /#include\s*<|P[0-3]\s*=|SBUF|TMOD|SCON/, w: 3,
      tip: '检查 EA 引脚与软件使能：硬件上 EA（第 31 脚）必须接 VCC；若使用中断，代码中还需要 `EA = 1;`。'
    },
    {
      id: 'TIMER_NO_RELOAD', re: /TMOD\s*=\s*0x?0?1\b/, onlyIf: /__interrupt|interrupt\s*1/, w: 4,
      tip: '定时器 0 工作在方式 1（16 位）时不会自动重装。若在中断里不重新写 TH0/TL0，第二次溢出要等 65536 个机器周期，看起来就像"只执行了一次"。正确写法：\n\n```c\nvoid T0_ISR(void) __interrupt(1){\n    TH0 = 0xFC; TL0 = 0x18;   /* 先重装 */\n    /* 用户代码 */\n}\n```'
    },
    {
      id: 'DELAY_BY_LOOP_UNSIGNED', re: /while\s*\(\s*i\s*--\s*\)/, w: 2,
      tip: '`while(i--)` 在 `i` 为 `unsigned char` 时是常见延时写法，但编译器优化等级较高时可能被优化掉。建议用 `unsigned int` 并加 `volatile`，或使用定时器精确延时。'
    },
    {
      id: 'PORT_READ_MODIFY_WRITE', re: /P[0-3]\s*\|=\s*|P[0-3]\s*&=\s*|P[0-3]\s*\^=\s*/, w: 4,
      tip: '对 P0–P3 使用 `|=` / `&=` / `^=` 属于"读-改-写"操作。若该口上有外部电路把某位拉低，读回值不等于输出锁存器，会误改其它位。建议对端口用位操作（如 `P1_0 = 1;`），或先保存一份影子变量。'
    },
    {
      id: 'SEG_NO_SCAN_LIMIT', re: /P2\s*=\s*0x?0?[0-9a-fA-F]|P2\s*=\s*~/,
      onlyIf: /(seg|SEG|数码|display|DISP)/i, w: 2,
      tip: '数码管动态扫描时，位选与段码必须成对更新，且每位点亮时间要足够（建议 1–2ms）。若扫描间隔过长会出现明显闪烁，过短则亮度不足。'
    },
    {
      id: 'UART_BAUD_MISMATCH', re: /TH1\s*=\s*0x?[0-9a-fA-F]{1,2}/, w: 3,
      tip: '串口波特率初值必须与晶振频率匹配。11.0592MHz + SMOD=0 时：9600bps → `TH1=TL1=0xFD`；19200 → `0xF4`；1200 → `0xE8`。若换成 12MHz 晶振，这些值会产生约 8.5% 误差，收发会出错。'
    },
    {
      id: 'LCD_INIT_MISSING', re: /0x38|0x28|0x0C|0x06/, onlyIf: /(lcd|LCD|1602)/i, w: 3,
      tip: 'LCD1602 上电后必须按顺序初始化：`0x38`（8 位两行）→ `0x0C`（开显示、关光标）→ `0x06`（地址自增）→ `0x01`（清屏，需延时 >1.5ms）。缺少清屏或延时不够是最常见的"白屏/乱码"原因。'
    },
    {
      id: 'KEY_NO_DEBOUNCE', re: /if\s*\(\s*[A-Za-z0-9_]*P[0-3]_\d\s*==\s*0\s*\)/, w: 3,
      tip: '机械按键必须消抖。最简单是软件延时 10–20ms 后二次确认：\n\n```c\nif (KEY == 0) {\n    delay_ms(15);\n    if (KEY == 0) { /* 确认按下 */ }\n}\n```'
    },
    {
      id: 'INFINITE_LOOP_NO_FEED', re: /while\s*\(\s*1\s*\)|for\s*\(\s*;\s*;\s*\)/, w: 1,
      tip: '主循环里如果没有任何阻塞或状态变化，CPU 会满速空转。教学实验中建议加入状态机或定时器节拍，同时便于观察。'
    },
    {
      id: 'ISR_TOO_LONG', re: /__interrupt/, onlyIf: /delay|while\s*\(\s*[a-zA-Z_]+\s*--\s*\)/, w: 4,
      tip: '中断服务函数里不要放长延时或复杂运算。中断应尽量短（几微秒到几十微秒），否则会阻塞同级/低级中断，造成"定时器不准""串口丢字节"。'
    },
    {
      id: 'P0_NO_PULLUP', re: /P0\s*=\s*/, onlyIf: /(P0\s*=|P0_)/, w: 3,
      tip: 'P0 口是开漏输出，不能直接输出高电平驱动负载。接 LED 时应采用灌电流接法（LED 阳极经限流电阻接 VCC，阴极接 P0.x），或外接 10kΩ 上拉排阻。'
    },
    {
      id: 'MISSING_VOLATILE', re: /\bunsigned\s+(char|int|long)\s+\w+\s*=\s*0\s*;/, onlyIf: /__interrupt/, w: 2,
      tip: '被中断服务函数修改、又被主循环读取的全局变量必须加 `volatile`，否则编译器可能把它缓存在寄存器里，主循环读不到变化。'
    }
  ],

  analyze({ code = '', schematic = null, problem = '', logs = [] }) {
    const findings = [];
    for (const r of this.RULES) {
      if (r.onlyIf && !r.onlyIf.test(code)) continue;
      if (!r.re.test(code)) continue;
      findings.push({ id: r.id, weight: r.w, tip: r.tip });
    }
    // 硬件侧：使用原理图诊断结果
    const hw = (schematic && schematic.issues) ? schematic.issues : [];
    findings.sort((a, b) => b.weight - a.weight);
    return { findings, hardware: hw };
  },

  /** 生成离线回复文本 */
  reply({ question = '', code = '', schematic = null, problem = '' }) {
    const { findings, hardware: hw } = this.analyze({ code, schematic, problem });
    const parts = [];
    parts.push('（离线助教模式：当前未启用大模型，以下结论来自平台的规则知识库）\n');
    if (hw.length) {
      parts.push('**一、硬件连接检查结果**');
      for (const i of hw.slice(0, 8)) {
        const tag = { fatal: '❌ 严重', error: '❗ 错误', warn: '⚠️ 警告', info: 'ℹ️ 提示' }[i.level] || '·';
        parts.push(`- ${tag} ${i.msg}`);
      }
      parts.push('');
    } else if (schematic) {
      parts.push('**一、硬件连接检查**：未发现明显错误。\n');
    }
    if (findings.length) {
      parts.push('**二、代码要点提示**');
      for (const f of findings.slice(0, 6)) parts.push(`- ${f.tip}`);
      parts.push('');
    }
    if (!findings.length && !hw.length) {
      parts.push('未匹配到常见错误模式。建议补充以下信息以便更准确地定位：\n1) 你期望的现象 vs 实际现象；2) 完整的 C 源码；3) 原理图连线；4) 串口/示波器的观测结果。\n');
    }
    parts.push('> 提示：启用大模型后可获得更深入的分析（教师后台 → AI 设置）。');
    return parts.join('\n');
  },

  /** 教师端：离线学情分析 */
  teacherReport(stats) {
    if (!stats || !stats.students?.length) return '暂无学生练习数据。';
    const s = stats.students;
    const active = s.filter(x => x.attempts > 0);
    const solvedAny = s.filter(x => x.solved > 0);
    const avgAttempts = active.length ? (active.reduce((a, b) => a + b.attempts, 0) / active.length).toFixed(1) : 0;
    const lines = [];
    lines.push(`**学情概览**（共 ${s.length} 名学生）`);
    lines.push(`- 有练习记录：${active.length} 人（${(active.length / s.length * 100).toFixed(1)}%）；至少通过一项：${solvedAny.length} 人`);
    lines.push(`- 人均练习次数：${avgAttempts}；总练习 ${s.reduce((a, b) => a + b.attempts, 0)} 次`);
    const stuck = s.filter(x => x.attempts >= 3 && x.ok_count / Math.max(1, x.attempts) < 0.4);
    if (stuck.length) {
      lines.push(`\n**疑似卡点学生**（练习≥3 次但通过率<40%）：`);
      for (const x of stuck.slice(0, 10)) lines.push(`- ${x.class_name || ''} ${x.student_no} ${x.name}：练习 ${x.attempts} 次，通过 ${x.ok_count} 次，提问 ${x.questions} 次`);
    }
    if (stats.problems?.length) {
      lines.push(`\n**题目难度排行**（按尝试次数）`);
      for (const p of stats.problems.slice(0, 8)) {
        const rate = p.attempts ? (p.ok_count / p.attempts * 100).toFixed(0) : 0;
        lines.push(`- ${p.problem_id}：尝试 ${p.attempts} 次 / 通过率 ${rate}% / 涉及 ${p.students} 人`);
      }
    }
    lines.push(`\n**教学建议**`);
    lines.push('- 对通过率低于 40% 的题目，建议课堂现场演示一次完整调试过程（编译报错 → 接线排查 → 波形观测）。');
    lines.push('- 建议把"卡点学生"名单导出，安排课后单独辅导或结对编程。');
    lines.push('- 若多人卡在同一题，优先检查是否实验指导书对寄存器位定义的描述不够明确。');
    return lines.join('\n');
  }
};

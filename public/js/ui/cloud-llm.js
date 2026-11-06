/*
 * cloud-llm.js — 云服务大模型接入（browser 端）
 * ==================================================================
 * 为什么要走浏览器：云服务 SDK 是为端上设计的（publishableKey + Origin 校验），
 * 服务端调用既没有 Origin 也不该持有 publishableKey，因此大模型调用放在前端。
 *
 * 设计要点：
 *   1. **懒加载**：SDK 从 CDN 取，首屏不等它；只有真正提问时才加载。
 *   2. **可降级**：校园网/内网可能屏蔽 CDN，或云服务未开通。任一环节失败都抛
 *      带 code 的错误，调用方回退到服务端 `/api/ai/chat`（离线规则助教）。
 *   3. **流式接口**：云服务只提供 stream:true，这里把 SSE 片段聚合成完整文本，
 *      以适配平台现有的"一次性渲染整段回答"的 UI。
 *   4. **system 必须在第一条**：SDK 不会替你补，缺了会直接报错。
 */
import { cloudConfig, cloudConfigured } from './cloud-config.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';

/** 平台统一的教学人设：约束模型不编造、先引导再给答案 */
export const TUTOR_SYSTEM =
  '你是《微控制器原理及应用》（8051 / STC89C52）课程的助教。' +
  '学生可能在写 C 代码、画原理图或调试串口。' +
  '要求：1) 用中文；2) 先指出最可能的原因，再给可执行的排查步骤；' +
  '3) 尽量用提问引导，而不是直接贴完整答案；4) 涉及寄存器/引脚时写明具体名称与位；' +
  '5) 不要编造学生没有提供的信息；6) 代码用 Markdown 代码块。';

export const REPORT_SYSTEM =
  '你是电子信息类专业实验课教师，负责帮助学生起草《单片机原理及应用》实验报告。' +
  '用中文、Markdown，包含：一、实验目的；二、实验原理；三、硬件电路设计；四、软件设计；' +
  '五、实验结果与分析；六、问题与解决；七、心得体会。' +
  '必须依据给定的真实代码、原理图与仿真数据撰写，不得编造未给出的数据；' +
  '“心得体会”只留【请学生补充】占位，不要代写。代码放 ```c 代码块，只摘录关键段落。';

let sdkPromise = null;
let client = null;
let modelCache = null;
/** 最近一次失败原因，供 UI 显示"云端 AI 不可用，已切换离线助教" */
export const cloudState = { available: null, error: '', model: '' };

class CloudError extends Error {
  constructor(code, message) { super(message); this.code = code; this.isCloudError = true; }
}

function loadSdk() {
  if (window.WorkBuddyCloud) return Promise.resolve(window.WorkBuddyCloud);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => window.WorkBuddyCloud
      ? resolve(window.WorkBuddyCloud)
      : reject(new CloudError('SDK_UNAVAILABLE', '云服务组件加载异常'));
    s.onerror = () => reject(new CloudError('SDK_UNAVAILABLE', '云服务组件加载失败（网络可能屏蔽了 CDN）'));
    document.head.append(s);
  }).catch((e) => { sdkPromise = null; throw e; });
  return sdkPromise;
}

async function getClient() {
  if (client) return client;
  if (!cloudConfigured()) throw new CloudError('NOT_CONFIGURED', '未配置云服务');
  /*
   * 自建部署（换了自己的域名）时，云服务的 Origin 校验必然失败。
   * 这种情况下直接判定"云服务不适用"，跳过它走服务端模型，
   * 而不是每次都发一个注定被拒的请求、再弹一次误导性的告警。
   */
  try {
    const sameOrigin = new URL(cloudConfig.endpoint).origin === window.location.origin;
    if (!sameOrigin) throw new CloudError('WRONG_ORIGIN', '当前域名与云服务登记域名不一致');
  } catch (e) {
    if (e && e.isCloudError) throw e;
  }
  const g = await loadSdk();
  client = g.createWorkBuddyCloud({
    endpoint: cloudConfig.endpoint,
    oauthRelayBaseUrl: cloudConfig.oauthRelayBaseUrl,
    publishableKey: cloudConfig.publishableKey
  });
  return client;
}

/*
 * 选模型策略：
 *   "auto" 这类聚合入口实测首字延迟很高（>15s），长提示会被网关 502 掐断。
 *   因此优先挑列表里的轻量型号；列表里没有就退回第一个可用模型。
 *   注意：这里只是**在服务端返回的列表里排序**，不会凭空造一个模型 id。
 */
const FAST_PREFERENCE = ['deepseek-v4.1-flash', 'glm-5.3-flash', 'minimax-m3.1-flash', 'deepseek-v4-flash', 'hunyuan-chat'];

export function pickModel(models, forced) {
  if (!models || !models.length) return null;
  if (forced) {
    const hit = models.find(x => x.id === forced && x.disabled !== true);
    if (hit) return hit;
  }
  for (const id of FAST_PREFERENCE) {
    const hit = models.find(x => x.id === id && x.disabled !== true);
    if (hit) return hit;
  }
  return models.find(x => x.disabled !== true) || null;
}

/** 拉取可用模型（缓存；空列表是合法结果，不能硬编码模型名兜底） */
export async function listModels(force = false) {
  if (modelCache && !force) return modelCache;
  const c = await getClient();
  const models = await c.llm.models.list();
  modelCache = Array.isArray(models) ? models : [];
  return modelCache;
}

/**
 * 一次性拿到完整回答（内部消费 SSE 流）。
 * @param {{system?:string, user:string, history?:Array, onChunk?:Function, signal?:AbortSignal}} opts
 * @returns {Promise<{text:string, model:string}>}
 */
export async function cloudChat(opts = {}) {
  const { system = TUTOR_SYSTEM, user, history = [], onChunk, timeoutMs = 45000 } = opts;
  // 自带超时：网关在长响应上会返回 502，与其干等不如主动放弃并回退
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const signal = opts.signal || ac.signal;
  if (!user) throw new CloudError('EMPTY_INPUT', '内容为空');
  const c = await getClient();
  const models = await listModels();
  const m = pickModel(models, opts.model);
  if (!m) throw new CloudError('NO_MODEL', '云端暂无可用模型');

  const messages = [
    { role: 'system', content: system },   // 必须第一条
    ...history.filter(h => h && h.content).slice(-8).map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: String(h.content).slice(0, 4000)
    })),
    { role: 'user', content: user }
  ];

  let text = '';
  try {
    for await (const chunk of c.llm.chat.completions.create({
      model: m.id, messages, stream: true, signal
    })) {
      const d = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      const piece = d && d.content;
      if (piece) { text += piece; if (onChunk) onChunk(piece, text); }
    }
  } catch (e) {
    const ce = (e && e.name === 'AbortError')
      ? new CloudError('TIMEOUT', '云端响应超时（' + Math.round(timeoutMs / 1000) + 's）')
      : new CloudError('CHAT_FAILED', (e && e.message) || '云端模型调用失败');
    // 留痕：便于在界面上直接看到"为什么回退了"，而不是只有一闪而过的 toast
    cloudState.available = false;
    cloudState.error = ce.message;
    cloudState.lastErrorAt = Date.now();
    throw ce;
  } finally {
    clearTimeout(timer);
  }
  if (!text.trim()) throw new CloudError('EMPTY_REPLY', '云端模型返回为空');
  cloudState.available = true; cloudState.error = ''; cloudState.model = m.id;
  return { text, model: m.id };
}

/** 探测云端 AI 是否可用（用于在界面上显示状态） */
export async function probeCloud() {
  try {
    const models = await listModels();
    const m = pickModel(models);
    cloudState.available = !!m;
    cloudState.error = m ? '' : '云端暂无可用模型';
    cloudState.model = m ? (m.name || m.id) : '';
    return { available: !!m, model: cloudState.model, error: cloudState.error, count: models.length };
  } catch (e) {
    cloudState.available = false;
    cloudState.error = e.message || String(e);
    return { available: false, model: '', error: cloudState.error, count: 0 };
  }
}

/* ------------------------------------------------------------------
 * 提示词构造：与服务端 /api/ai/chat、/api/reports/generate 使用同一套信息，
 * 保证"云端 AI"和"服务端 AI"给出的回答质量一致，切换时学生无感。
 * ------------------------------------------------------------------ */

export function tutorPrompt({ question = '', body = '', code = '', context = null, problemId = '' }) {
  const parts = [`【问题】${question || '（无标题）'}`];
  if (body) parts.push(`【描述】${body}`);
  if (problemId) parts.push(`【当前实验】${problemId}`);
  if (code) parts.push('【学生代码】\n```c\n' + String(code).slice(0, 3000) + '\n```');
  let ctx = context;
  if (typeof ctx === 'string') { try { ctx = JSON.parse(ctx); } catch { ctx = null; } }
  if (ctx && ctx.issues && ctx.issues.length) {
    parts.push('【平台原理图自动诊断结果】\n' + ctx.issues.map(i => `- [${i.level}] ${i.msg}`).join('\n'));
  } else if (ctx && ctx.parts) {
    parts.push(`【原理图概要】元件 ${(ctx.parts || []).length} 个；导线 ${ctx.wires || 0} 条；电气网络 ${ctx.nets || 0} 个`);
  }
  parts.push('请分析可能的原因，并用提问的方式引导学生自己找到问题。');
  return parts.join('\n\n');
}

export function reportPrompt({ title = '', statement = '', code = '', evidence = {}, schematic = null }) {
  const ev = evidence || {};
  const lines = [`【实验名称】${title}`];
  if (statement) lines.push('', '【实验指导书原文】', String(statement).slice(0, 2000));
  if (code) lines.push('', '【学生最终代码】', '```c', String(code).slice(0, 4000), '```');
  if (schematic) {
    const partsDesc = Object.entries(schematic.parts || {}).map(([k, v]) => `${k}×${v}`).join('、') || '—';
    lines.push('', '【硬件电路（由原理图编辑器自动提取）】',
      `主控：${schematic.mcu || '—'}；元件：${partsDesc}；导线 ${schematic.wires || 0} 条，电气网络 ${schematic.nets || 0} 个。`);
    lines.push(schematic.diagnostics && schematic.diagnostics.length
      ? '自动接线诊断：' + schematic.diagnostics.map(d => `[${d.level}] ${d.msg}`).join('；')
      : '自动接线诊断：未发现常见错误。');
  }
  lines.push('', '【仿真/调试实测数据】',
    `- 编译：${ev.compileOk ? '成功，' + (ev.hexSize || 0) + ' 字节' : '未成功编译'}`,
    `- 仿真时长：${ev.simCycles ? ev.simCycles + ' 个机器周期（约 ' + (ev.simCycles / 921600).toFixed(3) + ' 秒）' : '未记录'}`,
    `- GPIO 跳变次数：${ev.portEvents || 0}`,
    `- 串口记录：${ev.serialLog ? '有' : '无'}`);
  lines.push('', '请据此撰写实验报告。');
  return lines.join('\n');
}

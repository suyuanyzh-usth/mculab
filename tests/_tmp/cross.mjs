const ROOT = 'C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab';
const { PRESETS, Diagnostics } = await import('file://' + ROOT + '/public/js/schematic/schematic.js');
for (const name of Object.keys(PRESETS)) {
  const s = PRESETS[name]();
  const cross = s.wires.filter(w => w.crossings > 0).length;
  const total = s.wires.reduce((a, w) => a + (w.crossings || 0), 0);
  const errs = (s.diagnostics || []).filter(d => d.level === 'fatal' || d.level === 'error').length;
  const warns = (s.diagnostics || []).filter(d => d.level === 'warn').length;
  console.log(`${name.padEnd(16)} 元件 ${String(s.parts.length).padStart(3)} 导线 ${String(s.wires.length).padStart(3)} 交叉导线 ${cross} 总交叉 ${total} | 错误 ${errs} 警告 ${warns}`);
}

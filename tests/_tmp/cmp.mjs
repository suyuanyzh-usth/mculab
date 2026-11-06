import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT, 'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { SFR } = await import('file://' + path.join(ROOT, 'public/js/core/sfr.js').replace(/\\/g,'/'));
const name = process.argv[2], K = Number(process.argv[3]), ctx = Number(process.argv[4] || 6);
const ihx = fs.readFileSync(path.join(ROOT,'tests/fixtures',name+'.ihx'),'utf8');
const ref = fs.readFileSync(path.join(ROOT,'tests/fixtures',name+'.states.txt'),'utf8').trim().split('\n')
  .map(l=>l.trim().split(/\s+/).map(s=>parseInt(s.replace(/^0x/,''),16)));
const cpu = new CPU8051(); cpu.loadHex(ihx);
const h = v => '0x'+v.toString(16).toUpperCase();
const rows = [];
let first = -1;
for (let i=1;i<=K;i++){
  const pc0 = cpu.pc; const {text} = cpu.disasm(pc0);
  const cyc = cpu.stepOne();
  const r = ref[i-1] || [];
  const mine = {pc:cpu.pc, psw:cpu.sfr[SFR.PSW], acc:cpu.sfr[SFR.ACC], b:cpu.sfr[SFR.B], sp:cpu.sfr[SFR.SP],
                r:[0,1,2,3,4,5,6,7].map(n=>cpu.getRn(n))};
  const d = [];
  if (mine.pc !== r[0]) d.push(`PC ref=${h(r[0]||0)} mine=${h(mine.pc)}`);
  if (mine.psw !== r[1]) d.push(`PSW ref=${h(r[1]||0)} mine=${h(mine.psw)}`);
  if (mine.acc !== r[2]) d.push(`ACC ref=${h(r[2]||0)} mine=${h(mine.acc)}`);
  if (mine.b !== r[3]) d.push(`B ref=${h(r[3]||0)} mine=${h(mine.b)}`);
  if (mine.sp !== r[4]) d.push(`SP ref=${h(r[4]||0)} mine=${h(mine.sp)}`);
  rows.push({i, pc0, text, cyc, d, rRef:(r.slice(6)||[]), rMine:mine.r});
  if (d.length && first<0) first = i;
  if (first>=0 && i>first+ctx) break;
}
if (first<0) console.log(`PC/PSW/ACC/B/SP 轨迹在前 ${K} 步完全一致 ✔`);
else {
  console.log(`首个不一致：第 ${first} 条指令之后`);
  for (const row of rows.filter(x=>x.i>=Math.max(1,first-ctx)&&x.i<=first+ctx)) {
    console.log(` ${row.i===first?'>>':'  '} step${String(row.i).padStart(4)} @0x${row.pc0.toString(16).padStart(4,'0')} ${row.text.padEnd(18)} cyc=${row.cyc}`);
    if (row.d.length) console.log('      ' + row.d.join(' | '));
    console.log(`      R ref=[${row.rRef.map(v=>v.toString(16)).join(' ')}]  mine=[${row.rMine.map(v=>v.toString(16)).join(' ')}]`);
  }
}

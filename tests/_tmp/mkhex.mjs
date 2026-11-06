import fs from 'node:fs';
const bytes = [0x02,0x00,0x03, 0x75,0x81,0x30, 0x12,0x00,0x0C, 0x80,0xFE, 0x00, 0x22];
const hex2 = v => v.toString(16).toUpperCase().padStart(2,'0');
const rec = (addr, data) => {
  const h = [data.length, (addr>>8)&0xFF, addr&0xFF, 0x00, ...data];
  const sum = (-h.reduce((a,b)=>(a+b)&0xFF,0)) & 0xFF;
  return ':' + h.map(hex2).join('') + hex2(sum);
};
const out = [rec(0x0000, bytes), ':00000001FF'].join('\n');
fs.writeFileSync('tests/_tmp/stackorder.hex', out);
console.log(out);

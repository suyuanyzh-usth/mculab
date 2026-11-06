import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname,'..','..');
const { assemble } = await import('file://'+path.join(ROOT,'public/js/core/asm8051.js').replace(/\\/g,'/'));
const src = `
        ORG 0000H
        LJMP  START
        ORG 0030H
START:  MOV  SP, #60H
        MOV  A, #0FEH
LOOP:   MOV  P1, A
        LCALL DELAY
        RL   A
        SJMP LOOP
DELAY:  MOV  R7, #200
D1:     MOV  R6, #250
D2:     DJNZ R6, D2
        DJNZ R7, D1
        RET
        END
`;
const r = assemble(src);
console.log('ok =', r.ok, 'errors =', r.errors.length);
for (const e of r.errors) console.log('  err:', e.line, e.msg);
console.log('符号:', JSON.stringify(r.symbols));
console.log(r.hex.split('\n').slice(0,6).join('\n'));

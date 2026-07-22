const { PassThrough } = require('stream');
const keys = require('./node_modules/blessed/lib/keys');
const s = new PassThrough();
keys.emitKeypressEvents(s);
s.on('keypress', (ch, key) => console.log(JSON.stringify({ch, key})));
// D=0x04 K=0x0B P=0x10 G=0x07 I=0x09 U=0x15 V=0x16 W=0x17 X=0x18 Y=0x19 Z=0x1A E=0x05 F=0x06 O=0x0F S=0x13
const letters = {D:0x04,K:0x0B,P:0x10,G:0x07,I:0x09,U:0x15,V:0x16,W:0x17,X:0x18,Y:0x19,Z:0x1A,E:0x05,F:0x06,O:0x0F,S:0x13};
Object.entries(letters).forEach(([name,b]) => { console.log('--',name); s.write(Buffer.from([b])); });
setTimeout(()=>process.exit(0), 200);

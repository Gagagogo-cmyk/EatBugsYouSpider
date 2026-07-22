const { PassThrough } = require('stream');
const keys = require('./node_modules/blessed/lib/keys');
const s = new PassThrough();
keys.emitKeypressEvents(s);
s.on('keypress', (ch, key) => {
  console.log(JSON.stringify({ch, key}));
});
const bytes = [0x02, 0x08, 0x0E, 0x0A, 0x0D];
bytes.forEach(b => s.write(Buffer.from([b])));
setTimeout(()=>process.exit(0), 200);

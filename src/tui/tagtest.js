const blessed = require('blessed');
const { PassThrough } = require('stream');

const input = new PassThrough();
const output = new PassThrough();
output.isTTY = true;
output.columns = 120;
output.rows = 40;

const screen = blessed.screen({ smartCSR: false, input, output, terminal: 'xterm-256color' });
const box = blessed.box({ parent: screen, tags: true, width: 50, height: 5 });

const text = '{grey-fg}sig{/grey-fg} desc-outside' ;
const testA = '{grey-fg}AAA{bright-white-fg}BBB{/bright-white-fg}CCC{/grey-fg}';

console.log('=== testA ===');
console.log(JSON.stringify(box._parseTags(testA)));

process.exit(0);

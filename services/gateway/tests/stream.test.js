jest.mock('axios');
process.env.LOG_LEVEL = 'silent';
const axios = require('axios');
const { Readable } = require('stream');
const { streamText } = require('../ai');
function run(chunks) {
  axios.post.mockResolvedValue({ data: Readable.from(chunks) });
  const tokens = [];
  return new Promise(resolve => { streamText({ provider: 'ollama', endpoint: 'http://test', model: 'test' }, { prompt: 'test' }, { onToken: text=>tokens.push(text), onDone: ()=>resolve({ tokens, done: true }), onError: error=>resolve({ tokens, error }) }); });
}
test('provider error frames fail the stream instead of reporting success', async () => {
  const result=await run(['{"error":"model failed"}\n']);
  expect(result.done).toBeUndefined(); expect(result.error).toContain('model failed');
});
test('split UTF-8 tokens and a final record without a newline are retained', async () => {
  const bytes=Buffer.from('{"message":{"content":"😀"}}\n{"done":true}');
  const index=bytes.indexOf(Buffer.from('😀'))+1;
  const result=await run([bytes.subarray(0,index),bytes.subarray(index)]);
  expect(result.tokens.join('')).toBe('😀'); expect(result.done).toBe(true);
});

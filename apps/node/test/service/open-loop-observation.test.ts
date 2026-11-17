import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createOpenLoopObserver } from '../../src/service/agents/open-loop-observation';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'loop-observer-')); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
const settle = () => new Promise(resolve => setTimeout(resolve, 80));
function sampled(observer: ReturnType<typeof createOpenLoopObserver>, input: unknown = {}) {
  for (let i = 0; i < 100; i++) {
    const finish = observer.begin(`test-${i}`, true, input);
    if (finish) return finish;
  }
  throw new Error('No deterministic selected key');
}
function make(slots = 1) {
  return createOpenLoopObserver({ directory, until: Date.now() + 60000, selectedSlots: slots });
}
test('snapshot does not mutate input/output and repeated finish cannot add records', async () => {
  const input = { messages: [{ content: 'before' }] };
  const finish = sampled(make(), input);
  input.messages[0].content = 'after';
  const output = Object.freeze({ segments: Object.freeze(['unchanged']) });
  expect(() => { finish(output); finish({ segments: ['ignored'] }); }).not.toThrow();
  await settle();
  const files = await fs.readdir(directory);
  expect(files).toEqual(['selected-0.json']);
  const saved = JSON.parse(await fs.readFile(join(directory, files[0]), 'utf8'));
  expect(saved.input.messages[0].content).toBe('before');
  expect(saved.output).toEqual(output);
  expect(input.messages[0].content).toBe('after');
  expect((await fs.stat(join(directory, files[0]))).mode & 0o777).toBe(0o600);
});
test('multiple workers cannot overwrite or exceed shared slots', async () => {
  sampled(make())({ worker: 1 });
  sampled(make())({ worker: 2 });
  await settle();
  expect(await fs.readdir(directory)).toEqual(['selected-0.json']);
  expect([1, 2]).toContain(JSON.parse(await fs.readFile(join(directory, 'selected-0.json'), 'utf8')).output.worker);
});
test('expiry and STOP prevent capture without changing replies', async () => {
  const expired = createOpenLoopObserver({ directory, until: 1 });
  expect(expired.begin('a', true, {})).toBeUndefined();
  await fs.writeFile(join(directory, 'STOP'), '');
  sampled(make())({ reply: 'still sent by caller' });
  await settle();
  expect(await fs.readdir(directory)).toEqual(['STOP']);
});
test('serialization and storage errors never escape to chat', async () => {
  const circular: any = {}; circular.self = circular;
  const observer = make();
  expect(observer.begin('a', true, circular)).toBeUndefined();
  expect(() => sampled(observer)(circular)).not.toThrow();
  await fs.writeFile(join(directory, 'file'), 'not a directory');
  const broken = createOpenLoopObserver({ directory: join(directory, 'file', 'child'), until: Date.now() + 60000 });
  expect(() => sampled(broken)({ reply: 'unchanged' })).not.toThrow();
  await settle();
});
test('oversize input is skipped and output is bounded', async () => {
  const observer = make();
  for (let i = 0; i < 10; i++) expect(observer.begin(`test-${i}`, true, 'x'.repeat(140000))).toBeUndefined();
  sampled(observer)({ oversized: 'x'.repeat(270000) });
  await settle();
  expect(await fs.readdir(directory)).toEqual([]);
});

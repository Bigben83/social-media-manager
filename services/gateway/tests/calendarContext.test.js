jest.mock('../utils/MongoDBConnector', () => ({ getDb: jest.fn() }));
jest.mock('../ai', () => ({ ...jest.requireActual('../ai'), generateText: jest.fn() }));
let mockJobs;
jest.mock('../jobs', () => ({
  registerBackgroundJobs(_app, getDb, handlers) {
    mockJobs = jest.requireActual('../jobs').createBackgroundJobs({ getDb, handlers, queue: { add: jest.fn(), getJob: async () => null } });
    return mockJobs;
  },
}));
const fs = require('fs');
const path = require('path');
const os = require('os');
const fakeDb = require('./fakeDb');
const { getDb } = require('../utils/MongoDBConnector');
const { generateText } = require('../ai');
process.env.LOG_LEVEL = 'silent';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-context-tests-'));
const db = fakeDb();
getDb.mockResolvedValue(db);
const app = require('../server');
const context = 'Highlight the XXXX feature.\nIntroduction series:\n1. Meet Rack-X.\n2. Organise your rack.';
const brief = { theme: 'Introductions', pillars: ['Product'], toneGuidance: 'Clear', platformNotes: {} };
const request = (url, payload) => app.inject({ method: 'POST', url, headers: { 'x-workspace-id': 'campaign' }, payload });
beforeAll(async () => { await app.ready(); await db.collection('workspaces').insertOne({ _id: 'campaign' }); });
afterAll(async () => { await app.close(); fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); });
beforeEach(() => generateText.mockReset());

test('brief jobs retain campaign context and include the supplied source text in the prompt', async () => {
  generateText.mockResolvedValue(JSON.stringify(brief));
  const response = await request('/ai/content-brief', { platforms: ['facebook'], month: '2026-11', campaignContext: '  ' + context + '  ' });
  expect(response.statusCode).toBe(202);
  const jobId = response.json().jobId;
  expect((await mockJobs.get(jobId, 'campaign')).payload.campaignContext).toBe(context);
  await mockJobs.process({ data: { id: jobId } });
  expect(generateText.mock.calls[0][1].prompt).toContain(JSON.stringify(context));
  expect((await mockJobs.get(jobId,'campaign')).result.campaignContext).toBe(context);
});

test.each([false, true])('calendar carries source posts into every platform and the saved plan (approved brief: %s)', async approved => {
  if (!approved) generateText.mockResolvedValueOnce(JSON.stringify(brief));
  for (let i = 0; i < 2; i++) generateText.mockResolvedValueOnce(JSON.stringify({ posts: [{ content: 'Meet Rack-X', week: 1 }] }));
  const response = await request('/ai/content-calendar', { platforms: ['facebook','instagram'], month: '2026-11', campaignContext: context, ...(approved && { approvedBrief: brief }) });
  expect(response.statusCode).toBe(202);
  const jobId = response.json().jobId;
  await mockJobs.process({ data: { id: jobId } });
  expect(generateText.mock.calls).toHaveLength(approved ? 2 : 3);
  for (const call of generateText.mock.calls) expect(call[1].prompt).toContain(JSON.stringify(context));
  const saved = await db.collection('content_calendars').findOne({ workspaceId: 'campaign', _id: new (require('mongodb').ObjectId)((await mockJobs.get(jobId,'campaign')).result.calendarId) });
  expect(saved.campaignContext).toBe(context);
});

test('malformed or oversized campaign context is rejected before queueing', async () => {
  for (const campaignContext of [{ text: 'Wrong type' }, 'x'.repeat(20001), null]) {
    expect((await request('/ai/content-brief', { platforms: ['facebook'], campaignContext })).statusCode).toBe(400);
    expect((await request('/ai/content-calendar', { platforms: ['facebook'], campaignContext })).statusCode).toBe(400);
  }
  expect(generateText).not.toHaveBeenCalled();
});

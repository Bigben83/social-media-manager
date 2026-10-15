const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {runAssistantTurn,normalizeArguments}=require('../local');
const {createApp}=require('../index');
const {passwordHash,hash}=require('../auth');
const fakeDb=require('../../gateway/tests/fakeDb');
const toolCall=(name,args)=>({function:{name,arguments:args}});
const assistant=(content='',calls=[])=>({message:{role:'assistant',content,...(calls.length&&{tool_calls:calls})}});
const result=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
const session=()=>({workspaceId:'one',model:'test-llama',status:'running',messages:[{role:'user',content:'Please help'}],events:[]});

test('local structured arguments decode JSON strings without changing text or accepting invalid shapes',()=>{
  const schema={type:'object',properties:{drafts:{type:'array',items:{type:'object',properties:{content:{type:'string'},destinations:{type:'array',items:{type:'object'}}}}}}};
  const args=normalizeArguments(schema,{drafts:JSON.stringify([{content:'{"preserve":"this text"}',destinations:'[]'}])});
  assert.deepEqual(args,{drafts:[{content:'{"preserve":"this text"}',destinations:[]}]});
  assert.deepEqual(normalizeArguments(schema,{drafts:'{"bad":"shape"}'}),{drafts:'{"bad":"shape"}'});
  assert.deepEqual(normalizeArguments(schema,{drafts:'invalid JSON'}),{drafts:'invalid JSON'});
});

test('local agent executes MCP tools and supplies their results to Ollama without exposing confirmation',async()=>{
  const row=session(),calls=[],requests=[];
  const client={listTools:async()=>({tools:['create_drafts','confirm_post'].map(name=>({name,inputSchema:{type:'object'}}))}),callTool:async value=>{calls.push(value);return result({draftIds:['draft-one']});}};
  await runAssistantTurn({client,session:row,checkpoint:async()=>{},checkAccess:async()=>{},requestModel:async payload=>{requests.push(structuredClone(payload));return requests.length===1?assistant('',[toolCall('create_drafts',{workspaceId:'one',requestId:'one',drafts:[{content:'Introduction'}]})]):assistant('The draft was saved.');}});
  assert.equal(row.status,'idle');assert.equal(calls.length,1);assert.ok(requests[1].messages.some(m=>m.role==='tool'&&m.tool_name==='create_drafts'));assert.ok(requests.every(r=>!r.tools.some(t=>t.function.name==='confirm_post')));
});
test('local agent refuses model confirmation and cross-workspace tool calls',async()=>{
  const row=session(),calls=[];let turn=0;
  const client={listTools:async()=>({tools:[{name:'get_workspace_context'},{name:'confirm_post'}]}),callTool:async value=>{calls.push(value);return result({});}};
  await runAssistantTurn({client,session:row,checkpoint:async()=>{},checkAccess:async()=>{},requestModel:async()=>++turn===1?assistant('',[toolCall('confirm_post',{workspaceId:'one',confirmation:'CONFIRM'}),toolCall('get_workspace_context',{workspaceId:'two'})]):assistant('Review permissions.')});
  assert.equal(calls.length,0);assert.deepEqual(row.events.map(e=>e.success),[false,false]);
});
test('a post preview pauses the agent and does not execute later parallel calls',async()=>{
  const row=session(),calls=[];let requested=0;
  const preview={previewId:'preview',content:'Exact text',requiresUserConfirmation:true};
  const client={listTools:async()=>({tools:[{name:'prepare_post'},{name:'create_drafts'}]}),callTool:async value=>{calls.push(value);return result(preview);}};
  await runAssistantTurn({client,session:row,checkpoint:async()=>{},checkAccess:async()=>{},requestModel:async()=>{requested++;return assistant('',[toolCall('prepare_post',{workspaceId:'one'}),toolCall('create_drafts',{workspaceId:'one'})]);}});
  assert.equal(row.status,'awaiting_confirmation');assert.deepEqual(row.pendingPreview,preview);assert.equal(calls.length,1);assert.equal(requested,1);assert.equal(row.messages.at(-1).tool_name,'create_drafts');
});
test('local agent bounds tool loops and checks revocation before model requests',async()=>{
  const row=session();let modelCalls=0;
  const client={listTools:async()=>({tools:[{name:'list_workspaces'}]}),callTool:async()=>result({workspaces:[]})};
  await assert.rejects(runAssistantTurn({client,session:row,checkpoint:async()=>{},checkAccess:async()=>{},requestModel:async()=>{modelCalls++;return assistant('',[toolCall('list_workspaces',{})]);}}),/step limit/);assert.equal(modelCalls,8);
  await assert.rejects(runAssistantTurn({client,session:session(),checkpoint:async()=>{},checkAccess:async()=>{throw new Error('revoked');},requestModel:async()=>{throw new Error('Should not run');}}),/revoked/);
});

const db=fakeDb();const collection=db.collection.bind(db);db.collection=name=>{const table=collection(name);return {...table,async insertMany(docs){for(const doc of docs)await table.insertOne(doc);}};};
const adminHash=passwordHash('owner-password-for-local-tests');const ownerToken='owner-session-test';const ownerId=hash(ownerToken);
let base,httpServer,service,csrf,cookies,allowTools=true;const deliveries=[];
before(async()=>{
  process.env.ENCRYPTION_KEY='a'.repeat(64);
  await db.collection('workspaces').insertOne({_id:'one',name:'One'});await db.collection('workspaces').insertOne({_id:'two',name:'Two'});
  await db.collection('platform_credentials').insertOne({_id:'ai_config',endpoint:'http://local-ollama:11434',model:'test-llama'});
  await db.collection('platform_credentials').insertOne({_id:'one:facebook',pages:[{id:'page-one',name:'Page One',selected:true,accessToken:'never-send-to-model'}]});
  await db.collection('mcp_admin_sessions').insertOne({_id:ownerId,version:hash(adminHash),expiresAt:new Date(Date.now()+3600000)});
  httpServer=createServer();await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+httpServer.address().port;
  service=await createApp({getDb:async()=>db,publicUrl:base+'/mcp',adminPasswordHash:adminHash,log:{warn(){},error(){}},inspectLocalModel:async conf=>{assert.equal(conf.model,'test-llama');if(!allowTools)throw new Error('Model does not support tools');return {toolsSupported:true,model:conf.model};},requestLocalModel:async(endpoint,payload)=>{
    assert.equal(endpoint,'http://local-ollama:11434');assert.equal(JSON.stringify(payload).includes('never-send-to-model'),false);
    if(payload.messages.at(-1).role==='tool')return assistant('The tool completed.');
    const content=payload.messages.at(-1).content;
    return /publish/i.test(content)?assistant('',[toolCall('prepare_post',{workspaceId:'one',content:'Exact local post',destinations:[{platform:'facebook',accountId:'page-one'}]})]):assistant('',[toolCall('create_drafts',{workspaceId:'one',requestId:'local-draft',drafts:JSON.stringify([{content:'Local introduction',destinations:'[]'}])})]);
  },callGateway:async(...args)=>{deliveries.push(args);return {success:true,results:[{success:true,platform:'facebook'}]};}});
  httpServer.on('request',service.app);
  const status=await fetch(base+'/connector/local/status',{headers:{Cookie:'smm-connector='+ownerToken}});assert.equal(status.status,200);const data=await status.json();csrf=data.csrf;cookies='smm-connector='+ownerToken+'; '+status.headers.getSetCookie()[0].split(';')[0];
});
after(async()=>{await new Promise(resolve=>httpServer.close(resolve));});
async function request(path,body,workspace='one',cookie=cookies){return fetch(base+'/connector/local'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-Workspace-Id':workspace},...(body&&{body:JSON.stringify({csrf,...body})})});}
async function createSession(scopes=['social:read','social:drafts']){const response=await request('/sessions',{workspaceId:'one',scopes});assert.equal(response.status,201);return response.json();}
async function poll(id,status){for(let attempt=0;attempt<100;attempt++){const response=await request('/sessions/'+id);assert.equal(response.status,200);const row=await response.json();if(row.status===status)return row;if(row.status==='failed')assert.fail(row.error);await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Assistant did not finish');}
test('local assistant requires owner authentication and valid same-origin CSRF',async()=>{
  assert.equal((await fetch(base+'/connector/local/status')).status,401);
  const forged=await request('/sessions',{csrf:'wrong',workspaceId:'one',scopes:['social:read']});assert.equal(forged.status,403);
  const foreign=await fetch(base+'/connector/local/sessions',{method:'POST',headers:{Cookie:cookies,Origin:'https://chatgpt.com','Content-Type':'application/json'},body:JSON.stringify({csrf,workspaceId:'one',scopes:['social:read']})});assert.equal(foreign.status,403);
});
test('local sessions reject unsupported models and preserve explicit permissions',async()=>{
  allowTools=false;const unsupported=await request('/sessions',{workspaceId:'one',scopes:['social:read']});assert.equal(unsupported.status,400);allowTools=true;
  const readonly=await createSession(['social:read']);assert.deepEqual(readonly.scopes,['social:read']);
  const created=await createSession();assert.equal((await request('/sessions/'+created.id,undefined,'two')).status,404);
  assert.equal((await request('/sessions/'+created.id,undefined,'one','smm-connector=other-owner')).status,401);
});
test('local Ollama turns save drafts through the real MCP transport and recover their history',async()=>{
  const row=await createSession();const started=await request('/sessions/'+row.id+'/turn',{workspaceId:'one',message:'Save an introduction draft'});assert.equal(started.status,202);
  const done=await poll(row.id,'idle');assert.ok(done.messages.some(m=>m.content==='The tool completed.'));assert.equal(done.events[0].tool,'create_drafts');assert.equal((await db.collection('drafts').find({workspaceId:'one'}).toArray()).length,1);assert.equal(deliveries.length,0);
  const stored=await db.collection('mcp_local_sessions').findOne({_id:row.id});assert.ok(stored.messages.some(m=>m.role==='tool'));assert.equal(JSON.stringify(done).includes(ownerId),false);
});
test('local posting is opt-in and only a bound confirmation button dispatches once',async()=>{
  const row=await createSession(['social:read','social:publish']);await request('/sessions/'+row.id+'/turn',{workspaceId:'one',message:'Publish a post'});const ready=await poll(row.id,'awaiting_confirmation');assert.equal(deliveries.length,0);
  const previewId=ready.pendingPreview.previewId;assert.equal(ready.pendingPreview.content,'Exact local post');
  assert.equal((await request('/sessions/'+row.id+'/confirm',{workspaceId:'two',previewId,decision:'confirm'})).status,404);
  const response=await request('/sessions/'+row.id+'/confirm',{workspaceId:'one',previewId,decision:'confirm'});assert.equal(response.status,202);const done=await poll(row.id,'idle');assert.equal(done.deliveryResult.success,true);assert.equal(deliveries.length,1);
  const retry=await request('/sessions/'+row.id+'/confirm',{workspaceId:'one',previewId,decision:'confirm'});assert.equal(retry.status,200);assert.equal(deliveries.length,1);
});
test('cancelled previews never dispatch and grant revocation blocks the session',async()=>{
  const row=await createSession(['social:read','social:publish']);await request('/sessions/'+row.id+'/turn',{workspaceId:'one',message:'Publish a post'});const ready=await poll(row.id,'awaiting_confirmation');const initial=deliveries.length;
  assert.equal((await request('/sessions/'+row.id+'/confirm',{workspaceId:'one',previewId:ready.pendingPreview.previewId,decision:'cancel'})).status,200);
  assert.equal((await request('/sessions/'+row.id+'/confirm',{workspaceId:'one',previewId:ready.pendingPreview.previewId,decision:'confirm'})).status,409);assert.equal(deliveries.length,initial);
  const stored=await db.collection('mcp_local_sessions').findOne({_id:row.id});await service.provider.revokeGrant(stored.grantId);assert.equal((await request('/sessions/'+row.id)).status,403);
});
test('connector restart marks interrupted local turns failed without repeating actions',async()=>{
  const row=await createSession();await db.collection('mcp_local_sessions').updateOne({_id:row.id},{$set:{status:'running'}});const initial=deliveries.length;
  await createApp({getDb:async()=>db,publicUrl:base+'/mcp',adminPasswordHash:adminHash,log:{warn(){},error(){}}});
  const stored=await db.collection('mcp_local_sessions').findOne({_id:row.id});assert.equal(stored.status,'failed');assert.match(stored.error,/restarted/);assert.equal(deliveries.length,initial);
});

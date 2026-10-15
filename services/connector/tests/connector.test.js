const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createApp } = require('../index');
const { passwordHash } = require('../auth');
const fakeDb = require('../../gateway/tests/fakeDb');
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
const db = fakeDb();
const collection = db.collection.bind(db);
db.collection = name => { const table = collection(name); return { ...table, async insertMany(docs) { for (const doc of docs) await table.insertOne(doc); } }; };
const password = 'test-only-connector-owner-password';
let base, service, httpServer;
const deliveries = [], schedules = [];
const log = { warn() {}, error() {} };
before(async () => {
  await db.collection('workspaces').insertOne({ _id:'one', name:'Workspace One' });
  await db.collection('workspaces').insertOne({ _id:'two', name:'Workspace Two' });
  await db.collection('platform_credentials').insertOne({ _id:'one:facebook', pages:[{id:'page-one',name:'Page One',selected:true,accessToken:'must-never-appear'}] });
  await db.collection('platform_credentials').insertOne({ _id:'two:facebook', pages:[{id:'page-two',name:'Page Two',selected:true,accessToken:'private'}] });
  await db.collection('account_profiles').insertOne({ _id:'one:workspace', workspaceId:'one', businessName:'Brand One', apiKey:'must-never-appear' });
  httpServer=createServer();await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+httpServer.address().port;
  service=await createApp({getDb:async()=>db,publicUrl:base+'/mcp',adminPasswordHash:passwordHash(password),log,callGateway:async(...args)=>{deliveries.push(args);return {success:true,results:[{platform:'facebook',accountId:'page-one',success:true}]}},callScheduler:async(...args)=>{schedules.push(args);return {success:true,jobId:'scheduled-test'}}});
  httpServer.on('request',service.app);
});
after(async()=>{await new Promise(resolve=>httpServer.close(resolve));});
async function request(path,options={}){return fetch(base+path,{redirect:'manual',...options});}
async function grant(scopes=['social:read','social:drafts','social:publish','social:schedule'], host='claude') {
  const clientName = host === 'chatgpt' ? 'ChatGPT test' : 'Claude test';
  const redirectUri = host === 'chatgpt' ? 'https://chatgpt.com/connector/oauth/test-callback-id' : 'https://claude.ai/api/mcp/auth_callback';
  const registration=await request('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:clientName,redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});assert.equal(registration.status,201);const client=await registration.json();
  const verifier='v'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
  const params=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:client.redirect_uris[0],scope:scopes.join(' '),code_challenge:challenge,code_challenge_method:'S256',state:'test-state',resource:base+'/mcp'});
  const auth=await request('/authorize?'+params);assert.equal(auth.status,302);
  const consentPath=auth.headers.get('location');
  const cookies=new Map();
  async function browser(path,options={}){const r=await request(path,{...options,headers:{...(options.method==='POST'&&{Origin:base}),Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...options.headers}});for(const cookie of r.headers.getSetCookie()){const [key,value]=cookie.split(';')[0].split('=');cookies.set(key,value);}return r;}
  const login=await browser('/connector/login?returnTo='+encodeURIComponent(consentPath));const loginHtml=await login.text();let csrf=/name="csrf" value="([^"]+)"/.exec(loginHtml)[1];
  const signedIn=await browser('/connector/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,password,returnTo:consentPath})});assert.equal(signedIn.status,302);
  const consent=await browser(consentPath);assert.equal(consent.status,200);const html=await consent.text();csrf=/name="csrf" value="([^"]+)"/.exec(html)[1];
  const approvalBody=new URLSearchParams({csrf,requestId:new URL(consentPath,base).searchParams.get('request'),decision:'approve',workspaceIds:'one'});for(const scope of scopes)approvalBody.append('scopes',scope);
  const approval=await browser('/connector/consent',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:approvalBody});assert.equal(approval.status,302);const redirect=new URL(approval.headers.get('location'));assert.equal(redirect.searchParams.get('state'),'test-state');const code=redirect.searchParams.get('code');
  const tokenBody={grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:client.redirect_uris[0],resource:base+'/mcp'};
  const tokenResponse=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(tokenBody)});assert.equal(tokenResponse.status,200);const tokens=await tokenResponse.json();
  return {tokens,client,tokenBody,browser,csrf};
}
async function connect(tokens){const client=new Client({name:'test-client',version:'1.0.0'},{capabilities:{}});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}}));return client;}
const data=result=>JSON.parse(result.content[0].text);
test('OAuth metadata and unauthenticated challenges identify the protected MCP resource',async()=>{
  const metadata=await(await request('/.well-known/oauth-protected-resource/mcp')).json();assert.equal(metadata.resource,base+'/mcp');assert.deepEqual(metadata.scopes_supported,['social:read','social:drafts','social:publish','social:schedule']);
  const denied=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata=/);
  assert.equal((await request('/connector')).status,302);
  assert.equal((await request('/connector/login')).headers.get('referrer-policy'),'same-origin');
  const rootMetadata=await(await request('/.well-known/oauth-protected-resource')).json();const serverMetadata=await(await request('/.well-known/oauth-authorization-server')).json();assert.equal(rootMetadata.authorization_servers[0],serverMetadata.issuer);
});
test('PKCE authorization codes cannot be reused and tokens are hashed at rest',async()=>{
  const {tokens,tokenBody}=await grant();
  const repeat=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(tokenBody)});assert.equal(repeat.status,400);
  assert.equal(JSON.stringify(db.tables.get('mcp_tokens')).includes(tokens.access_token),false);
  const bad=await service.provider.verifyAccessToken('wrong').then(()=>false,()=>true);assert.equal(bad,true);
});
test('refresh narrows scopes, rotates the token, and detects replay',async()=>{
  const {tokens,client}=await grant();
  const body={grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,scope:'social:read',resource:base+'/mcp'};
  const refreshed=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});assert.equal(refreshed.status,200);const next=await refreshed.json();assert.equal(next.scope,'social:read');assert.notEqual(next.refresh_token,tokens.refresh_token);
  const replay=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});assert.equal(replay.status,400);
  await assert.rejects(service.provider.verifyAccessToken(next.access_token),/revoked/);
});
test('read-only access hides write tools and cannot read an unapproved workspace or credentials',async()=>{
  const {tokens}=await grant(['social:read']);const client=await connect(tokens);
  try{const tools=(await client.listTools()).tools.map(t=>t.name);assert.ok(!tools.includes('create_drafts'));assert.ok(!tools.includes('confirm_post'));const workspaces=data(await client.callTool({name:'list_workspaces',arguments:{}}));assert.deepEqual(workspaces.workspaces,[{id:'one',name:'Workspace One'}]);const context=await client.callTool({name:'get_workspace_context',arguments:{workspaceId:'one'}});assert.equal(JSON.stringify(context).includes('must-never-appear'),false);const denied=await client.callTool({name:'get_workspace_context',arguments:{workspaceId:'two'}});assert.equal(denied.isError,true);}finally{await client.close();}
});
test('draft saves are idempotent and reject destinations from another workspace',async()=>{
  const {tokens}=await grant();const client=await connect(tokens);
  try{const args={workspaceId:'one',requestId:'draft-save-1',drafts:[{content:'An introduction',destinations:[{platform:'facebook',accountId:'page-one'}]}]};const first=data(await client.callTool({name:'create_drafts',arguments:args}));const again=data(await client.callTool({name:'create_drafts',arguments:args}));assert.deepEqual(again.draftIds,first.draftIds);const invalid=await client.callTool({name:'create_drafts',arguments:{...args,requestId:'invalid-destination',drafts:[{content:'Wrong workspace',destinations:[{platform:'facebook',accountId:'page-two'}]}]}});assert.equal(invalid.isError,true);}finally{await client.close();}
});
test('plans supplied by ChatGPT preserve campaign context and link to the correct workspace',async()=>{
  const {tokens}=await grant(undefined,'chatgpt');const client=await connect(tokens);
  try{const args={workspaceId:'one',requestId:'plan-save-1',month:'2026-11',campaignContext:'Highlight XXXX',brief:{theme:'Introductions',pillars:['Feature']},posts:[{platform:'facebook',content:'Meet XXXX',week:1,suggestedDay:'Monday',suggestedTime:'09:00'}]};const result=data(await client.callTool({name:'save_content_plan',arguments:args}));assert.equal(result.success,true);assert.match(result.url,/workspace=one/);const plan=data(await client.callTool({name:'get_content_plan',arguments:{workspaceId:'one',planId:result.calendarId}}));assert.equal(plan.plan.campaignContext,args.campaignContext);}finally{await client.close();}
});
test('publishing only happens after confirmation and cannot repeat on a retry',async()=>{
  const {tokens}=await grant(undefined,'chatgpt');const client=await connect(tokens);const initial=deliveries.length;
  try{const preview=data(await client.callTool({name:'prepare_post',arguments:{workspaceId:'one',content:'Publish this exact text',destinations:[{platform:'facebook',accountId:'page-one'}]}}));assert.equal(deliveries.length,initial);assert.equal(preview.requiresUserConfirmation,true);const params={workspaceId:'one',previewId:preview.previewId,confirmation:'CONFIRM'};const result=data(await client.callTool({name:'confirm_post',arguments:params}));assert.equal(result.success,true);await client.callTool({name:'confirm_post',arguments:params});assert.equal(deliveries.length,initial+1);assert.equal(deliveries.at(-1)[4]['Idempotency-Key'],'mcp_'+preview.previewId);}finally{await client.close();}
});
test('scheduling uses the approved UTC timestamp and preserves its outcome on retries',async()=>{
  const {tokens}=await grant(undefined,'chatgpt');const client=await connect(tokens);const initial=schedules.length;const scheduledAt=new Date(Date.now()+86400000).toISOString();
  try{const preview=data(await client.callTool({name:'prepare_post',arguments:{workspaceId:'one',content:'Later post',destinations:[{platform:'facebook',accountId:'page-one'}],scheduledAt}}));const args={workspaceId:'one',previewId:preview.previewId,confirmation:'CONFIRM'};await client.callTool({name:'confirm_post',arguments:args});await client.callTool({name:'confirm_post',arguments:args});assert.equal(schedules.length,initial+1);assert.equal(schedules.at(-1)[2].scheduledAt,scheduledAt);}finally{await client.close();}
});
test('revocation immediately blocks existing access tokens',async()=>{
  const {tokens}=await grant();const info=await service.provider.verifyAccessToken(tokens.access_token);await service.provider.revokeGrant(info.extra.grantId);const denied=await request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);
});
test('connector owner forms reject forged requests and unsafe dynamic redirects',async()=>{
  const form=await request('/connector/login');const csrf=/name="csrf" value="([^"]+)"/.exec(await form.text())[1];const cookie=form.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const login=await request('/connector/login',{method:'POST',headers:{Origin:'https://chatgpt.com',Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password,csrf})});assert.equal(login.status,403);
  const invalid=await request('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['http://evil.example/callback'],token_endpoint_auth_method:'none'})});assert.equal(invalid.status,400);
});
test('PKCE, redirect binding and resource binding reject incorrect exchanges without consuming the valid code',async()=>{
  const registration=await request('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'PKCE test',redirect_uris:['https://claude.ai/api/mcp/auth_callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});const client=await registration.json();
  const verifier='p'.repeat(64);let approvalPath;
  await service.provider.authorize(client,{redirectUri:client.redirect_uris[0],codeChallenge:createHash('sha256').update(verifier).digest('base64url'),scopes:['social:read'],resource:new URL(base+'/mcp')},{redirect:value=>{approvalPath=value;}});
  const location=await service.provider.approveAuthorization(new URL(approvalPath,base).searchParams.get('request'),['one'],['social:read']);
  const body={client_id:client.client_id,grant_type:'authorization_code',code:new URL(location).searchParams.get('code'),code_verifier:verifier,redirect_uri:client.redirect_uris[0],resource:base+'/mcp'};
  for(const patch of [{code_verifier:'wrong'.repeat(16)},{redirect_uri:'https://other.example/callback'},{resource:'https://other.example/mcp'}]){
    const rejected=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,...patch})});assert.equal(rejected.status,400);
  }
  const accepted=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});assert.equal(accepted.status,200);
});
test('connector configuration keeps existing settings and never prints the password',()=>{
  const fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'smm-connector-setup-'));
  try{
    fs.mkdirSync(path.join(folder,'scripts'));const script=path.join(folder,'scripts/configure-connector.cjs');fs.copyFileSync(path.resolve(__dirname,'../../../scripts/configure-connector.cjs'),script);fs.writeFileSync(path.join(folder,'.env'),'ENCRYPTION_KEY=preserve-this-setting\n');
    const configured=spawnSync(process.execPath,[script,'--url','https://manager.example/mcp'],{encoding:'utf8'});assert.equal(configured.status,0);
    const password=fs.readFileSync(path.join(folder,'.connector-owner-password'),'utf8').trim();assert.equal(configured.stdout.includes(password),false);const originalEnv=fs.readFileSync(path.join(folder,'.env'),'utf8');assert.match(originalEnv,/ENCRYPTION_KEY=preserve-this-setting/);assert.match(originalEnv,/MCP_PUBLIC_URL=https:\/\/manager.example\/mcp/);
    const repeated=spawnSync(process.execPath,[script,'--url','https://manager.example/mcp'],{encoding:'utf8'});assert.equal(repeated.status,0);assert.equal(fs.readFileSync(path.join(folder,'.connector-owner-password'),'utf8').trim(),password);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});


test('ChatGPT origins are allowed without weakening connector owner form protection',async()=>{
  for(const origin of ['https://chatgpt.com','https://claude.ai']){
    const mcp=await request('/mcp',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(mcp.status,401);assert.match(mcp.headers.get('www-authenticate'),/resource_metadata=/);
  }
  for(const origin of ['https://chatgpt.com.evil.example','https://evil.example','null']){
    const denied=await request('/mcp',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
  }

});

test('ChatGPT DCR grants expose scope metadata and enforce schedule-only and workspace access',async()=>{
  const {tokens,client:registration,browser}=await grant(['social:read','social:drafts','social:schedule'],'chatgpt');const client=await connect(tokens);
  try{
    const tools=(await client.listTools()).tools;
    assert.deepEqual(tools.find(t=>t.name==='create_drafts')._meta.securitySchemes,[{type:'oauth2',scopes:['social:read','social:drafts']}]);
    assert.deepEqual(tools.find(t=>t.name==='confirm_post')._meta.securitySchemes,[{type:'oauth2',scopes:['social:read','social:schedule']}]);
    assert.equal(tools.find(t=>t.name==='confirm_post').annotations.destructiveHint,true);
    assert.equal(tools.find(t=>t.name==='confirm_post').annotations.openWorldHint,true);
    assert.equal(tools.find(t=>t.name==='list_workspaces').annotations.readOnlyHint,true);
    assert.equal(JSON.stringify(tools).includes('Claude'),false);
    const dashboard=await(await browser('/connector')).text();assert.match(dashboard,/ChatGPT test/);assert.match(dashboard,/Claude test/);
    const params={workspaceId:'one',content:'Schedule-only permission',destinations:[{platform:'facebook',accountId:'page-one'}]};
    assert.equal((await client.callTool({name:'prepare_post',arguments:params})).isError,true);
    assert.equal((await client.callTool({name:'get_workspace_context',arguments:{workspaceId:'two'}})).isError,true);
    const info=await service.provider.verifyAccessToken(tokens.access_token);assert.equal((await service.provider.getGrant(info.extra.grantId)).clientId,registration.client_id);
    const otherGrant=(await db.collection('mcp_grants').find({clientName:'Claude test'}).toArray()).find(value=>!value.revokedAt);assert.ok(otherGrant);
    await service.provider.revokeGrant(info.extra.grantId);await assert.rejects(client.listTools());assert.equal((await service.provider.getGrant(otherGrant._id)).clientName,'Claude test');
  }finally{await client.close();}
});

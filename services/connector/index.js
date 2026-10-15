require('dotenv').config();
const express=require('express');
const axios=require('axios');
const {rateLimit}=require('express-rate-limit');
const {mcpAuthRouter,getOAuthProtectedResourceMetadataUrl}=require('@modelcontextprotocol/sdk/server/auth/router.js');
const {requireBearerAuth}=require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const {StreamableHTTPServerTransport}=require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {createAuthProvider,SCOPES}=require('./auth');
const {mountAdmin}=require('./admin');
const {createToolServer}=require('./tools');
const {mountLocalAssistant}=require('./local');
const {buildChatgptPlugin}=require('./chatgpt-plugin');
const {getDb}=require('./utils/MongoDBConnector');
const {createLogger}=require('./utils/logger');
async function createApp(options={}){
  const dbProvider=options.getDb||getDb;
  const resourceUrl=new URL(options.publicUrl||process.env.MCP_PUBLIC_URL||new URL('/mcp',process.env.APP_BASE_URL||'http://localhost:8081').href);
  if(resourceUrl.pathname!=='/mcp'||resourceUrl.search||resourceUrl.hash||resourceUrl.username||resourceUrl.password)throw new Error('MCP_PUBLIC_URL must be an absolute /mcp URL without query or credentials');
  if(resourceUrl.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(resourceUrl.hostname))throw new Error('MCP_PUBLIC_URL must use HTTPS');
  const adminPasswordHash=options.adminPasswordHash||process.env.MCP_ADMIN_PASSWORD_HASH||'';
  const app=express();const log=options.log||createLogger('connector');app.disable('x-powered-by');app.set('trust proxy',1);
  app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});next();});
  const configured=/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(adminPasswordHash);
  app.get('/health',(_req,res)=>res.status(configured?200:503).json({status:configured?'ok':'not_configured',service:'connector'}));
  app.get('/connector/info',(_req,res)=>res.json({resourceUrl:resourceUrl.href,configured}));
  app.use((req,res,next)=>{
    const host=req.headers.host?.split(':')[0];
    if(host!==resourceUrl.hostname&&!['localhost','127.0.0.1','connector'].includes(host))return res.status(403).json({error:'Invalid host'});
    if(req.headers.origin&&req.headers.origin!==resourceUrl.origin&&!['https://claude.ai','https://claude.com','https://chatgpt.com'].includes(req.headers.origin))return res.status(403).json({error:'Invalid origin'});
    next();
  });
  app.get('/connector/chatgpt-plugin.zip',(_req,res)=>res.type('application/zip').set('Content-Disposition','attachment; filename="socialmanager-chatgpt-plugin.zip"').send(buildChatgptPlugin(resourceUrl)));
  if(!configured){
    app.use((_req,res)=>res.status(503).type('html').send('<!doctype html><title>Connector setup</title><h1>Connector setup required</h1><p>Your server administrator needs to configure the connector owner password. Existing SocialManager access is unchanged.</p>'));
    return {app,provider:null};
  }
  const db=await dbProvider();
  for(const collection of ['mcp_authorizations','mcp_codes','mcp_tokens','mcp_admin_sessions','mcp_grants','mcp_post_previews','mcp_audit'])await db.collection(collection).createIndex({expiresAt:1},{expireAfterSeconds:0});
  await db.collection('mcp_post_previews').createIndex({workspaceId:1,grantId:1});
  await db.collection('mcp_audit').createIndex({workspaceId:1,createdAt:-1});
  const provider=createAuthProvider({getDb:dbProvider,resourceUrl});
  // Restrict request sizes before the SDK's JSON parsers run.
  app.use(express.json({limit:'2mb'}));
  app.use(mcpAuthRouter({provider,issuerUrl:new URL(resourceUrl.origin),resourceServerUrl:resourceUrl,scopesSupported:SCOPES,resourceName:'SocialManager',serviceDocumentationUrl:new URL('/connector',resourceUrl)}));
  app.get('/.well-known/oauth-protected-resource',(_req,res)=>res.json({resource:resourceUrl.href,authorization_servers:[new URL(resourceUrl.origin).href],scopes_supported:SCOPES}));
  const adminAccess=mountAdmin(app,{getDb:dbProvider,provider,adminPasswordHash,resourceUrl,rateLimit});
  const auth=requireBearerAuth({verifier:provider,resourceMetadataUrl:getOAuthProtectedResourceMetadataUrl(resourceUrl),expectedResource:resourceUrl});
  const call=(base)=>async(method,path,data,workspaceId,headers={})=>{
    const response=await axios.request({method,url:base+path,data,timeout:130000,headers:{'X-Workspace-Id':workspaceId,...headers}});return response.data;
  };
  const callGateway=options.callGateway||call(process.env.GATEWAY_URL||'http://gateway:8084');
  const callScheduler=options.callScheduler||call(process.env.SCHEDULER_URL||'http://scheduler:3011');
  await mountLocalAssistant(app,{db,provider,adminAccess,callGateway,callScheduler,publicOrigin:resourceUrl.origin,log,requestModel:options.requestLocalModel,inspectModel:options.inspectLocalModel});
  app.post('/mcp',auth,rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res,next)=>{
    const server=createToolServer({db,auth:req.auth,provider,callGateway,callScheduler,publicOrigin:resourceUrl.origin,log});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{transport.close().catch(()=>{});server.close().catch(()=>{});});
    try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch(err){next(err);}
  });
  app.all('/mcp',auth,(_req,res)=>res.status(405).set('Allow','POST').json({error:'Use Streamable HTTP POST'}));
  app.use((err,_req,res,_next)=>{log.error({action:'connector_request',error:err.name});if(!res.headersSent)res.status(err.status===413?413:500).json({error:err.status===413?'Request too large':'Connector request failed'});});
  return {app,provider};
}
if(require.main===module)createApp().then(({app})=>{const server=app.listen(Number(process.env.PORT||3012),'0.0.0.0');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));}).catch(err=>{createLogger('connector').error({action:'startup',error:err.message});process.exit(1);});
module.exports={createApp};

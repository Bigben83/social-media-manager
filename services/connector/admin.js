const express = require('express');
const { randomToken, hash, checkPassword } = require('./auth');
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const permissionNames = { 'social:read':'Read profiles, plans, drafts, media and post history', 'social:drafts':'Create content plans and drafts', 'social:publish':'Publish posts immediately', 'social:schedule':'Schedule posts for future delivery' };
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · SocialManager</title><link rel="stylesheet" href="/connector/style.css"></head><body><main><a href="/global-settings">← SocialManager settings</a><h1>${escape(title)}</h1>${body}</main></body></html>`;
}
const cookie = (req,name) => (req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).find(([key])=>key===name)?.[1];
function mountAdmin(app, { getDb, provider, adminPasswordHash, resourceUrl, rateLimit }) {
  const secure = resourceUrl.protocol === 'https:';
  const sessionName = secure ? '__Host-smm-connector' : 'smm-connector';
  const csrfName = secure ? '__Host-smm-connector-csrf' : 'smm-connector-csrf';
  const cookieOptions = { httpOnly:true, secure, sameSite:'lax', path:'/' };
  const version = hash(adminPasswordHash);
  async function getSession(req) {
    const value=cookie(req,sessionName);if(!value)return null;
    return (await getDb()).collection('mcp_admin_sessions').findOne({_id:hash(value),version,expiresAt:{$gt:new Date()}});
  }
  const csrfToken = res => {const token=randomToken();res.cookie(csrfName,token,{...cookieOptions,maxAge:8*3600000});return token;};
  const formToken = res => `<input type="hidden" name="csrf" value="${csrfToken(res)}">`;
  function validForm(req) {
    const expected=cookie(req,csrfName),supplied=req.body?.csrf;
    return typeof supplied==='string'&&!!expected&&hash(supplied)===hash(expected)&&(!req.headers.origin||req.headers.origin===resourceUrl.origin);
  }
  function returnTo(req) {const value=req.body?.returnTo||req.query.returnTo;return value==='/local-assistant'||typeof value==='string'&&/^\/connector\/authorize\?request=[a-f0-9-]{36}$/.test(value)?value:'/connector';}
  async function requireAdmin(req,res,next){if(!await getSession(req))return res.redirect('/connector/login?returnTo='+encodeURIComponent(req.originalUrl));next();}
  app.get('/connector/style.css',(_req,res)=>res.type('css').send('body{margin:0;background:#080d18;color:#e5e7eb;font:15px system-ui}main{max-width:760px;margin:48px auto;padding:24px}a{color:#a78bfa}h1{font-size:26px}h2{font-size:19px;margin-top:28px}p{line-height:1.6;color:#b8c0d0}form,section{border:1px solid #334155;background:#111827;border-radius:12px;padding:20px;margin:20px 0}label{display:block;margin:14px 0}input[type=password]{display:block;box-sizing:border-box;width:100%;padding:12px;margin:10px 0;background:#1f2937;border:1px solid #64748b;color:white;border-radius:6px}button{padding:10px 18px;border:0;border-radius:6px;background:#7c3aed;color:white;cursor:pointer;margin:8px 8px 0 0}button.danger{background:#991b1b}code{word-break:break-all}small{color:#9ca3af}.error{color:#fca5a5}ul{padding-left:22px}li{margin:7px 0}'));
  app.get('/connector/login',(req,res)=>res.send(page('Connect your chat app to SocialManager',`<p>Sign in with the connector owner password provided by your server administrator. This password protects connector approvals and is separate from your Claude or ChatGPT account.</p>${req.query.failed?'<p class="error">Sign-in failed. Check the connector password and try again.</p>':''}<form method="post" action="/connector/login">${formToken(res)}<input type="hidden" name="returnTo" value="${escape(returnTo(req))}"><label for="password">Connector password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button>Sign in</button></form>`)));
  app.post('/connector/login',rateLimit({windowMs:900000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}),express.urlencoded({extended:false,limit:'8kb'}),async(req,res)=>{
    if(!validForm(req))return res.status(403).send(page('Request expired','<p>Reload the sign-in page and try again.</p>'));
    if(!checkPassword(req.body.password,adminPasswordHash))return res.redirect('/connector/login?failed=1&returnTo='+encodeURIComponent(returnTo(req)));
    const token=randomToken();await(await getDb()).collection('mcp_admin_sessions').insertOne({_id:hash(token),version,expiresAt:new Date(Date.now()+8*3600000)});
    res.cookie(sessionName,token,{...cookieOptions,maxAge:8*3600000});res.redirect(returnTo(req));
  });
  app.get('/connector',requireAdmin,async(req,res)=>{
    const db=await getDb();const grants=await db.collection('mcp_grants').find({}).sort({createdAt:-1}).limit(100).toArray();const workspaces=await db.collection('workspaces').find({}).toArray();
    const token=formToken(res);
    res.send(page('Chat connector access',`<p>Connect Claude or ChatGPT using this MCP server URL:</p><p><code>${escape(resourceUrl.href)}</code></p><p><strong>ChatGPT:</strong> If your + menu includes Add custom MCP server, enter this URL and choose OAuth with dynamic client registration (DCR). If you see Create plugin / Upload plugin instead, <a href="/connector/chatgpt-plugin.zip">download the SocialManager plugin ZIP</a>, use Upload plugin, and inspect the MCP connection. Complete OAuth here, approve workspaces/permissions, then select the installed plugin with @ in a new conversation. Plugin Creator makes workflows; creating instructions alone does not connect this server. Account/workspace policies apply. If upload does not show the MCP connection, retain the exact error and check custom MCP availability with your admin or OpenAI support. No secret credentials are included in the ZIP.</p><p><strong>Claude:</strong> Add a custom connector with this URL. Choose OAuth and <strong>Register automatically</strong> when prompted, then approve access here.</p><p><strong>Local Ollama:</strong> Open the <a href="/local-assistant">local assistant</a>, select session permissions for the current workspace, and start a conversation. Its publishing and scheduling previews can only be confirmed by clicking the button in SocialManager.</p><p>Each app has its own approval and revocation. Your chat app writes the content in the conversation and saves it back here; this workflow needs no generation API key. Publishing and scheduling require a preview and your explicit confirmation.</p><h2>Approved connections</h2>${grants.length?grants.map(grant=>`<section><strong>${escape(grant.clientName)}</strong><p>Workspaces: ${escape(grant.workspaceIds.map(id=>workspaces.find(w=>w._id===id)?.name||'Deleted workspace').join(', '))}</p><p>${escape(grant.scopes.map(scope=>permissionNames[scope]).join(' · '))}</p><small>Expires ${escape(new Date(grant.expiresAt).toISOString().slice(0,10))}${grant.revokedAt?' · Revoked':''}</small>${!grant.revokedAt?`<form method="post" action="/connector/revoke">${token}<input type="hidden" name="grantId" value="${escape(grant._id)}"><button class="danger">Revoke connection</button></form>`:''}</section>`).join(''):'<p>No connections approved yet.</p>'}<form method="post" action="/connector/logout">${token}<button>Sign out</button></form>`));
  });
  app.get('/connector/authorize',requireAdmin,async(req,res)=>{
    const db=await getDb();const pending=await db.collection('mcp_authorizations').findOne({_id:req.query.request,expiresAt:{$gt:new Date()}});if(!pending)return res.status(400).send(page('Authorization expired','<p>Return to your chat app and connect again.</p>'));
    const workspaces=(await db.collection('workspaces').find({}).toArray()).filter(w=>!w.deleting);
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'self'; form-action 'self' "+new URL(pending.redirectUri).origin+"; frame-ancestors 'none'; base-uri 'none'");
    res.send(page('Approve connector access',`<p><strong>${escape(pending.clientName)}</strong> is requesting access to SocialManager.</p><p>Return address: <code>${escape(pending.redirectUri)}</code></p><form method="post" action="/connector/consent">${formToken(res)}<input type="hidden" name="requestId" value="${escape(pending._id)}"><h2>Workspaces</h2><p>Select the workspaces this connection may use.</p>${workspaces.map(w=>`<label><input type="checkbox" name="workspaceIds" value="${escape(w._id)}"> ${escape(w.name)}</label>`).join('')}<h2>Permissions</h2>${pending.scopes.map(scope=>`<label><input type="checkbox" name="scopes" value="${escape(scope)}" ${['social:read','social:drafts'].includes(scope)?'checked':''}> ${escape(permissionNames[scope])}</label>`).join('')}<p>Publishing and scheduling can send posts to your connected accounts. Your chat app must show you the prepared content, accounts and time and ask for confirmation before execution.</p><button name="decision" value="approve">Approve connection</button><button name="decision" value="deny" class="danger">Deny</button></form>`));
  });
  app.post('/connector/consent',express.urlencoded({extended:false,limit:'16kb'}),requireAdmin,async(req,res)=>{
    if(!validForm(req))return res.status(403).send(page('Request expired','<p>Reload the approval page and try again.</p>'));
    if(req.body.decision==='deny'){
      const pending=await(await getDb()).collection('mcp_authorizations').findOneAndDelete({_id:req.body.requestId,expiresAt:{$gt:new Date()}});if(!pending)return res.status(400).send('Request expired');const url=new URL(pending.redirectUri);url.searchParams.set('error','access_denied');if(pending.state)url.searchParams.set('state',pending.state);return res.redirect(url.href);
    }
    const array=value=>typeof value==='string'?[value]:Array.isArray(value)?value.filter(v=>typeof v==='string'):[];
    try{const redirect=await provider.approveAuthorization(req.body.requestId,[...new Set(array(req.body.workspaceIds))],[...new Set(array(req.body.scopes))]);res.redirect(redirect);}catch(err){res.status(400).send(page('Connection could not be approved',`<p class="error">${escape(err.message)}</p><p>Return to your chat app and connect again.</p>`));}
  });
  app.post('/connector/revoke',express.urlencoded({extended:false,limit:'8kb'}),requireAdmin,async(req,res)=>{if(!validForm(req))return res.status(403).send('Invalid request');if(typeof req.body.grantId==='string')await provider.revokeGrant(req.body.grantId);res.redirect('/connector');});
  app.post('/connector/logout',express.urlencoded({extended:false,limit:'8kb'}),requireAdmin,async(req,res)=>{if(!validForm(req))return res.status(403).send('Invalid request');await(await getDb()).collection('mcp_admin_sessions').deleteOne({_id:hash(cookie(req,sessionName))});res.clearCookie(sessionName,cookieOptions);res.redirect('/connector/login');});
  return {getSession,validForm,csrfToken};
}
module.exports={mountAdmin};

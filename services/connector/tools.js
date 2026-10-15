const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { ObjectId } = require('mongodb');
const { createHash, randomUUID } = require('crypto');
const { validatePost, scheduleDelay, destinationKey } = require('./utils/publishing');
const PLATFORMS = ['facebook','instagram','twitter','mastodon','bluesky','pinterest','tiktok'];
const workspaceSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const idSchema = z.string().regex(/^[a-f0-9]{24}$/);
const requestSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).describe('A stable unique identifier for this save operation. Reuse the same identifier on retries.');
const destinationSchema = z.object({ platform: z.enum(PLATFORMS), accountId: z.string().min(1).max(200).optional(), imageUrl: z.string().max(2048).optional(), videoUrl: z.string().max(2048).optional(), link: z.string().url().max(2048).optional() });
const postSchema = z.object({ platform: z.enum(PLATFORMS), content: z.string().trim().min(1).max(20000), week: z.number().int().min(1).max(4), suggestedDay: z.enum(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']), suggestedTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), hashtags: z.array(z.string().max(100)).max(15).default([]), postType: z.enum(['educational','promotional','engagement','storytelling']).default('educational') });
const objectId = text => new ObjectId(createHash('sha256').update(text).digest('hex').slice(0,24));
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicResult = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
function createToolServer({ db, auth, provider, callGateway, callScheduler, publicOrigin, log }) {
  const server = new McpServer({ name: 'SocialManager', version: '1.0.0' }, { instructions: 'Use list_workspaces first and explicitly identify the intended workspace. Claude writes content in this conversation; saving plans/drafts does not call a generation API. Before publishing or scheduling, prepare_post, present the exact preview to the user, and call confirm_post only after their explicit confirmation. Never claim a post was published unless the returned delivery results confirm it.' });
  async function check(workspaceId, scope) {
    const grant = await provider.getGrant(auth.extra.grantId);
    if (!auth.scopes.includes(scope) || !grant.scopes.includes(scope)) throw new Error('Permission not granted: ' + scope);
    if (!grant.workspaceIds.includes(workspaceId)) throw new Error('Workspace access was not granted');
    const workspace = await db.collection('workspaces').findOne({ _id: workspaceId });
    if (!workspace || workspace.deleting) throw new Error('Workspace is unavailable');
    return workspace;
  }
  async function accounts(workspaceId) {
    const result = [];
    for (const [platform, field] of [['facebook','pages'],['instagram','accounts'],['pinterest','boards']]) {
      const cred = await db.collection('platform_credentials').findOne({ _id: workspaceId + ':' + platform });
      for (const account of cred?.[field] || []) if (account.selected) result.push({ key: platform + ':' + account.id, platform, accountId: account.id, name: account.name || account.username || account.id });
    }
    const tiktok = await db.collection('platform_credentials').findOne({ _id: workspaceId + ':tiktok' });
    if (tiktok?.accessToken) result.push({ key: 'tiktok', platform: 'tiktok', name: tiktok.username || 'TikTok' });
    for (const platform of ['twitter','mastodon','bluesky']) {
      const cred = await db.collection('platform_credentials').findOne({ _id: workspaceId + ':' + platform });
      const envPresent = workspaceId === 'default' && !!process.env[{ twitter: 'TWITTER_ACCESS_TOKEN', mastodon: 'MASTODON_ACCESS_TOKEN', bluesky: 'BLUESKY_APP_PASSWORD' }[platform]];
      if (cred || envPresent) result.push({ key: platform, platform, name: platform });
    }
    return result;
  }
  async function checkDestinations(workspaceId, destinations) {
    const available = await accounts(workspaceId);
    for (const destination of destinations) {
      if (!available.some(account => account.key === destinationKey(destination))) throw new Error('Destination is not connected to this workspace: ' + destinationKey(destination));
      for (const field of ['imageUrl','videoUrl']) {
        if (!destination[field]) continue;
        const url = new URL(destination[field], publicOrigin);
        const match = /^\/media\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname);
        if (url.origin !== publicOrigin || !match || !await db.collection('media_files').findOne({ filename: match[1], workspaceId })) throw new Error('Use media uploaded to this workspace Media Library');
        destination[field] = url.href;
      }
    }
  }
  function tool(name, description, schema, scope, callback, options = {}) {
    // Hidden tools remain enforced server-side even if a client caches an older listing.
    if (scope && !auth.scopes.includes(scope)) return;
    if (options.dispatch && !auth.scopes.some(scope => ['social:publish','social:schedule'].includes(scope))) return;
    server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: options.readOnly || false, destructiveHint: options.destructive || false, idempotentHint: options.idempotent || false, openWorldHint: options.openWorld || false } }, async args => {
      try {
        if (args.workspaceId) await check(args.workspaceId, scope || 'social:read');
        const result = await callback(args);
        await db.collection('mcp_audit').insertOne({ grantId: auth.extra.grantId, workspaceId: args.workspaceId || null, tool: name, outcome: 'success', createdAt: new Date(), expiresAt: new Date(Date.now()+90*86400000) });
        return publicResult(result);
      } catch (err) {
        log?.warn({ action: 'mcp_tool', tool: name, outcome: 'failure', error: err.message });
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    });
  }
  tool('list_workspaces','List only the workspaces authorised for this connector.',{},'social:read',async()=>{
    const grant = await provider.getGrant(auth.extra.grantId);
    const rows = await db.collection('workspaces').find({ _id: { $in: grant.workspaceIds } }).toArray();
    return { workspaces: rows.filter(w=>!w.deleting).map(w=>({ id:w._id,name:w.name })) };
  },{readOnly:true});
  tool('get_workspace_context','Read brand profiles and connected publishing destinations for a workspace. Never returns credentials.',{ workspaceId: workspaceSchema },'social:read',async({workspaceId})=>{
    const workspace = await check(workspaceId,'social:read');
    const fields = ['businessName','websiteUrl','description','industry','toneOfVoice','targetAudience','keywords','hashtags','postingGuidelines','timezone'];
    const profiles = await db.collection('account_profiles').find({workspaceId}).toArray();
    return { workspace: {id:workspace._id,name:workspace.name}, profiles: profiles.map(p=>({accountKey:String(p._id).replace(workspaceId+':',''),...Object.fromEntries(fields.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))})), accounts:await accounts(workspaceId) };
  },{readOnly:true});
  tool('list_content_plans','List saved content calendars for the workspace.',{workspaceId:workspaceSchema,limit:z.number().int().min(1).max(20).default(10)},'social:read',async({workspaceId,limit})=>{
    const rows=await db.collection('content_calendars').find({workspaceId}).sort({createdAt:-1}).limit(limit).toArray();
    return {plans:rows.map(p=>({id:String(p._id),month:p.month,monthName:p.monthName,platforms:p.platforms,brief:p.brief,campaignContext:p.campaignContext||'',postCount:p.posts?.length||0}))};
  },{readOnly:true});
  tool('get_content_plan','Read a saved calendar, including the campaign context and drafted posts.',{workspaceId:workspaceSchema,planId:idSchema},'social:read',async({workspaceId,planId})=>{
    const plan=await db.collection('content_calendars').findOne({_id:new ObjectId(planId),workspaceId});if(!plan)throw new Error('Plan not found');return {plan};
  },{readOnly:true});
  tool('save_content_plan','Save a complete content plan written in this Claude conversation. Does not generate content or publish. Reuse requestId to avoid duplicates.',{workspaceId:workspaceSchema,requestId:requestSchema,month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),accountKey:z.string().max(200).optional(),campaignContext:z.string().max(20000).default(''),brief:z.object({theme:z.string().min(1).max(2000),pillars:z.array(z.string().max(1000)).max(20),toneGuidance:z.string().max(2000).default(''),platformNotes:z.record(z.enum(PLATFORMS),z.string().max(2000)).optional()}),posts:z.array(postSchema).min(1).max(196)},'social:drafts',async args=>{
    const {workspaceId,requestId,...content}=args;const _id=objectId(`${auth.extra.grantId}:${workspaceId}:plan:${requestId}`),digest=fingerprint(content);
    const old=await db.collection('content_calendars').findOne({_id,workspaceId});if(old&&old.mcpFingerprint!==digest)throw new Error('requestId already saved a different plan');
    const platforms=[...new Set(content.posts.map(p=>p.platform))];
    const monthName=new Date(content.month+'-01T00:00:00Z').toLocaleString('en',{month:'long',year:'numeric',timeZone:'UTC'});
    await db.collection('content_calendars').updateOne({_id,workspaceId},{$setOnInsert:{...content,workspaceId,monthName,platforms,postsPerWeek:Math.max(1,Math.round(content.posts.length/platforms.length/4)),source:'claude-mcp',mcpGrantId:auth.extra.grantId,mcpFingerprint:digest,createdAt:new Date()}},{upsert:true});
    return {success:true,calendarId:String(_id),postCount:content.posts.length,url:publicOrigin+'/calendar-plan?calendar='+_id+'&workspace='+encodeURIComponent(workspaceId)};
  },{idempotent:true});
  tool('list_drafts','Read saved drafts in this workspace.',{workspaceId:workspaceSchema,limit:z.number().int().min(1).max(50).default(20)},'social:read',async({workspaceId,limit})=>({drafts:await db.collection('drafts').find({workspaceId}).sort({updatedAt:-1}).limit(limit).toArray()}),{readOnly:true});
  tool('create_drafts','Save posts written by Claude as reviewable drafts. Does not publish or schedule delivery. Reuse requestId on retries.',{workspaceId:workspaceSchema,requestId:requestSchema,drafts:z.array(z.object({content:z.string().trim().min(1).max(20000),firstComment:z.string().max(10000).default(''),destinations:z.array(destinationSchema).max(20).default([])})).min(1).max(100)},'social:drafts',async({workspaceId,requestId,drafts})=>{
    const ids=[];
    for(let i=0;i<drafts.length;i++){
      const draft=drafts[i];await checkDestinations(workspaceId,draft.destinations);const _id=objectId(`${auth.extra.grantId}:${workspaceId}:draft:${requestId}:${i}`),digest=fingerprint(draft);
      const old=await db.collection('drafts').findOne({_id,workspaceId});if(old&&old.mcpFingerprint!==digest)throw new Error('requestId already saved different draft text');
      await db.collection('drafts').updateOne({_id,workspaceId},{$setOnInsert:{...draft,destinations:draft.destinations.map(d=>({...d,key:destinationKey(d),selected:true})),mediaUrl:'',scheduledAt:'',source:'claude-mcp',mcpGrantId:auth.extra.grantId,mcpFingerprint:digest,createdAt:new Date(),updatedAt:new Date()}},{upsert:true});ids.push(String(_id));
    }
    return {success:true,draftIds:ids,count:ids.length,url:publicOrigin+'/scheduler?workspace='+encodeURIComponent(workspaceId)};
  },{idempotent:true});
  tool('list_media','List media uploaded to the workspace for use in draft or publishing previews.',{workspaceId:workspaceSchema,limit:z.number().int().min(1).max(50).default(20)},'social:read',async({workspaceId,limit})=>({files:(await db.collection('media_files').find({workspaceId}).sort({uploadedAt:-1}).limit(limit).toArray()).map(f=>({filename:f.filename,name:f.originalName,mimetype:f.mimetype,url:new URL('/media/'+encodeURIComponent(f.filename),publicOrigin).href}))}),{readOnly:true});
  tool('list_scheduled_posts','Read the workspace scheduled posts and their current outcomes.',{workspaceId:workspaceSchema,limit:z.number().int().min(1).max(50).default(20)},'social:read',async({workspaceId,limit})=>({jobs:await db.collection('scheduled_jobs').find({workspaceId}).sort({createdAt:-1}).limit(limit).toArray()}),{readOnly:true});
  tool('prepare_post','Prepare a publishing or scheduling preview, without posting. Present its exact content, accounts, media and time to the user. Only use confirm_post after explicit user confirmation.',{workspaceId:workspaceSchema,content:z.string().trim().min(1).max(20000),destinations:z.array(destinationSchema).min(1).max(20),firstComment:z.string().max(10000).default(''),scheduledAt:z.string().max(100).optional()},null,async({workspaceId,content,destinations,firstComment,scheduledAt})=>{
    const mode=scheduledAt?'schedule':'publish';await check(workspaceId,'social:'+mode);const error=validatePost(content,destinations);if(error)throw new Error(error);if(scheduledAt)scheduleDelay(scheduledAt);
    await checkDestinations(workspaceId,destinations);
    const preview={_id:randomUUID(),workspaceId,grantId:auth.extra.grantId,mode,payload:{content,destinations,firstComment,...(scheduledAt&&{scheduledAt:new Date(scheduledAt).toISOString()})},state:'prepared',createdAt:new Date(),expiresAt:new Date(Date.now()+600000)};
    await db.collection('mcp_post_previews').insertOne(preview);
    const available=await accounts(workspaceId);
    return {previewId:preview._id,mode,...preview.payload,accounts:destinations.map(d=>available.find(a=>a.key===destinationKey(d))),expiresAt:preview.expiresAt,requiresUserConfirmation:true};
  },{dispatch:true});
  tool('confirm_post','Execute an immutable preview only after the user explicitly confirms its exact content, destinations and time. Publishes immediately or schedules delivery. Reuse the same previewId on retries; an uncertain outcome requires account review.',{workspaceId:workspaceSchema,previewId:z.string().uuid(),confirmation:z.literal('CONFIRM')},null,async({workspaceId,previewId})=>{
    const col=db.collection('mcp_post_previews');const query={_id:previewId,workspaceId,grantId:auth.extra.grantId};const preview=await col.findOne(query);if(!preview)throw new Error('Preview not found');await check(workspaceId,'social:'+preview.mode);
    if(preview.state==='complete')return preview.result;
    if(preview.state!=='prepared')return {success:false,uncertain:true,error:'Outcome is not confirmed. Check your account or scheduled posts before creating another preview.'};
    if(preview.expiresAt<=new Date())throw new Error('Preview expired; prepare it again');
    await checkDestinations(workspaceId,preview.payload.destinations);if(preview.mode==='schedule')scheduleDelay(preview.payload.scheduledAt);
    const claimed=await col.updateOne({...query,state:'prepared'},{$set:{state:'dispatching',updatedAt:new Date(),expiresAt:new Date(Date.now()+2*86400000)}});if(!claimed.matchedCount)return {success:false,uncertain:true,error:'This preview is already being processed'};
    let result;
    try{result=preview.mode==='schedule'?await callScheduler('POST','/schedule',preview.payload,workspaceId):await callGateway('POST','/post',preview.payload,workspaceId,{'Idempotency-Key':'mcp_'+previewId});}
    catch(err){result={success:false,error:err.response?.data?.error||'Dispatch could not be confirmed; check the account or scheduled posts',uncertain:!err.response||!!err.response?.data?.uncertain};}
    await col.updateOne(query,{$set:{state:'complete',result,updatedAt:new Date()}});return result;
  },{destructive:true,openWorld:true,idempotent:true,dispatch:true});
  tool('get_post_status','Read the outcome of a publishing/scheduling preview without sending it again.',{workspaceId:workspaceSchema,previewId:z.string().uuid()},'social:read',async({workspaceId,previewId})=>{
    const row=await db.collection('mcp_post_previews').findOne({_id:previewId,workspaceId,grantId:auth.extra.grantId});if(!row)throw new Error('Preview not found');return {state:row.state,result:row.result||null,updatedAt:row.updatedAt||row.createdAt};
  },{readOnly:true});
  return server;
}
module.exports = { createToolServer };

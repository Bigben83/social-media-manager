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
const draftChangesSchema = z.object({
  content: z.string().trim().min(1).max(20000).optional(),
  firstComment: z.string().max(10000).optional().describe('Omit to preserve. Use an empty string to remove the first comment.'),
  mediaUrl: z.string().max(2048).optional().describe('An existing workspace Media Library URL. Omit to preserve; an empty string removes the attachment.'),
  scheduledAt: z.string().refine(value => {
    if (value === '') return true;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
    const date = new Date(value + 'Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,16) === value;
  }, 'Use a valid local YYYY-MM-DDTHH:mm planned date, or an empty string to clear it.').optional().describe('Draft planning only; never queues delivery. Local wall time as shown in Compose. Omit to preserve; empty clears.'),
  destinations: z.array(destinationSchema).max(20).optional().describe('Replace the selected accounts. Omit to preserve; an empty array clears the selections.'),
}).strict().refine(changes => Object.keys(changes).length > 0, 'Supply at least one field to update');
const postSchema = z.object({ platform: z.enum(PLATFORMS), content: z.string().trim().min(1).max(20000), week: z.number().int().min(1).max(4), suggestedDay: z.enum(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']), suggestedTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), hashtags: z.array(z.string().max(100)).max(15).default([]), postType: z.enum(['educational','promotional','engagement','storytelling']).default('educational') });
const objectId = text => new ObjectId(createHash('sha256').update(text).digest('hex').slice(0,24));
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicResult = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
function createToolServer({ db, auth, provider, callGateway, callScheduler, publicOrigin, log }) {
  const server = new McpServer({ name: 'SocialManager', version: '1.2.0' }, { instructions: 'Use list_workspaces first and explicitly identify the intended workspace. Write content in this conversation; saving plans/drafts does not call a generation API. To edit an existing draft, read get_draft and use update_draft with its updatedAt. Omitted fields are preserved. A planned draft date does not queue delivery. Before publishing or scheduling, prepare_post, present the exact preview to the user, and call confirm_post only after their explicit confirmation. Never claim a post was published unless the returned delivery results confirm it.' });
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
  async function checkMedia(workspaceId, value) {
    const url = new URL(value, publicOrigin);
    const match = /^\/media\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname);
    if (url.origin !== publicOrigin || !match || !await db.collection('media_files').findOne({ filename: match[1], workspaceId })) throw new Error('Use media uploaded to this workspace Media Library');
    return url.href;
  }
  async function checkDestinations(workspaceId, destinations) {
    const available = await accounts(workspaceId);
    for (const destination of destinations) {
      if (!available.some(account => account.key === destinationKey(destination))) throw new Error('Destination is not connected to this workspace: ' + destinationKey(destination));
      for (const field of ['imageUrl','videoUrl']) {
        if (destination[field]) destination[field] = await checkMedia(workspaceId, destination[field]);
      }
    }
  }
  async function checkDraftMedia(workspaceId, draft) {
    const media = [...new Set([draft.mediaUrl, ...draft.destinations.flatMap(d => [d.imageUrl, d.videoUrl])].filter(Boolean))];
    // The draft editor has one shared attachment. Separate drafts retain different account artwork.
    const normalized = [];
    for (const value of media) normalized.push(await checkMedia(workspaceId, value));
    if (new Set(normalized).size > 1) throw new Error('Use one shared image or video per draft. Create separate drafts for different attachments.');
    return normalized[0] || '';
  }
  function tool(name, description, schema, scope, callback, options = {}) {
    // Hidden tools remain enforced server-side even if a client caches an older listing.
    if (scope && !auth.scopes.includes(scope)) return;
    if (options.dispatch && !auth.scopes.some(scope => ['social:publish','social:schedule'].includes(scope))) return;
    const scopes = scope ? [...new Set(['social:read', scope])] : ['social:read'];
    // The SDK preserves the documented ChatGPT compatibility metadata on tools/list.
    // Each dispatch scheme is an alternative; publish and schedule are separate grants.
    const securitySchemes = options.dispatch
      ? auth.scopes.filter(value => ['social:publish','social:schedule'].includes(value)).map(value => ({ type: 'oauth2', scopes: [...scopes, value] }))
      : [{ type: 'oauth2', scopes }];
    server.registerTool(name, { description, inputSchema: schema, _meta: { securitySchemes }, annotations: { readOnlyHint: options.readOnly || false, destructiveHint: options.destructive || false, idempotentHint: options.idempotent || false, openWorldHint: options.openWorld || false } }, async args => {
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
  tool('save_content_plan','Save a complete content plan written in this conversation. Does not generate content or publish. Reuse requestId to avoid duplicates.',{workspaceId:workspaceSchema,requestId:requestSchema,month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),accountKey:z.string().max(200).optional(),campaignContext:z.string().max(20000).default(''),brief:z.object({theme:z.string().min(1).max(2000),pillars:z.array(z.string().max(1000)).max(20),toneGuidance:z.string().max(2000).default(''),platformNotes:z.record(z.enum(PLATFORMS),z.string().max(2000)).optional()}),posts:z.array(postSchema).min(1).max(196)},'social:drafts',async args=>{
    const {workspaceId,requestId,...content}=args;const _id=objectId(`${auth.extra.grantId}:${workspaceId}:plan:${requestId}`),digest=fingerprint(content);
    const old=await db.collection('content_calendars').findOne({_id,workspaceId});if(old&&old.mcpFingerprint!==digest)throw new Error('requestId already saved a different plan');
    const platforms=[...new Set(content.posts.map(p=>p.platform))];
    const monthName=new Date(content.month+'-01T00:00:00Z').toLocaleString('en',{month:'long',year:'numeric',timeZone:'UTC'});
    await db.collection('content_calendars').updateOne({_id,workspaceId},{$setOnInsert:{...content,workspaceId,monthName,platforms,postsPerWeek:Math.max(1,Math.round(content.posts.length/platforms.length/4)),source:'mcp',mcpGrantId:auth.extra.grantId,mcpFingerprint:digest,createdAt:new Date()}},{upsert:true});
    return {success:true,calendarId:String(_id),postCount:content.posts.length,url:publicOrigin+'/calendar-plan?calendar='+_id+'&workspace='+encodeURIComponent(workspaceId)};
  },{idempotent:true});
  tool('list_drafts','Read saved drafts in this workspace.',{workspaceId:workspaceSchema,limit:z.number().int().min(1).max(50).default(20)},'social:read',async({workspaceId,limit})=>({drafts:await db.collection('drafts').find({workspaceId}).sort({updatedAt:-1}).limit(limit).toArray()}),{readOnly:true});
  tool('get_draft','Read an existing draft, including its text, attachment, selected accounts, planned date and updatedAt. Read before update_draft; use its exact updatedAt to avoid overwriting newer edits.',{workspaceId:workspaceSchema,draftId:idSchema},'social:read',async({workspaceId,draftId})=>{
    const draft=await db.collection('drafts').findOne({_id:new ObjectId(draftId),workspaceId});
    if(!draft)throw new Error('Draft not found');
    return {draft};
  },{readOnly:true});
  tool('update_draft','Edit an existing draft in place, including drafts created in the app or another connector. Read get_draft first and pass its updatedAt as expectedUpdatedAt. Send only changed fields. Omitted fields are preserved; empty mediaUrl/firstComment/scheduledAt or destinations clears that field. One shared workspace-owned attachment per draft. Does not publish, queue delivery, or change already scheduled posts. Reuse requestId and the same arguments on retries; reread on a conflict.',{
    workspaceId:workspaceSchema,draftId:idSchema,requestId:requestSchema,
    expectedUpdatedAt:z.string().datetime({offset:true}).describe('The exact updatedAt returned by get_draft or list_drafts.'),
    changes:draftChangesSchema,
  },'social:drafts',async({workspaceId,draftId,requestId,expectedUpdatedAt,changes})=>{
    const col=db.collection('drafts'),query={_id:new ObjectId(draftId),workspaceId};
    const draft=await col.findOne(query);if(!draft)throw new Error('Draft not found');
    const digest=fingerprint({expectedUpdatedAt,changes});
    const last=draft.mcpLastEdit;
    const editResult=(saved,replayed)=>({success:true,draftId,draft:saved,hasMedia:!!saved.mediaUrl||!!saved.destinations?.some(d=>d.imageUrl||d.videoUrl),replayed,url:publicOrigin+'/compose?draft='+draftId+'&workspace='+encodeURIComponent(workspaceId)});
    if(last?.grantId===auth.extra.grantId&&last.requestId===requestId){
      if(last.fingerprint!==digest)throw new Error('requestId already used for different draft changes');
      if(new Date(draft.updatedAt).getTime()!==new Date(last.updatedAt).getTime())throw new Error('Draft changed since this edit. Read get_draft again before making changes.');
      return editResult(draft,true);
    }
    if(new Date(draft.updatedAt).getTime()!==new Date(expectedUpdatedAt).getTime())throw new Error('Draft changed since it was read. Read get_draft again and review the latest version.');
    const patch={...changes};
    if(changes.destinations!==undefined)await checkDestinations(workspaceId,changes.destinations);
    const destinationMedia=changes.destinations?.some(d=>d.imageUrl||d.videoUrl);
    if(changes.mediaUrl!==undefined||changes.destinations!==undefined){
      if(changes.mediaUrl===''&&destinationMedia)throw new Error('To remove the attachment, also omit imageUrl/videoUrl from destinations.');
      const urls=[...new Set((draft.destinations||[]).flatMap(d=>[d.imageUrl,d.videoUrl]).filter(Boolean))];
      const existingMedia=draft.mediaUrl||(urls.length===1?urls[0]:'');
      const mediaUrl=changes.mediaUrl!==undefined||destinationMedia
        ?await checkDraftMedia(workspaceId,{mediaUrl:changes.mediaUrl,destinations:changes.destinations||[]})
        :existingMedia;
      const mediaField=/\.(mp4|mov|avi|webm)(?:[?#]|$)/i.test(mediaUrl)?'videoUrl':'imageUrl';
      patch.mediaUrl=mediaUrl;
      patch.destinations=(changes.destinations||draft.destinations||[]).map(({imageUrl,videoUrl,...destination})=>({
        ...destination,key:destinationKey(destination),selected:destination.selected!==false,
        ...(mediaUrl&&destination.selected!==false&&{[mediaField]:mediaUrl}),
      }));
    }
    // Compare and update atomically. Advance even for rapid edits within the same millisecond.
    const updatedAt=new Date(Math.max(Date.now(),new Date(draft.updatedAt).getTime()+1));
    const mcpLastEdit={grantId:auth.extra.grantId,requestId,fingerprint:digest,updatedAt};
    const changed=await col.updateOne({...query,updatedAt:draft.updatedAt},{$set:{...patch,updatedAt,mcpLastEdit}});
    if(!changed.matchedCount)throw new Error('Draft changed while saving. Read get_draft again and review the latest version.');
    return editResult({...draft,...patch,updatedAt,mcpLastEdit},false);
  },{idempotent:true,destructive:true});
  tool('create_drafts','Save posts written in this conversation as reviewable drafts. Use list_media URLs for one shared image or video per draft, using mediaUrl or destination imageUrl/videoUrl. Does not generate or upload images, publish, or schedule delivery. Only claim an attachment when the result confirms hasMedia. Reuse requestId on retries.',{workspaceId:workspaceSchema,requestId:requestSchema,drafts:z.array(z.object({content:z.string().trim().min(1).max(20000),firstComment:z.string().max(10000).default(''),mediaUrl:z.string().max(2048).optional(),destinations:z.array(destinationSchema).max(20).default([])})).min(1).max(100)},'social:drafts',async({workspaceId,requestId,drafts})=>{
    const ids=[],savedDrafts=[],prepared=[];
    // Validate the complete batch before saving, so an invalid attachment leaves no partial batch.
    for(let i=0;i<drafts.length;i++){
      const draft=drafts[i];await checkDestinations(workspaceId,draft.destinations);const _id=objectId(`${auth.extra.grantId}:${workspaceId}:draft:${requestId}:${i}`),digest=fingerprint(draft);
      const old=await db.collection('drafts').findOne({_id,workspaceId});if(old&&old.mcpFingerprint!==digest)throw new Error('requestId already saved different draft text');
      prepared.push({draft,_id,digest,mediaUrl:await checkDraftMedia(workspaceId,draft)});
    }
    for(const {draft,_id,digest,mediaUrl} of prepared){
      await db.collection('drafts').updateOne({_id,workspaceId},{$setOnInsert:{...draft,destinations:draft.destinations.map(d=>({...d,key:destinationKey(d),selected:true})),mediaUrl,scheduledAt:'',source:'mcp',mcpGrantId:auth.extra.grantId,mcpFingerprint:digest,createdAt:new Date(),updatedAt:new Date()}},{upsert:true});ids.push(String(_id));
      const saved=await db.collection('drafts').findOne({_id,workspaceId});
      savedDrafts.push({id:String(_id),mediaUrl:saved.mediaUrl||'',hasMedia:!!saved.mediaUrl});
    }
    return {success:true,draftIds:ids,drafts:savedDrafts,count:ids.length,url:publicOrigin+'/scheduler?workspace='+encodeURIComponent(workspaceId)};
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

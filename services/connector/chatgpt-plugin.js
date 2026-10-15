const { crc32 } = require('node:zlib');

// Store-only ZIP with fixed timestamps. Packages contain public connection settings only.
function zipFiles(files) {
  const records=[],directory=[];let offset=0;
  for(const [path,content] of Object.entries(files)){
    const name=Buffer.from(path),data=Buffer.from(content),checksum=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x21,12);header.writeUInt32LE(checksum,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(checksum,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    records.push(header,name,data);directory.push(entry,name);offset+=header.length+name.length+data.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22),count=Object.keys(files).length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...records,central,end]);
}
function buildChatgptPlugin(resourceUrl) {
  const resource=new URL(resourceUrl);
  const json=value=>JSON.stringify(value,null,2)+'\n';
  return zipFiles({
    'plugin.json':json({
      $schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'socialmanager',version:'1.0.0',
      description:'Read workspace brand context, save content plans and drafts, and optionally publish or schedule explicitly confirmed posts through SocialManager.',
      author:{name:'SocialManager'},homepage:resource.origin,repository:'https://github.com/Bigben83/social-media-manager',
      extensions:{'com.openai':{interface:{displayName:'SocialManager',shortDescription:'Plan and manage social content',websiteURL:resource.origin,defaultPrompt:['Read my workspace brand profile and help me plan next month’s content.','Save an introduction series as drafts for review.']}}},
    }),
    'mcp.json':json({
      $schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers:{socialmanager:{type:'streamable-http',url:resource.href,extensions:{'com.openai':{auth:{
        type:'oauth',client:{mode:'dcr'},authorizationUrl:new URL('/authorize',resource).href,tokenUrl:new URL('/token',resource).href,registrationUrl:new URL('/register',resource).href,
        baseScopes:['social:read','social:drafts','social:publish','social:schedule'],
      }}}}},
    }),
    'README.md':`# SocialManager ChatGPT plugin\n\nThis package declares the existing MCP endpoint ${resource.href} with OAuth and dynamic client registration. It contains no password, API key, token or static client secret.\n\nUpload using ChatGPT's Upload plugin option when available, inspect the MCP server connection, and complete OAuth with the connector owner password in your browser. Select the workspaces and permissions you want to approve. Publishing and scheduling are optional and require a preview and explicit user confirmation. Install/select the plugin in a new conversation, then verify it can list only the workspaces you approved.\n\nUpload and MCP connection support depend on the ChatGPT surface and account/workspace policies. Uploading instructions alone does not connect the server. If the upload does not expose the SocialManager MCP connection or rejects this manifest, retain the exact error and check custom MCP permissions with your workspace administrator or OpenAI support. Do not disable authentication or paste passwords into Plugin Creator.\n\nThis is a private installation package, not a public directory submission.\n\nFormat reference: https://developers.openai.com/plugins/build/plugins\n`,
  });
}
module.exports={buildChatgptPlugin};

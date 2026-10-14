const fs=require('fs');const path=require('path');const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
function scan(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()&&!['node_modules','utils','tests'].includes(item.name)?scan(path.join(dir,item.name)):item.isFile()&&/\.(js|cjs)$/.test(item.name)?[path.join(dir,item.name)]:[]);}
const files=[...scan(path.join(root,'services')),...fs.readdirSync(path.join(root,'services/utils')).filter(f=>f.endsWith('.js')).map(f=>path.join(root,'services/utils',f))];
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status)process.exit(result.status);}
console.log(`${files.length} JavaScript files passed syntax checks`);

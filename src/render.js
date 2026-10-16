import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

export const newId = () => crypto.randomBytes(8).toString('hex');
export const cleanText = (v, max=8000) => String(v ?? '').trim().slice(0,max);
const idOK = id => /^[a-f0-9]{16}$/.test(String(id ?? ''));
export function safeProjectPath(root,id) {
  if (!idOK(id)) throw new Error('Invalid project ID');
  const rootAbs=path.resolve(root), dest=path.resolve(rootAbs,id);
  if (!dest.startsWith(rootAbs+path.sep)) throw new Error('Invalid project path');
  return dest;
}
export async function readProject(root,id) {
  const dir=safeProjectPath(root,id);
  const project=JSON.parse(await fs.readFile(path.join(dir,'project.json'),'utf8'));
  return {dir,project};
}
export async function writeProject(dir,p) {
  await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(p,null,2));
}
export function parseLrc(raw) {
  const lines=[],badLines=[];
  String(raw).split(/\r?\n/).forEach((line,i)=>{
    const tags=[...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if(!tags.length){if(line.trim()&&!/^\s*\[[a-z]+:/i.test(line))badLines.push(i+1);return;}
    const lyric=line.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g,'').trim();
    if(!lyric)return;
    for(const m of tags){const frac=(m[3]||'0').padEnd(3,'0').slice(0,3);lines.push({time:+m[1]*60 + +m[2] + +frac/1000,text:lyric,sourceLine:i+1});}
  });
  const problems=[];
  if(!lines.length)problems.push('未找到有效的 [mm:ss.xx] 歌词行');
  if(lines.some((x,i)=>i&&x.time<lines[i-1].time))problems.push('存在时间戳倒退');
  return {lines,problems,badLines,duration:lines.at(-1)?.time??0};
}
function run(cmd,args,cwd,logPath){
 return new Promise((resolve,reject)=>{
  const child=spawn(cmd,args,{cwd,env:process.env,stdio:['ignore','pipe','pipe']});
  const chunks=[]; const add=b=>{chunks.push(b);if(chunks.reduce((n,x)=>n+x.length,0)<1000000)fs.appendFile(logPath,b).catch(()=>{});};
  child.stdout.on('data',add);child.stderr.on('data',add);child.on('error',reject);
  child.on('close',code=>code===0?resolve(Buffer.concat(chunks).toString()):reject(new Error('Renderer exited '+code+'; inspect '+logPath)));
 });
}
export async function ensureEngineProject(dir,p){
 const template=process.env.PAINTED_ANIMATION_TEMPLATE||'/opt/painted-animation/template';
 await fs.access(path.join(dir,'render.mjs'));
 await fs.writeFile(path.join(dir,'src/config.js'),`const PROJECT = { duration: ${Math.max(5,Math.min(600,+p.duration||60))}, bpm: ${Math.max(40,Math.min(240,+p.bpm||120))}, offset: ${Math.max(0,+p.offset||0)} };\n`);
 if(p.files?.lrc){
  const parsed=parseLrc(await fs.readFile(path.join(dir,p.files.lrc),'utf8'));
  if(!parsed.lines.length||parsed.problems.some(x=>x.includes('倒退')))throw new Error('LRC is invalid or timestamps go backwards; fix it before rendering.');
  const rows=parsed.lines.filter(x=>x.time<p.duration).map((x,i,a)=>[x.time,Math.min(p.duration,a[i+1]?.time??x.time+2),x.text]);
  const code='window.EXTRA_LYRICS = '+JSON.stringify(rows)+';\n';
  await fs.writeFile(path.join(dir,'src/karaoke-data.js'),code);
 }
 await fs.mkdir(path.join(dir,'out/check'),{recursive:true});
}
export async function renderPreview({dir,project,chromePath}){
 await ensureEngineProject(dir,project);
 const out=path.join(dir,'out/preview.jpg'),log=path.join(dir,'out/preview.log');
 await fs.writeFile(log,'');
 const args=[path.join(dir,'render.mjs'),'--sheet=0.25,5,10','--cols=3','--w=480','--out='+out,'--soft-gl'];
 if(chromePath)args.push('--chrome='+chromePath);
 await run(process.execPath,args,dir,log);
 const st=await fs.stat(out);if(st.size<1000)throw new Error('Preview output is too small');
 project.preview={path:'out/preview.jpg',generatedAt:new Date().toISOString()};project.status='preview-ready';
 return {out,bytes:st.size};
}
export async function renderFull({dir,project,chromePath}){
 if(!project.storyboardApproved||!project.previewReviewed)throw new Error('Storyboard and preview must be approved before full rendering.');
 await ensureEngineProject(dir,project);
 const out=path.join(dir,'out/final.mp4'),log=path.join(dir,'out/render.log');
 await fs.writeFile(log,'');
 const args=[path.join(dir,'render.mjs'),'--clip','--out='+out];
 if(project.files?.audio)args.push('--audio='+path.join(dir,project.files.audio));
 if(chromePath)args.push('--chrome='+chromePath);
 await run(process.execPath,args,dir,log);
 const st=await fs.stat(out);if(st.size<1000)throw new Error('MP4 output is too small');
 return {out,bytes:st.size};
}

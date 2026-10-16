import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createMcpServer} from './mcp.js';
import {cleanText,newId,parseLrc,readProject,safeProjectPath,writeProject,renderPreview,renderFull} from './render.js';

const app=express(), ROOT=process.cwd();
const WORKSPACES=process.env.WORKSPACES||path.join(ROOT,'workspaces');
const TEMPLATE=process.env.PAINTED_ANIMATION_TEMPLATE||'/opt/painted-animation/template';
const TOKEN=process.env.ACCESS_TOKEN||'', BASE=(process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL||'').replace(/\/$/,'');
const CHROME=process.env.CHROME_PATH||'/usr/bin/chromium';
await fs.mkdir(WORKSPACES,{recursive:true});
if(process.env.NODE_ENV==='production'&&TOKEN.length<24)throw new Error('Set ACCESS_TOKEN to a random secret of at least 24 characters.');
app.disable('x-powered-by');
app.use(cors({origin:false}));app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(ROOT,'public')));
const upload=multer({dest:'/tmp',limits:{fileSize:250*1024*1024,files:2},fileFilter(_r,f,cb){
 const e=path.extname(f.originalname).toLowerCase();
 if(f.fieldname==='audio'&&['.mp3','.wav','.m4a','.aac','.ogg','.flac','.opus','.webm'].includes(e))return cb(null,true);
 if(f.fieldname==='lrc'&&['.lrc','.txt'].includes(e))return cb(null,true);
 cb(new Error('Unsupported file type'));
}});
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function auth(req,res,next){const h=String(req.headers.authorization||'');if(TOKEN&&equal(h.startsWith('Bearer ')?h.slice(7):'',TOKEN))return next();if(!TOKEN&&process.env.NODE_ENV!=='production')return next();return res.status(401).json({error:'Bearer access token required'});}
async function engineReady(){try{await fs.access(path.join(TEMPLATE,'render.mjs'));return true;}catch{return false;}}
async function listProjects(){const a=[];for(const id of await fs.readdir(WORKSPACES)){try{a.push((await readProject(WORKSPACES,id)).project)}catch{}}return a.sort((x,y)=>y.createdAt.localeCompare(x.createdAt));}
async function createProject(input,files={}){
 if(!(await engineReady()))throw new Error('Upstream engine is missing: expected '+path.join(TEMPLATE,'render.mjs'));
 const id=newId(),dir=safeProjectPath(WORKSPACES,id);await fs.mkdir(dir,{recursive:true});
 await fs.cp(TEMPLATE,dir,{recursive:true,filter:s=>!s.split(path.sep).includes('node_modules')&&!s.split(path.sep).includes('.git')});
 const project={id,title:cleanText(input.title||'未命名 MV',120),idea:cleanText(input.idea,5000),style:cleanText(input.style||'水彩手绘与墨线',100),duration:Math.max(5,Math.min(600,+input.duration_seconds||60)),bpm:Math.max(40,Math.min(240,+input.bpm||120)),offset:Math.max(0,+input.offset_seconds||0),createdAt:new Date().toISOString(),status:'created',files:{},storyboardApproved:false,previewReviewed:false,render:null,downloadToken:crypto.randomBytes(32).toString('hex')};
 await fs.mkdir(path.join(dir,'assets'),{recursive:true});await fs.mkdir(path.join(dir,'out/check'),{recursive:true});
 for(const k of ['audio','lrc'])if(files[k]){const ext=path.extname(files[k].originalname).toLowerCase(),name=k==='audio'?'assets/song'+ext:'assets/lyrics.lrc';await fs.rename(files[k].path,path.join(dir,name));project.files[k]=name;}
 await writeProject(dir,project);return project;
}
app.get('/api/health',async(_q,s)=>s.json({ok:true,service:'claude-mv-remote-connector',mcpEndpoint:'/mcp',authConfigured:!!TOKEN,engineReady:await engineReady(),renderer:'Chromium + FFmpeg + upstream painted-animation template'}));
app.use('/api',auth);app.use('/mcp',auth);
app.post('/api/projects',upload.fields([{name:'audio',maxCount:1},{name:'lrc',maxCount:1}]),async(q,s,n)=>{try{const p=await createProject(q.body,{audio:q.files?.audio?.[0],lrc:q.files?.lrc?.[0]});s.status(201).json({project:p,engineReady:true});}catch(e){n(e);}});
app.get('/api/projects',async(_q,s)=>s.json(await listProjects()));
app.get('/api/projects/:id',async(q,s)=>{try{s.json((await readProject(WORKSPACES,q.params.id)).project)}catch{s.status(404).json({error:'Project not found'});}});
app.get('/api/projects/:id/lyrics',async(q,s)=>{try{const {dir,project}=await readProject(WORKSPACES,q.params.id);if(!project.files.lrc)return s.status(400).json({error:'Upload LRC first'});s.json(parseLrc(await fs.readFile(path.join(dir,project.files.lrc),'utf8')))}catch{s.status(404).json({error:'Project not found'});}});
app.get('/api/projects/:id/preview',async(q,s)=>{try{const {dir}=await readProject(WORKSPACES,q.params.id);s.type('image/jpeg').sendFile(path.join(dir,'out/preview.jpg'))}catch{s.status(404).end('Preview not ready')}});
app.get('/api/projects/:id/video',async(q,s)=>{try{const {dir,project}=await readProject(WORKSPACES,q.params.id);s.download(path.join(dir,'out/final.mp4'),(project.title||'mv')+'.mp4')}catch{s.status(404).end('MP4 not ready')}});
app.post('/api/projects/:id/storyboard',async(q,s)=>{try{const {dir,project}=await readProject(WORKSPACES,q.params.id);const story=cleanText(q.body.storyboard,30000);if(!story)return s.status(400).json({error:'Empty storyboard'});await fs.writeFile(path.join(dir,'STORYBOARD.md'),story);project.storyboardApproved=false;project.previewReviewed=false;project.status='storyboard-ready';await writeProject(dir,project);s.json({ok:true,status:project.status})}catch{s.status(404).json({error:'Project not found'});}});
app.get('/download/:id/:token',async(q,s)=>{try{const {dir,project}=await readProject(WORKSPACES,q.params.id);if(!equal(q.params.token,project.downloadToken))return s.status(403).end();await fs.access(path.join(dir,'out/final.mp4'));s.download(path.join(dir,'out/final.mp4'),(project.title||'mv')+'.mp4')}catch{s.status(404).end('MP4 not ready')}});
app.use((e,_q,s,_n)=>{console.error(e);s.status(400).json({error:cleanText(e.message||'Request failed',500)});});
const deps={WORKSPACES,TEMPLATE,BASE,CHROME,createProject,listProjects,readProject,writeProject,parseLrc,renderPreview,renderFull};
const mcp=createMcpServer(deps);
app.post('/mcp',(q,s)=>mcp.handle(q,s));
app.get('/mcp',(_q,s)=>s.status(405).send('Use MCP Streamable HTTP POST'));
app.listen(+(process.env.PORT||8080),'0.0.0.0',()=>console.log('Remote MCP service listening on '+(process.env.PORT||8080)));

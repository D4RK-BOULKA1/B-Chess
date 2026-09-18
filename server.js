const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const engine = require('./chessEngine');
const store = require('./store');
const bot = require('./bot');

const app=express();
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(__dirname,'public')));

const sessions=new Map();
const sockets=new Map();
const queues={normal:new Map(),blitz:new Map()};
const games=new Map();

function hashPassword(p,salt=crypto.randomBytes(16).toString('hex')){
  return salt+':'+crypto.scryptSync(p,salt,64).toString('hex');
}
function verifyPassword(p,h){
  const [salt,digest]=String(h).split(':'); if(!salt||!digest)return false;
  const test=crypto.scryptSync(p,salt,64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test),Buffer.from(digest));
}
function token(){return crypto.randomBytes(32).toString('hex');}
function auth(req){
  const t=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  return sessions.get(t)||null;
}
function cleanUser(u){return store.publicUser(u);}
function send(ws,type,data={}){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type,...data}));}
function broadcastGame(g,type,data={}){
  send(g.white.ws,type,data);send(g.black.ws,type,data);
}
function userElo(username,mode){const u=store.getUser(username);return mode==='blitz'?u.eloBlitz:u.eloNormal;}
function modeLabel(mode){return mode==='blitz'?'Blitz':'Normal';}

app.post('/api/register',(req,res)=>{
  const username=String(req.body.username||'').trim(), password=String(req.body.password||'');
  if(!/^[A-Za-z0-9_À-ÿ-]{3,18}$/.test(username))return res.status(400).json({error:'Pseudo: 3 à 18 caractères.'});
  if(password.length<6)return res.status(400).json({error:'Mot de passe: 6 caractères minimum.'});
  try{const u=store.createUser(username,hashPassword(password));const t=token();sessions.set(t,u.username);res.json({token:t,user:cleanUser(u)});}
  catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/login',(req,res)=>{
  const u=store.getUser(String(req.body.username||'').trim());
  if(!u||!verifyPassword(String(req.body.password||''),u.passwordHash))return res.status(401).json({error:'Identifiants incorrects.'});
  const t=token();sessions.set(t,u.username);res.json({token:t,user:cleanUser(u)});
});
app.get('/api/me',(req,res)=>{const s=auth(req);if(!s)return res.status(401).json({error:'Non connecté'});res.json({user:cleanUser(store.getUser(s))});});
app.patch('/api/profile',(req,res)=>{
  const s=auth(req);if(!s)return res.status(401).json({error:'Non connecté'});
  const fields={};
  if(req.body.username){
    const next=String(req.body.username).trim();
    if(next.toLowerCase()!==s.toLowerCase()){
      if(!/^[A-Za-z0-9_À-ÿ-]{3,18}$/.test(next)||store.getUser(next))return res.status(400).json({error:'Pseudo invalide ou déjà pris.'});
      try {
        const renamed=store.renameUser(s,next);
        sessions.forEach((name,key)=>{ if(name.toLowerCase()===s.toLowerCase()) sessions.set(key,renamed.username); });
        const currentWs=sockets.get(s); sockets.set(renamed.username,currentWs); sockets.delete(s);
        const u=renamed;
        return res.json({user:cleanUser(u)});
      } catch(e) { return res.status(400).json({error:e.message}); }
    }
  }
  if(req.body.country!==undefined)fields.country=String(req.body.country||'').slice(0,2);
  if(req.body.avatar!==undefined)fields.avatar=String(req.body.avatar||'').slice(0,500000);
  const u=store.updateUser(s,fields);res.json({user:cleanUser(u)});
});
app.get('/api/users',(req,res)=>res.json({users:store.listUsers()}));
app.get('/api/friends',(req,res)=>{
  const s=auth(req);if(!s)return res.status(401).json({error:'Non connecté'});
  const u=store.getUser(s);res.json({friends:u.friends.map(x=>cleanUser(store.getUser(x))).filter(Boolean)});
});
app.post('/api/friends',(req,res)=>{
  const s=auth(req);if(!s)return res.status(401).json({error:'Non connecté'});
  try{res.json({friends:store.addFriend(s,String(req.body.username||'').trim()).map(x=>cleanUser(store.getUser(x)))});}
  catch(e){res.status(400).json({error:e.message});}
});

function makeGame(a,b,mode,minutes){
  const state=engine.initialState();
  const id=crypto.randomBytes(8).toString('hex');
  const g={id,mode,minutes, state, white:{username:a,ws:sockets.get(a)},black:{username:b,ws:sockets.get(b)},
    clocks:{w:minutes*60*1000,b:minutes*60*1000},lastTick:Date.now(),over:false};
  games.set(id,g); return g;
}
function removeQueue(username){
  for(const q of Object.values(queues))for(const [key,v] of q)if(v.username===username)q.delete(key);
}
function tryMatch(username,mode,minutes){
  const q=queues[mode]; let found=null;
  for(const [key,v] of q){if(v.username!==username&&v.minutes===minutes){found={key,v};break;}}
  if(!found){q.set(crypto.randomBytes(6).toString('hex'),{username,minutes});return null;}
  q.delete(found.key); return makeGame(found.v.username,username,mode,minutes);
}
function clockTick(g){
  if(g.over)return;
  const now=Date.now(),dt=now-g.lastTick;g.clocks[g.state.turn]-=dt;g.lastTick=now;
  if(g.clocks[g.state.turn]<=0)finishGame(g,g.state.turn==='w'?'black':'white','timeout');
}
function finishGame(g,result,reason){
  if(g.over)return;g.over=true;clockTick.cancel;
  const mode=g.mode;
  let winner=null, loser=null;
  if(result==='white'){winner=g.white.username;loser=g.black.username;}
  else if(result==='black'){winner=g.black.username;loser=g.white.username;}
  if(reason==='draw'){
    store.applyEloChange(g.white.username,mode,0,'draw');store.applyEloChange(g.black.username,mode,0,'draw');
  }else{
    store.applyEloChange(winner,mode,8,'win');store.applyEloChange(loser,mode,-8,'loss');
  }
  broadcastGame(g,'game_over',{result,reason,whiteElo:userElo(g.white.username,mode),blackElo:userElo(g.black.username,mode)});
  games.delete(g.id);
}
setInterval(()=>games.forEach(clockTick),250);

const server=http.createServer(app);
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',(ws)=>{
  let username=null;
  ws.on('message',(raw)=>{
    let msg;try{msg=JSON.parse(raw)}catch{return}
    if(msg.type==='auth'){
      username=sessions.get(msg.token);if(!username)return send(ws,'error',{message:'Session invalide'});
      sockets.set(username,ws);send(ws,'ready',{user:cleanUser(store.getUser(username))});return;
    }
    if(!username)return;
    if(msg.type==='matchmake'){
      removeQueue(username); const mode=msg.mode==='blitz'?'blitz':'normal',minutes=msg.minutes===3?3:10;
      send(ws,'searching',{mode,minutes});
      const g=tryMatch(username,mode,minutes);
      if(g){
        g.white.ws=sockets.get(g.white.username);g.black.ws=sockets.get(g.black.username);
        broadcastGame(g,'game_start',{gameId:g.id,mode,minutes,white:cleanUser(store.getUser(g.white.username)),black:cleanUser(store.getUser(g.black.username)),state:g.state,clocks:g.clocks});
      }
    }
    if(msg.type==='cancel_search'){removeQueue(username);send(ws,'search_cancelled');}
    if(msg.type==='move'){
      const g=games.get(msg.gameId);if(!g||g.over)return;
      const side=g.white.username===username?'w':g.black.username===username?'b':null;if(!side||g.state.turn!==side)return;
      clockTick(g); if(g.over)return;
      const from=msg.from,to=msg.to,promotion=msg.promotion;
      const result=engine.tryMove(g.state,from,to,promotion);
      if(!result)return send(ws,'illegal_move');
      g.state=result.state;g.lastTick=Date.now();
      broadcastGame(g,'state',{state:g.state,clocks:g.clocks});
      if(result.status.status==='checkmate')finishGame(g,result.status.winner==='w'?'white':'black','checkmate');
      else if(result.status.status==='stalemate'||result.status.status==='draw')finishGame(g,'draw',result.status.reason||'draw');
    }
    if(msg.type==='resign'){const g=games.get(msg.gameId);if(g&& !g.over){const side=g.white.username===username?'w':'b';finishGame(g,side==='w'?'black':'white','resignation');}}
    if(msg.type==='offer_draw'){const g=games.get(msg.gameId);if(g&&!g.over)send(g.white.username===username?g.black.ws:g.white.ws,'draw_offer');}
    if(msg.type==='accept_draw'){const g=games.get(msg.gameId);if(g&&!g.over)finishGame(g,'draw','agreement');}
    if(msg.type==='challenge'){
      const target=String(msg.username||'').trim();
      const targetWs=sockets.get(target);
      if(!targetWs)return send(ws,'error',{message:'Ce joueur n’est pas connecté.'});
      send(targetWs,'challenge',{from:username,mode:msg.mode==='blitz'?'blitz':'normal',minutes:msg.minutes===3?3:10});
    }
    if(msg.type==='accept_challenge'){
      const from=String(msg.from||'').trim(), targetWs=sockets.get(from);
      if(!targetWs)return send(ws,'error',{message:'Le joueur n’est plus connecté.'});
      const mode=msg.mode==='blitz'?'blitz':'normal',minutes=msg.minutes===3?3:10;
      const g=makeGame(from,username,mode,minutes);
      g.white.ws=sockets.get(g.white.username); g.black.ws=sockets.get(g.black.username);
      broadcastGame(g,'game_start',{gameId:g.id,mode,minutes,white:cleanUser(store.getUser(g.white.username)),black:cleanUser(store.getUser(g.black.username)),state:g.state,clocks:g.clocks});
    }
    if(msg.type==='play_bot'){
      const mode=msg.mode==='blitz'?'blitz':'normal',minutes=msg.minutes===3?3:10;
      const state=engine.initialState();const id=crypto.randomBytes(8).toString('hex');
      const g={id,mode,minutes,state,white:{username,ws},black:{username:'Boulkabot',ws},clocks:{w:minutes*60*1000,b:minutes*60*1000},lastTick:Date.now(),over:false,bot:true};
      games.set(id,g);send(ws,'game_start',{gameId:id,mode,minutes,white:cleanUser(store.getUser(username)),black:{username:'Boulkabot',eloNormal:1500,eloBlitz:1500,avatar:'🤖'},state,clocks:g.clocks});
    }
    if(msg.type==='bot_move'){
      const g=games.get(msg.gameId);if(!g||!g.bot||g.over||g.state.turn!=='b')return;
      const m=bot.chooseBotMove(g.state,3);if(!m)return;
      const result={state:engine.applyMove(g.state,m)};result.status=engine.getGameStatus(result.state);
      g.state=result.state;g.lastTick=Date.now();send(ws,'state',{state:g.state,clocks:g.clocks});
      if(result.status.status==='checkmate')finishGame(g,'white','checkmate');
      else if(result.status.status==='stalemate'||result.status.status==='draw')finishGame(g,'draw',result.status.reason||'draw');
    }
  });
  ws.on('close',()=>{if(username){removeQueue(username);if(sockets.get(username)===ws)sockets.delete(username);}});
});
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

store.init()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`B-Chess lancé sur http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Impossible de démarrer B-Chess :', err);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await store.close();
  process.exit(0);
});

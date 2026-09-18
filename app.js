const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const PIECES={wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'};
const files=['a','b','c','d','e','f','g','h'];
const countryCodes=['AF','ZA','AL','DZ','DE','AD','AO','AG','SA','AR','AM','AU','AT','AZ','BS','BH','BD','BB','BE','BZ','BJ','BT','BY','MM','BO','BA','BW','BR','BN','BG','BF','BI','KH','CM','CA','CV','CL','CN','CY','CO','KM','CG','CD','KR','KP','CR','CI','HR','CU','DK','DJ','DO','EG','AE','EC','ER','ES','EE','SZ','US','ET','FJ','FI','FR','GA','GM','GE','GH','GR','GD','GT','GN','GQ','GW','GY','HT','HN','HU','IN','ID','IQ','IR','IE','IS','IL','IT','JM','JP','JO','KZ','KE','KG','KI','KW','LA','LS','LV','LB','LR','LY','LI','LT','LU','MK','MG','MY','MW','MV','ML','MT','MA','MH','MU','MR','MX','FM','MD','MC','MN','ME','MZ','NA','NR','NP','NI','NE','NG','NO','NZ','OM','UG','UZ','PK','PW','PA','PG','PY','NL','PE','PH','PL','PT','QA','RO','GB','RU','RW','KN','LC','VC','SB','SV','WS','ST','SN','RS','SC','SL','SG','SK','SI','SO','SD','SS','LK','SE','CH','SR','SY','TJ','TZ','TD','CZ','TH','TL','TG','TO','TT','TN','TM','TR','TV','UA','UY','VU','VA','VE','VN','YE','ZM','ZW'];
const countryNames=new Intl.DisplayNames(['fr'],{type:'region'});
let token=localStorage.getItem('bchess_token'), user=null, ws=null, game=null, selected=null, timer=null, authMode='login';

function toast(msg){const d=document.createElement('div');d.className='toast';d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),3000)}
function flag(code){if(!code)return '🌍';return [...code].map(c=>String.fromCodePoint(c.charCodeAt(0)+127397)).join('')}
function avatar(u){return u?.avatar?.startsWith('data:image')?`<div class="avatar"><img src="${u.avatar}"></div>`:`<div class="avatar">${u?.avatar||'♟️'}</div>`}
async function api(url,opt={}){opt.headers={...(opt.headers||{}),...(token?{Authorization:'Bearer '+token}:{})};if(opt.body&&typeof opt.body!=='string'){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(opt.body)}const r=await fetch(url,opt);const d=await r.json();if(!r.ok)throw Error(d.error||'Erreur');return d}
function renderAuth(){document.querySelector('#app').innerHTML=`<div class="auth"><div class="auth-card">
<div class="pill">PLATEFORME D'ÉCHECS</div><h1>B<span style="color:#69d39c">-</span>Chess</h1><p class="muted">Joue. Progresse. Défie le Boulkabot.</p>
<div class="field"><label>Pseudo</label><input id="authUser" autocomplete="username"></div>
<div class="field"><label>Mot de passe</label><input id="authPass" type="password" autocomplete="current-password"></div>
<button class="btn primary full" id="authBtn">${authMode==='login'?'Se connecter':'Créer mon compte'}</button>
<p class="muted" style="text-align:center;margin-top:18px"><span id="switchAuth" style="cursor:pointer">${authMode==='login'?'Créer un compte':'J’ai déjà un compte'}</span></p></div></div>`;
$('#authBtn').onclick=async()=>{try{const d=await api(authMode==='login'?'/api/login':'/api/register',{method:'POST',body:{username:$('#authUser').value,password:$('#authPass').value}});token=d.token;localStorage.setItem('bchess_token',token);user=d.user;connect();renderApp()}catch(e){toast(e.message)}};
$('#switchAuth').onclick=()=>{authMode=authMode==='login'?'register':'login';renderAuth()};
}
function connect(){if(ws&&ws.readyState<2)return;ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');ws.onopen=()=>ws.send(JSON.stringify({type:'auth',token}));ws.onmessage=e=>handle(JSON.parse(e.data));ws.onclose=()=>setTimeout(connect,1500)}
function handle(m){if(m.type==='ready')return;
if(m.type==='searching'){game={searching:true,mode:m.mode,minutes:m.minutes};renderApp();renderPage('play')}
if(m.type==='search_cancelled'){game=null;renderPage('play')}
if(m.type==='game_start'){game={...m,searching:false};renderApp();renderPage('game');startBotIfNeeded()}
if(m.type==='state'){game.state=m.state;game.clocks=m.clocks;renderPage('game');startBotIfNeeded()}
if(m.type==='illegal_move')toast('Coup illégal.');
if(m.type==='challenge'){
  if(confirm(m.from+' te défie en '+(m.mode==='blitz'?'Blitz 3 min':'Normal 10 min')+'. Accepter ?'))
    ws.send(JSON.stringify({type:'accept_challenge',from:m.from,mode:m.mode,minutes:m.minutes}));
}
if(m.type==='draw_offer'){if(confirm('Votre adversaire propose nulle. Accepter ?'))ws.send(JSON.stringify({type:'accept_draw',gameId:game.gameId}))}
if(m.type==='game_over'){game.over=true;game.result=m;renderPage('game');refreshMe();toast('Partie terminée : '+(m.reason||m.result))}
if(m.type==='error')toast(m.message)}
async function refreshMe(){try{user=(await api('/api/me')).user}catch{token=null;localStorage.removeItem('bchess_token');renderAuth()}}
function nav(){return `<aside class="side"><div class="logo">B<span>-</span>Chess</div>
<button class="nav" data-page="home">⌂ Accueil</button><button class="nav" data-page="play">♟ Jouer</button><button class="nav" data-page="friends">♧ Amis</button><button class="nav" data-page="profile">⚙ Paramètres</button><div class="spacer"></div><div class="profile">${avatar(user)}<div><b>${user.username}</b><div class="country">${flag(user.country)} ${user.eloNormal} / ${user.eloBlitz}</div></div></div>
<button class="nav" id="logout">↪ Déconnexion</button></aside>`}
function renderApp(){document.querySelector('#app').innerHTML=`<div class="shell">${nav()}<main class="main"><div id="page"></div></main></div>`;$$('.nav[data-page]').forEach(b=>b.onclick=()=>renderPage(b.dataset.page));$('#logout').onclick=()=>{token=null;localStorage.removeItem('bchess_token');location.reload()}}
function renderPage(page){if(!user)return renderAuth();$$('.nav[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));const p=$('#page');if(!p)return;
if(page==='home')p.innerHTML=`<div class="top"><div><div class="pill">BIENVENUE</div><h1>Salut ${user.username} 👋</h1><p class="muted">Ton échiquier t’attend.</p></div></div>
<div class="hero"><div class="card big"><h2>Prêt pour une partie ?</h2><p class="muted">Choisis Normal ou Blitz, puis laisse le matchmaking trouver ton adversaire.</p><button class="btn primary" onclick="renderPage('play')">Jouer maintenant →</button></div>
<div class="card"><p class="muted">ELO Normal</p><div class="stat">${user.eloNormal}</div><hr><p class="muted">ELO Blitz</p><div class="stat">${user.eloBlitz}</div></div></div>
<div class="grid" style="margin-top:18px"><div class="card"><p class="muted">Victoires</p><div class="stat">${user.stats.wins}</div></div><div class="card"><p class="muted">Défaites</p><div class="stat">${user.stats.losses}</div></div><div class="card"><p class="muted">Nulles</p><div class="stat">${user.stats.draws}</div></div></div>`;
if(page==='play')p.innerHTML=game?.searching?`<div class="card search"><div><div class="spinner"></div><h2>Recherche d’un joueur…</h2><p class="muted">${game.mode==='blitz'?'Blitz':'Normal'} · ${game.minutes} min</p><button class="btn" id="cancel">Annuler</button></div></div>`:
`<div class="top"><div><h1>Jouer</h1><p class="muted">Chaque cadence possède son propre classement.</p></div></div><div class="grid">
<div class="card mode-card" onclick="queue('normal',10)"><span class="pill">NORMAL</span><h2>10 + 0</h2><p class="muted">Partie classique · ELO Normal</p><button class="btn primary">Trouver un joueur</button></div>
<div class="card mode-card" onclick="queue('blitz',3)"><span class="pill">BLITZ</span><h2>3 + 0</h2><p class="muted">Partie rapide · ELO Blitz</p><button class="btn primary">Trouver un joueur</button></div>
<div class="card mode-card" onclick="botGame('normal',10)"><span class="pill">BOT</span><h2>Boulkabot</h2><p class="muted">Moteur maison · ~1500 Elo</p><button class="btn">Jouer contre le bot</button></div></div>`;
if(page==='friends')friendsPage(p);
if(page==='profile')profilePage(p);
if(page==='game')gamePage(p);
if(page==='play'&&game?.searching)$('#cancel').onclick=()=>ws.send(JSON.stringify({type:'cancel_search'}));
}
function queue(mode,minutes){ws.send(JSON.stringify({type:'matchmake',mode,minutes}))}
function botGame(mode,minutes){ws.send(JSON.stringify({type:'play_bot',mode,minutes}))}
async function friendsPage(p){let d=await api('/api/friends');p.innerHTML=`<div class="top"><div><h1>Amis</h1><p class="muted">Ajoute un joueur par son pseudo.</p></div></div><div class="card"><div class="row"><input id="friendName" placeholder="Pseudo du joueur" style="flex:1;background:#0b111a;color:#fff;border:1px solid #2b3749;border-radius:11px;padding:12px"><button class="btn primary" id="addFriend">Ajouter</button></div><div class="list" style="margin-top:18px">${d.friends.length?d.friends.map(f=>`<div class="friend">${avatar(f)}<div style="flex:1;margin-left:10px"><b>${f.username}</b><div class="country">${flag(f.country)} ${f.eloNormal} Normal · ${f.eloBlitz} Blitz</div></div><button class="btn" onclick="challenge('${f.username}')">Défier</button></div>`).join(''):'<p class="muted">Aucun ami pour le moment.</p>'}</div></div>`;$('#addFriend').onclick=async()=>{try{await api('/api/friends',{method:'POST',body:{username:$('#friendName').value}});toast('Ami ajouté.');friendsPage(p)}catch(e){toast(e.message)}}}
function challenge(name){
  const mode=confirm('OK = Blitz 3 min. Annuler = Normal 10 min.')?'blitz':'normal';
  const minutes=mode==='blitz'?3:10;
  ws.send(JSON.stringify({type:'challenge',username:name,mode,minutes}));
  toast('Défi envoyé à '+name+' ('+(mode==='blitz'?'Blitz 3 min':'Normal 10 min')+').');
}
function profilePage(p){p.innerHTML=`<div class="top"><div><h1>Paramètres</h1><p class="muted">Personnalise ton profil.</p></div></div><div class="card"><div class="profile">${avatar(user)}<div><h2 style="margin:0">${user.username}</h2><div class="muted">Compte B-Chess</div></div></div>
<div class="field"><label>Pseudo</label><input id="newUsername" value="${user.username}" maxlength="18"></div>
<div class="field"><label>Pays</label><select id="country"><option value="">Choisir…</option>${countryCodes.map(c=>`<option value="${c}" ${user.country===c?'selected':''}>${flag(c)} ${countryNames.of(c)}</option>`).join('')}</select></div>
<div class="field"><label>Photo de profil (URL d’image)</label><input id="avatar" value="${user.avatar&&user.avatar.startsWith('http')?user.avatar:''}" placeholder="https://..."></div>
<div class="row"><button class="btn primary" id="saveProfile">Enregistrer</button></div><p class="muted">Ton pseudo est unique. Tu peux le modifier ici s’il est disponible.</p></div>`;$('#saveProfile').onclick=async()=>{try{user=(await api('/api/profile',{method:'PATCH',body:{username:$('#newUsername').value,country:$('#country').value,avatar:$('#avatar').value}})).user;renderApp();renderPage('profile');toast('Profil enregistré.')}catch(e){toast(e.message)}}}
function fmt(ms){ms=Math.max(0,ms);let s=Math.floor(ms/1000),m=Math.floor(s/60);s%=60;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function alg(m){return files[m.from.col]+(8-m.from.row)+files[m.to.col]+(8-m.to.row)}
function gamePage(p){if(!game)return renderPage('play');if(game.searching)return renderPage('play');const w=game.white,b=game.black,mySide=w.username===user.username?'w':'b';p.innerHTML=`<div class="top"><div><h1>${game.mode==='blitz'?'Blitz':'Normal'} · ${game.minutes} min</h1><p class="muted">${game.over?'Partie terminée':'À toi de jouer'}</p></div><button class="btn" onclick="renderPage('play')">← Quitter</button></div>
<div class="play-layout"><div class="board-wrap"><div class="player"><div class="profile">${avatar(mySide==='w'?b:w)}<div><b>${(mySide==='w'?b:w).username}</b><div class="country">${mySide==='w'?'Noirs':'Blancs'}</div></div></div><div class="clock" id="topClock">${fmt(game.clocks[mySide==='w'?'b':'w'])}</div></div>
<div class="board" id="board"></div><div class="player"><div class="profile">${avatar(mySide==='w'?w:b)}<div><b>${(mySide==='w'?w:b).username}</b><div class="country">${mySide==='w'?'Blancs':'Noirs'}</div></div></div><div class="clock" id="bottomClock">${fmt(game.clocks[mySide])}</div></div></div>
<div class="card"><h3>Partie</h3><div class="row"><button class="btn danger" id="resign">Abandonner</button><button class="btn" id="draw">Proposer nulle</button></div><hr><h3>Coups</h3><div class="moves" id="moves"></div></div></div>`;
drawBoard(mySide);$('#resign').onclick=()=>ws.send(JSON.stringify({type:'resign',gameId:game.gameId}));$('#draw').onclick=()=>ws.send(JSON.stringify({type:'offer_draw',gameId:game.gameId}));startClockDisplay();renderMoves()}
function drawBoard(mySide){const b=$('#board');if(!b)return;b.innerHTML='';const rows=mySide==='w'?[0,1,2,3,4,5,6,7]:[7,6,5,4,3,2,1,0],cols=mySide==='w'?[0,1,2,3,4,5,6,7]:[7,6,5,4,3,2,1,0];rows.forEach(r=>cols.forEach(c=>{const s=document.createElement('div');s.className='sq '+((r+c)%2?'dark':'light');if(game.state.lastMove&&((game.state.lastMove.from.row===r&&game.state.lastMove.from.col===c)||(game.state.lastMove.to.row===r&&game.state.lastMove.to.col===c)))s.classList.add('last');const piece=game.state.board[r][c];s.innerHTML=piece?`<span class="piece">${PIECES[piece]}</span>`:'';s.onclick=()=>clickSquare(r,c,mySide);b.appendChild(s)}))}
function clickSquare(r,c,mySide){if(game.over||game.state.turn!==mySide)return;const p=game.state.board[r][c];if(selected){if(p&&p[0]===mySide){selected={row:r,col:c};drawBoard(mySide);return}
let promotion='Q';const type=game.state.board[selected.row][selected.col];if(type?.[1]==='P'&&r=== (mySide==='w'?0:7))promotion=prompt('Promotion : Q, R, B ou N','Q')?.toUpperCase()||'Q';
ws.send(JSON.stringify({type:'move',gameId:game.gameId,from:selected,to:{row:r,col:c},promotion}));selected=null;return}
if(p&&p[0]===mySide){selected={row:r,col:c};drawBoard(mySide);const idx=([0,1,2,3,4,5,6,7].indexOf(r))*8+([0,1,2,3,4,5,6,7].indexOf(c));const sq=$$('.sq')[idx];if(sq)sq.classList.add('sel')}}
function startClockDisplay(){clearInterval(timer);timer=setInterval(()=>{if(!game||game.over)return;const side=game.state.turn;const elapsed=Date.now()-(game.lastTick||Date.now());const clocks={...game.clocks};clocks[side]-=elapsed;const my=game.white.username===user.username?'w':'b';$('#bottomClock').textContent=fmt(clocks[my]);$('#topClock').textContent=fmt(clocks[my==='w'?'b':'w'])},250)}
function renderMoves(){const el=$('#moves');if(!el)return;const h=game.state.history||[];let out='';for(let i=0;i<h.length;i+=2){out+=`<div class="move-row"><span>${i/2+1}.</span><span>${h[i]?notation(h[i]):''}</span><span>${h[i+1]?notation(h[i+1]):''}</span></div>`}el.innerHTML=out||'<span class="muted">Aucun coup.</span>'}
function notation(m){return (m.piece?.[1]==='P'?'':m.piece?.[1])+files[m.to.col]+(8-m.to.row)+(m.captured?'×':'')}
function startBotIfNeeded(){if(game?.bot&&!game.over&&game.state.turn==='b'){setTimeout(()=>ws.send(JSON.stringify({type:'bot_move',gameId:game.gameId})),250)}}
(async()=>{if(token){try{user=(await api('/api/me')).user;connect();renderApp();renderPage('home')}catch{token=null;localStorage.removeItem('bchess_token');renderAuth()}}else renderAuth()})();

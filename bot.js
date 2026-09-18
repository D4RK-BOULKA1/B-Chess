// Boulkabot — moteur minimax alpha-bêta, niveau visé ~1500 Elo.
const engine = require('./chessEngine');
const PIECE_VALUES={P:100,N:320,B:330,R:500,Q:900,K:0};
const PST={
P:[[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]],
N:[[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],[-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]],
B:[[-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],[-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],[-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]],
R:[[0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0]],
Q:[[-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],[0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20]],
K:[[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],[20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20]]};
function evalWhitePerspective(state){
 let score=0;
 for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=state.board[r][c];if(!p)continue;const color=engine.colorOf(p),type=engine.typeOf(p),row=color==='w'?r:7-r;const v=PIECE_VALUES[type]+(PST[type]?PST[type][row][c]:0);score+=color==='w'?v:-v;}
 return score;
}
function relativeScore(s){const v=evalWhitePerspective(s);return s.turn==='w'?v:-v;}
function orderMoves(ms){return ms.slice().sort((a,b)=>(b.capture?1:0)-(a.capture?1:0));}
const MATE=100000;
function quiescence(s,a,b,d){
 const stand=relativeScore(s); if(d<=0)return stand; if(stand>=b)return b; if(a<stand)a=stand;
 for(const m of orderMoves(engine.getAllLegalMoves(s,s.turn).filter(x=>x.capture))){
   const sc=-quiescence(engine.applyMove(s,m),-b,-a,d-1); if(sc>=b)return b; if(sc>a)a=sc;
 } return a;
}
function negamax(s,d,a,b){
 const moves=engine.getAllLegalMoves(s,s.turn);
 if(!moves.length)return engine.isInCheck(s,s.turn)?-MATE-d:0;
 if(d===0)return quiescence(s,a,b,4);
 let best=-Infinity;
 for(const m of orderMoves(moves)){const sc=-negamax(engine.applyMove(s,m),d-1,-b,-a);if(sc>best)best=sc;if(best>a)a=best;if(a>=b)break;}
 return best;
}
function chooseBotMove(state,depth=3){
 const moves=engine.getAllLegalMoves(state,state.turn);if(!moves.length)return null;
 let best=orderMoves(moves)[0], bestScore=-Infinity, alpha=-Infinity;
 for(const m of orderMoves(moves)){const sc=-negamax(engine.applyMove(state,m),depth-1,-Infinity,-alpha);if(sc>bestScore){bestScore=sc;best=m;}if(bestScore>alpha)alpha=bestScore;}
 return best;
}
module.exports={chooseBotMove,evalWhitePerspective};

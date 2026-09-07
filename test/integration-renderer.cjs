// Hidden test window, isolated profile and mocked IPC/network. Never touches installed-app data.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'namu-renderer-test-'));
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, 'renderer-fixture.html'));
  await win.webContents.executeJavaScript(`
    localStorage.clear();
    window.testWikiShows = 0;
    window.namuRace = new Proxy({
      defaultServerUrl: async () => 'https://game.test',
      request: async () => ({ok:true,data:{route:{startTitle:'출발',goalTitle:'목표'}}}),
      showWiki: () => { window.testWikiShows++; },
    }, {get:(target,key) => target[key] || (() => Promise.resolve(null))});
    window.testSockets = [];
    window.WebSocket = class {
      static OPEN=1; static CONNECTING=0; static CLOSED=3;
      readyState=0; sent=[];
      constructor(url){ this.url=String(url); window.testSockets.push(this); }
      send(data){ this.sent.push(data); }
      open(){ this.readyState=1; this.onopen?.(); }
      close(){ this.readyState=3; this.onclose?.(); }
    };
    void 0;
  `);
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer-online.js'), 'utf8');
  await win.webContents.executeJavaScript(source);
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      const check = (value, label) => { if(!value) throw Error(label); };
      state.session={code:'TEST23',playerId:'me',playerToken:'secret',hostToken:'host'};
      const previous={round:1,score:800,clicks:3,elapsedMs:10000,finished:true,path:['출발1','목표1']};
      state.room={code:'TEST23',hostPlayerId:'me',hostToken:'host',mode:'rounds',round:2,totalRounds:3,
        status:'racing',startTitle:'출발2',goalTitle:'목표2',startedAt:Date.now()-20000,hint:null,
        players:[
          {id:'me',nickname:'나자신',score:800,clicks:2,finishedAt:Date.now()-1000,roundResults:[previous],path:['출발2','중간2','목표2']},
          {id:'friend',nickname:'친구',score:700,clicks:1,currentTitle:'문서A',finishedAt:null,roundResults:[previous]},
        ]};
      render();
      const root=appRoot.firstElementChild;
      const details=document.querySelector('[data-player-path="me"]');
      details.open=true;
      await new Promise(resolve=>setTimeout(resolve,10));
      check(details.querySelectorAll('[data-round]').length===2,'round 2 provisional result missing');
      check(details.textContent.includes('점수 집계 대기'),'pending score label');
      for(let i=0;i<20;i++){
        state.room.players[1].currentTitle='친구 문서'+i; state.room.players[1].clicks++;
        render();
      }
      check(appRoot.firstElementChild===root,'result root recreated');
      check(document.querySelector('[data-player-path="me"]')===details && details.open,'details recreated or closed');
      check(document.querySelector('[data-player-row="friend"]').textContent.includes('친구 문서19'),'live position not updated');
      check(window.testWikiShows===0,'spectator wiki reopened');
      state.room.players[0].roundResults.push({...previous,round:2,score:950,path:['출발2','중간2','목표2']});
      state.room.players[1].finishedAt=Date.now();
      state.room.players[1].path=['출발2','목표2'];
      state.room.players[1].roundResults.push({...previous,round:2,path:['출발2','목표2']});
      state.room.status='round_result'; state.room.players.reverse(); render();
      check(document.querySelector('[data-player-path="me"]')===details && details.open,'details lost on rank reorder');
      check(details.querySelectorAll('[data-round]').length===2,'duplicate current round after settlement');
      check(details.textContent.includes('950점') && !details.textContent.includes('점수 집계 대기'),'settled score not refreshed');
      check(document.querySelector('[data-action="next-round"]'),'round controls not updated');
      const friendDetails=document.querySelector('[data-player-path="friend"]');
      friendDetails.open=true; state.room.players[0].departed=true; render();
      check(document.querySelector('[data-player-path="friend"]')===friendDetails && friendDetails.open,'departed player details lost');
      connectSocket(); const first=socket; first.open();
      const staleClose=first.onclose, staleMessage=first.onmessage;
      for(let i=0;i<10;i++) await runAction(async()=>({room:state.room}));
      check(window.testSockets.length===1,'actions reconnect healthy socket');
      state.session.playerToken='replacement'; connectSocket(); const second=socket; second.open();
      staleClose(); staleMessage({data:JSON.stringify({type:'room',room:null})});
      check(socket===second && state.connection==='live' && socketHeartbeat!==null,'stale callback disrupted current socket');
      closeSocket(); clearTimeout(pollTimer);
      return {ok:true, stableResults:true, roundTwoDetails:true, liveUpdates:true, reusedSocket:true};
    })()
  `);
  assert.equal(result.ok, true);
  console.log(JSON.stringify(result));
  win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

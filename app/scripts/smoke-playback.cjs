// Run after npm run build: electron scripts/smoke-playback.cjs
// Uses a fresh temporary profile and synthetic audio; never reads the user's keys or playlists.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-playback-test-'));
// Electron may outlive its launching terminal. Never write test results to
// inherited stdout/stderr: a closed parent pipe raises EPIPE in the main process.
const log = (...values) => fs.appendFileSync(path.join(profile, 'test-results.log'), `${values.join(' ')}\n`);
const originalSetPath = app.setPath.bind(app);
app.setPath = (name, value) => originalSetPath(name, name === 'userData' ? profile : value);
process.env.RAIN_DEV_INSTANCE = '1';
delete process.env.VITE_DEV_SERVER_URL;
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const rate = 48000, seconds = 20;
const wav = Buffer.alloc(44 + rate * seconds * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < rate * seconds; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 1000 * i / rate) * 4000), 44 + i * 2);
const audioPath = path.join(profile, 'tone.wav'); fs.writeFileSync(audioPath, wav);
const checks = []; const errors = [];
const server = http.createServer((req, res) => {
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
  const headers = { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${wav.length}`;
  res.writeHead(range ? 206 : 200, headers); res.end(wav.subarray(start, end + 1));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const run = (code) => win.webContents.executeJavaScript(code, true);
async function until(code, message) {
  for (let i = 0; i < 80; i++) { if (await run(code)) return; await sleep(100); }
  throw new Error(message);
}
async function click(selector) { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(100); }
async function mouseClick(selector) {
  const point = await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const r = e.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; if (!e.contains(document.elementFromPoint(x, y))) throw new Error('Click target obstructed: ' + ${JSON.stringify(selector)}); return { x: Math.round(x), y: Math.round(y) }; })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  await sleep(200);
}
async function textClick(text) {
  await run(`(() => { const e = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)} && x.getClientRects().length); if (!e) throw new Error('Button missing'); e.click(); })()`);
  await sleep(150);
}
function check(label, value) { assert.ok(value, label); checks.push(label); log('PASS', label); }

require('../electron/main.cjs');
(async () => {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await sleep(100); }
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  const remote = `http://127.0.0.1:${server.address().port}/tone.wav`;
  const local = pathToFileURL(audioPath).href;
  const tracks = Array.from({ length: 60 }, (_, i) => ({ source: 'local', id: `test-${i}`, title: `测试歌曲 ${i + 1}`, artist: '测试歌手', album: '测试专辑', audioUrl: `${local}?track=${i}`, duration: seconds, lyricRaw: '[00:00]第一句测试歌词\n[00:10]第二句测试歌词' }));
  const playlists = [{ source: 'custom', id: 'test', url: '', title: '定位测试歌单', tracks }, { source: 'qq', id: '123', url: 'https://y.qq.com/test', title: '刷新测试歌单', tracks: [{ ...tracks[0], source: 'qq', audioUrl: remote }] }];
  playlists.push({ source: 'netease', id: '456', url: 'https://music.163.com/playlist?id=456', title: '网易云刷新测试', tracks: [{ ...tracks[0], source: 'netease' }] });
  let refreshCount = 0, failRefresh = false, searches = [];
  let neteaseRefreshCount = 0, malformedPlaylist = false;
  const qualityRequests = [];
  for (const [name, handler] of Object.entries({
    'settings:get': () => ({ hasApiKey: true, closeAction: 'quit' }),
    'qq:playlist': async () => { refreshCount++; await sleep(200); return failRefresh ? { ok: false, message: '测试网络错误' } : { ok: true, playlist: { ...playlists[1], tracks: [...playlists[1].tracks, { ...playlists[1].tracks[0], id: 'extra', title: '刷新新增歌曲' }] } }; },
    'api:request': (_event, request) => {
      if (request.path === '/api/qq_music') {
        qualityRequests.push(request);
        return { ok: true, data: { url: `${remote}?quality=${request.params.size}`, duration: seconds } };
      }
      if (request.path === '/api/163_playlist') {
        neteaseRefreshCount++;
        return { ok: true, data: malformedPlaylist ? { unexpected: true } : { playlist: { id: 456, name: '网易云已刷新', tracks: [{ id: 101, name: '最新推荐曲目', ar: [{ name: '刷新歌手' }], al: { name: '刷新专辑' } }] } } };
      }
      searches.push(request); return { ok: true, data: { songs: [] } };
    },
  })) { ipcMain.removeHandler(name); ipcMain.handle(name, handler); }
  await run(`localStorage.clear(); localStorage.setItem('rain_seen_release_announcement', ${JSON.stringify(app.getVersion())}); localStorage.setItem('rain_playlists', ${JSON.stringify(JSON.stringify(playlists))})`);
  await run(`localStorage.setItem('rain_saved_artists', JSON.stringify([{id:'history-artist',source:'netease',name:'历史歌手'}]))`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('.sidebar')`, 'App did not mount');
  await textClick('设置');
  log('Native window background', win.getBackgroundColor());
  check('Liquid controls and default appearance are available', await run(`!!document.querySelector('#liquid-transparency') && document.documentElement.dataset.liquid === 'on'`));
  await run(`document.querySelector('#liquid-transparency').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' }); await sleep(400);
  check('Full transparency clears window and large panel backgrounds', await run(`document.querySelector('#liquid-transparency').value === '100' && getComputedStyle(document.querySelector('.app-shell')).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(document.querySelector('.sidebar')).backgroundColor === 'rgba(0, 0, 0, 0)'`));
  const clearCapture = await win.webContents.capturePage();
  const pixels = clearCapture.toBitmap(); let clearPixels = 0;
  for (let i=3;i<pixels.length;i+=4) if(pixels[i]<10) clearPixels++;
  check('Rendered window has genuine transparent pixels, not a fake backdrop', clearPixels > 10000);
  fs.writeFileSync(path.join(profile, 'liquid-clear.png'), clearCapture.toPNG());
  const appearance = await run(`window.musicBridge.getWindowAppearance()`);
  check('Full transparency persists and disables native frost', appearance.ok && appearance.appearance.transparency === 100 && appearance.material === 'none');
  win.setSize(1100, 760); await sleep(200);
  const resizedPixels = (await win.webContents.capturePage()).toBitmap(); let transparentAfterResize=0;
  for(let i=3;i<resizedPixels.length;i+=4) if(resizedPixels[i]<10) transparentAfterResize++;
  check('Transparency survives window resizing', transparentAfterResize > 10000);
  win.setSize(1420, 900); await sleep(150);
  const frost = await run(`window.musicBridge.applyWindowAppearance({enabled:true,transparency:75,gloss:70,frosted:true})`);
  check('Native frost selects supported system material', frost.ok && frost.material === (frost.acrylicSupported ? 'acrylic' : 'none'));
  await textClick('恢复不透明外观'); await sleep(400);
  check('Appearance switch restores opaque UI', await run(`document.documentElement.dataset.liquid === 'off' && getComputedStyle(document.querySelector('.mini-player')).borderRadius === '0px'`));
  await textClick('恢复试用默认值'); await sleep(400);
  await run(`document.querySelector('#liquid-transparency').scrollIntoView({block:'center'})`); await sleep(200);
  const liquidDrag = await run(`(() => {const r=document.querySelector('#liquid-transparency').getBoundingClientRect(); return {x:Math.round(r.x+r.width*.75),y:Math.round(r.y+r.height/2),end:Math.round(r.x+r.width*.4)};})()`);
  win.focus(); win.webContents.focus();
  win.webContents.sendInputEvent({type:'mouseMove',x:liquidDrag.x,y:liquidDrag.y}); await sleep(80);
  win.webContents.sendInputEvent({type:'mouseDown',x:liquidDrag.x,y:liquidDrag.y,button:'left',modifiers:['leftButtonDown'],clickCount:1}); await sleep(80);
  win.webContents.sendInputEvent({type:'mouseMove',x:liquidDrag.end,y:liquidDrag.y,button:'left',modifiers:['leftButtonDown']}); await sleep(100);
  check('Window transparency updates while dragging before release', await run(`Number(document.querySelector('#liquid-transparency').value) < 45 && Number(document.documentElement.style.getPropertyValue('--window-tint')) > .55`));
  win.webContents.sendInputEvent({type:'mouseUp',x:liquidDrag.end,y:liquidDrag.y,button:'left',clickCount:1});
  await textClick('恢复试用默认值'); await sleep(400);
  fs.writeFileSync(path.join(profile, 'liquid-default.png'), (await win.webContents.capturePage()).toPNG());
  // Instrument only this isolated test window to prove the actual media source has nonzero output.
  await run(`window.__sources = []; window.__filters = []; const oldSource = AudioContext.prototype.createMediaElementSource; AudioContext.prototype.createMediaElementSource = function(el) { const node = oldSource.call(this, el); const analyser = this.createAnalyser(); node.connect(analyser); window.__sources.push({ node, analyser, context: this }); return node; }; const oldFilter = AudioContext.prototype.createBiquadFilter; AudioContext.prototype.createBiquadFilter = function() { const filter = oldFilter.call(this); window.__filters.push(filter); return filter; }; void 0;`);
  await textClick('我的歌单');
  check('Removed obsolete Kugou note', !(await run(`document.querySelector('.playlist-note').textContent.includes('酷狗')`)));
  await click('.playlist-summary');
  await run(`document.querySelector('.playlist-detail-view').scrollTop = 900`); await sleep(100);
  check('Return button remains visible after playlist scrolling', await run(`(() => { const e=document.querySelector('.page-return'), r=e.getBoundingClientRect(); return r.top > 0 && r.bottom < 110 && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })()`));
  await textClick('设置');
  await mouseClick('[aria-label="后退到上一页"]');
  check('History restores playlist detail and scroll position', await run(`document.querySelector('.playlist-detail-view')?.scrollTop >= 899`));
  await mouseClick('[aria-label="前进到下一页"]');
  check('History forward returns to settings', await run(`!!document.querySelector('.settings-view')`));
  await mouseClick('[aria-label="后退到上一页"]');
  await textClick('喜欢的音乐');
  check('New navigation clears forward history', await run(`document.querySelector('[aria-label="前进到下一页"]').disabled`));
  await mouseClick('[aria-label="后退到上一页"]');
  await run(`document.querySelector('.playlist-detail-view').scrollTop = 0`);
  await textClick('全部播放');
  await until(`document.querySelector('audio').currentTime > .3`, 'Local playback did not start');
  check('Local audio routed through CORS-enabled stream', await run(`document.querySelector('audio').src.startsWith('rain-stream:')`));
  check('Local audio produces Web Audio samples', await run(`(() => { const a = new Float32Array(2048); __sources[0].analyser.getFloatTimeDomainData(a); return a.some(x => Math.abs(x) > .001); })()`));
  await click('[data-track-key="local:test-34"] .saved-track-main');
  await until(`document.querySelector('.mini-track strong').textContent === '测试歌曲 35'`, 'Track selection failed');
  await run(`document.querySelector('.playlist-detail-view').scrollTop = 0`);
  check('Floating locator visible above the fold', await run(`(() => { const r = document.querySelector('.locate-track-button').getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight; })()`));
  await click('.locate-track-button');
  await sleep(600);
  check('Locator brings active row into view', await run(`(() => { const r = document.querySelector('[data-current="true"]').getBoundingClientRect(); return r.top >= 0 && r.bottom < innerHeight - 70; })()`));
  await click('.mini-actions [aria-label="当前列表"]');
  check('Clicking a playlist track retains all 60 queue entries', await run(`document.querySelector('.mini-actions .recent-popover-title small').textContent === '60 首'`));
  await click('.mini-actions [aria-label="当前列表"]');
  await click('.mini-track');
  await until(`document.querySelector('.lyrics-view')?.dataset.open === 'true'`, 'Lyrics did not open');
  await sleep(350);
  check('Lyrics tools align horizontally with window controls', await run(`(() => { const r=document.querySelector('.window-controls button').getBoundingClientRect(); return [...document.querySelectorAll('.lyrics-options > button, .quality-select .select-trigger')].every(e=>{const b=e.getBoundingClientRect(); return Math.abs(b.y+b.height/2-r.y-r.height/2)<1;}); })()`));
  check('Cover glow responds to real audio energy', await run(`Number(document.querySelector('.beat-aura').style.opacity) > .16`));
  await click('.large-play'); await sleep(100);
  check('Cover glow stops on pause', await run(`Number(document.querySelector('.beat-aura').style.opacity) === .16`));
  await click('.large-play'); await sleep(200);
  fs.writeFileSync(path.join(profile, 'lyrics-v114.png'), (await win.webContents.capturePage()).toPNG());
  await textClick('均衡器');
  check('Romanization button removed', !(await run(`document.querySelector('.lyrics-options').textContent.includes('音标')`)));
  check('10 equalizer bands and connection line', await run(`document.querySelectorAll('.eq-slider').length === 10 && !!document.querySelector('.eq-lines polyline')`));
  await run(`document.querySelectorAll('.eq-slider')[5].focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' });
  await sleep(100);
  check('Range keyboard input updates filter and persistence', await run(`JSON.parse(localStorage.getItem('rain_equalizer_v1'))[5] === 1 && __filters.length === 10 && __filters[5].gain.value > .9`));
  await run(`window.__output = __sources[0].context.createAnalyser(); __filters[9].connect(__output);`);
  await sleep(100);
  const baseline = await run(`(() => { const samples = new Float32Array(2048); __output.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); })()`);
  await run(`(() => { const input = document.querySelectorAll('.eq-number')[5]; input.focus(); input.select(); })()`);
  await win.webContents.insertText('-12');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await sleep(100);
  check('Integer input updates gain to -12 dB', await run(`JSON.parse(localStorage.getItem('rain_equalizer_v1'))[5] === -12 && __filters[5].gain.value < -11.9`));
  await sleep(200);
  const attenuated = await run(`(() => { const samples = new Float32Array(2048); __output.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); })()`);
  check('1 kHz filter audibly attenuates the signal by about 12 dB', attenuated / baseline > .15 && attenuated / baseline < .4);
  await run(`document.querySelectorAll('.eq-number')[0].focus(); document.querySelectorAll('.eq-number')[0].select()`);
  await win.webContents.insertText('4.5');
  check('Decimal input is rejected', await run(`!document.querySelectorAll('.eq-number')[0].value.includes('.')`));
  await run(`document.querySelectorAll('.eq-number')[0].select()`); await win.webContents.insertText('99');
  await run(`document.querySelectorAll('.eq-number')[0].blur()`); await sleep(100);
  check('Out-of-range integer clamps to +12 dB', await run(`JSON.parse(localStorage.getItem('rain_equalizer_v1'))[0] === 12`));
  const drag = await run(`(() => { const r = document.querySelectorAll('.eq-slider-area')[2].getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.y) }; })()`);
  win.focus(); win.webContents.focus();
  win.webContents.sendInputEvent({ type: 'mouseMove', x: drag.x, y: drag.y }); await sleep(100);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: drag.x, y: drag.y, button: 'left', modifiers: ['leftButtonDown'], clickCount: 1 });
  await sleep(100);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: drag.x, y: drag.top + 50, button: 'left', modifiers: ['leftButtonDown'] });
  await sleep(100);
  win.webContents.sendInputEvent({ type: 'mouseUp', x: drag.x, y: drag.top + 50, button: 'left', clickCount: 1 });
  await sleep(100);
  check('Dragging a circular handle changes integer gain', await run(`Number.isInteger(JSON.parse(localStorage.getItem('rain_equalizer_v1'))[2]) && JSON.parse(localStorage.getItem('rain_equalizer_v1'))[2] === 6`));
  fs.writeFileSync(path.join(profile, 'equalizer.png'), (await win.webContents.capturePage()).toPNG());
  await textClick('恢复 0 dB');
  check('Reset restores all ten gains', await run(`JSON.parse(localStorage.getItem('rain_equalizer_v1')).every(v => v === 0)`));
  await click('[aria-label="关闭均衡器"]');
  check('Equalizer closes', await run(`!document.querySelector('.eq-panel')`));
  await click('.lyrics-close'); await sleep(300);
  const before = await run(`document.querySelector('.mini-track strong').textContent`);
  await click('[data-current="true"] .metadata-link');
  await until(`document.querySelector('.search-box input').value === '测试歌手'`, 'Metadata search not applied');
  check('Artist click searches without changing playback', (await run(`document.querySelector('.mini-track strong').textContent`)) === before && searches.at(-1).params.keyword === '测试歌手');
  await textClick('我的歌单');
  await click('.playlist-summary');
  await click('.result-album .metadata-link');
  await until(`document.querySelector('.search-box input').value === '测试专辑'`, 'Album metadata search failed');
  check('Album click searches the album name', searches.at(-1).params.keyword === '测试专辑');
  await textClick('歌手'); await click('.library-entity-main');
  await until(`document.querySelector('.entity-detail-hero h1')?.textContent === '历史歌手' && !document.querySelector('.entity-detail-hero').textContent.includes('正在使用')`, 'Artist history detail did not finish');
  const entityRequestsBefore = searches.length;
  await textClick('返回搜索结果');
  await mouseClick('[aria-label="后退到上一页"]');
  check('Back restores artist detail without another API request', searches.length === entityRequestsBefore && await run(`document.querySelector('.entity-detail-hero h1')?.textContent === '历史歌手'`));
  await mouseClick('[aria-label="前进到下一页"]');
  check('Forward restores search results without another API request', searches.length === entityRequestsBefore && await run(`!!document.querySelector('.search-box')`));
  await textClick('我的歌单');
  await run(`document.querySelectorAll('.playlist-summary')[1].click()`); await sleep(100);
  await textClick('刷新歌单');
  await until(`document.querySelectorAll('.playlist-detail-view .saved-track-row').length === 2`, 'Playlist refresh failed');
  check('Refresh calls source once and updates tracks', refreshCount === 1);
  failRefresh = true;
  await textClick('刷新歌单'); await sleep(350);
  check('Failed refresh retains tracks and clears loading', await run(`document.querySelectorAll('.playlist-detail-view .saved-track-row').length === 2 && !document.querySelector('.playlist-refresh').disabled`));
  await textClick('全部播放');
  await until(`document.querySelector('audio').currentTime > .3`, 'Remote playback did not start');
  check('Remote audio without upstream CORS produces samples', await run(`(() => { const a = new Float32Array(2048); __sources[0].analyser.getFloatTimeDomainData(a); return a.some(x => Math.abs(x) > .001); })()`));
  check('Only one media source across tracks', await run(`__sources.length === 1`));
  await click('.mini-track'); await sleep(300);
  check('Lyrics drag region excludes window controls geometrically', await run(`(() => { const e = document.querySelector('.lyrics-drag-zone'), r = e.getBoundingClientRect(), controls = document.querySelector('.window-controls').getBoundingClientRect(); return r.left === 0 && r.right <= controls.left && r.top === 0 && r.height === 64 && getComputedStyle(e).webkitAppRegion === 'drag' && getComputedStyle(document.querySelector('.window-drag')).display === 'none'; })()`));
  check('Window buttons remain above lyrics and outside drag regions', await run(`[...document.querySelectorAll('.window-controls button')].every(e => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && getComputedStyle(e).webkitAppRegion === 'no-drag'; })`));
  await mouseClick('.window-controls [aria-label="最大化"]');
  await until(`!!document.querySelector('.window-controls [aria-label="还原窗口"]')`, 'Maximize did not respond');
  check('Window maximize works from lyrics', win.isMaximized());
  await mouseClick('.window-controls [aria-label="还原窗口"]');
  await until(`!!document.querySelector('.window-controls [aria-label="最大化"]')`, 'Restore did not respond');
  check('Window restores from maximized lyrics', !win.isMaximized());
  await mouseClick('.window-controls [aria-label="最小化"]');
  check('Window minimize works from lyrics', win.isMinimized());
  win.restore(); win.focus(); await sleep(250);
  let closeRequests = 0;
  ipcMain.removeHandler('window:close'); ipcMain.handle('window:close', () => { closeRequests++; return true; });
  await textClick('均衡器');
  await mouseClick('.window-controls [aria-label="关闭"]');
  check('Close button sends IPC above the equalizer modal', closeRequests === 1);
  await click('[aria-label="关闭均衡器"]');
  await run(`const testOverlay = document.createElement('div'); testOverlay.id='test-release-overlay'; testOverlay.className='close-dialog-backdrop release-announcement-backdrop'; document.querySelector('.app-shell').append(testOverlay); void 0;`);
  await mouseClick('.window-controls [aria-label="关闭"]');
  check('Window controls stay clickable above announcement overlay', closeRequests === 2);
  await run(`document.querySelector('#test-release-overlay').remove()`);
  await run(`document.querySelector('audio').currentTime = 7`); await sleep(250);
  await mouseClick('.quality-select .select-trigger');
  check('Every quality option is above lyrics and clickable', await run(`[...document.querySelectorAll('.quality-select [role="option"]')].every(e => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && getComputedStyle(e).webkitAppRegion === 'no-drag'; })`));
  await mouseClick('.quality-select [role="option"]');
  await until(`document.querySelector('.quality-select .select-trigger').textContent.includes('128 kbps') && !document.querySelector('.quality-select .select-trigger').disabled`, 'Quality selection failed');
  await until(`document.querySelector('audio').currentTime >= 7 && !document.querySelector('audio').paused`, 'Quality switching lost playback position');
  check('Mouse quality selection requests the selected bitrate and preserves position', qualityRequests.length === 1 && qualityRequests[0].params.size === '128k');
  await mouseClick('.quality-select .select-trigger');
  await mouseClick('.quality-select [role="option"]:nth-child(2)');
  await until(`document.querySelector('.quality-select .select-trigger').textContent.includes('320 kbps') && !document.querySelector('.quality-select .select-trigger').disabled`, 'Second quality selection failed');
  check('Quality can be changed repeatedly', qualityRequests.length === 2 && qualityRequests[1].params.size === '320k');
  await click('.lyrics-close'); await sleep(300);
  const rangeResult = await run(`fetch(document.querySelector('audio').src, { headers: { Range: 'bytes=100-199' } }).then(async r => ({status:r.status, size:(await r.arrayBuffer()).byteLength}))`);
  check('Remote range seeking is preserved', rangeResult.status === 206 && rangeResult.size === 100);
  const cached = await run(`window.musicBridge.cacheAudio('smoke-test-audio', ${JSON.stringify(remote)})`);
  check('Synthetic audio cached successfully', cached.ok);
  await run(`document.querySelector('audio').src = ${JSON.stringify(cached.url)}; document.querySelector('audio').load(); document.querySelector('audio').play(); void 0;`);
  await until(`document.querySelector('audio').currentTime > .3`, 'Cached playback failed');
  check('Cached audio produces Web Audio samples', await run(`(() => { const a = new Float32Array(2048); __sources[0].analyser.getFloatTimeDomainData(a); return a.some(x => Math.abs(x) > .001); })()`));
  await textClick('返回我的歌单');
  await run(`document.querySelectorAll('.playlist-summary')[2].click()`); await sleep(100);
  await textClick('刷新歌单');
  await until(`document.querySelector('.playlist-detail-hero h1').textContent === '网易云已刷新'`, 'NetEase refresh failed');
  check('NetEase refresh replaces songs with one request', neteaseRefreshCount === 1 && await run(`document.querySelector('.playlist-detail-view .result-title strong').textContent === '最新推荐曲目'`));
  fs.writeFileSync(path.join(profile, 'navigation-v114.png'), (await win.webContents.capturePage()).toPNG());
  malformedPlaylist = true; await textClick('刷新歌单');
  check('Malformed NetEase response preserves original collection', await run(`document.querySelector('.playlist-detail-view .result-title strong').textContent === '最新推荐曲目'`));
  await click('.mini-track'); await sleep(300); await textClick('均衡器');
  await run(`document.querySelectorAll('.eq-slider')[3].focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' }); await sleep(100);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('.mini-track')`, 'Reload failed');
  await click('.mini-track'); await sleep(300); await textClick('均衡器');
  check('Equalizer settings survive app reload', await run(`document.querySelectorAll('.eq-number')[3].value === '1'`));
  win.setSize(980, 680); await sleep(200);
  check('Equalizer fits minimum window dimensions', await run(`(() => { const r = document.querySelector('.eq-panel').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
  fs.writeFileSync(path.join(profile, 'equalizer-small.png'), (await win.webContents.capturePage()).toPNG());
  check('No renderer errors', errors.length === 0);
  log(JSON.stringify({ passed: checks.length, screenshots: profile, errors }, null, 2));
  server.close(); app.exit(0);
})().catch((error) => { log(error.stack); log(JSON.stringify({ profile, errors })); server.close(); app.exit(1); });

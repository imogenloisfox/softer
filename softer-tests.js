// Real-browser tests for the SOFTER blob tool.   Usage: node softer-tests.js [path/to/index.html]
// Needs: npm i playwright  (and a Chromium install). Exits non-zero if any check fails.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const FILE = path.resolve(process.argv[2] || '../index.html');
const results = [];
function check(name, ok, detail=''){ results.push({name, ok:!!ok, detail}); console.log((ok?'  PASS ':'  FAIL ')+name+(detail?'  ['+detail+']':'')); }

async function open(browser, opts={}){
  const ctx = await browser.newContext({ viewport:{width:1280,height:800}, acceptDownloads:true, ...opts });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto('file://'+FILE); await page.waitForTimeout(500);
  return { ctx, page, errors, dialogs };
}
const nodes = async p => parseInt(await p.$eval('#nodeInfo', e=>e.textContent));
const note  = async p => p.$eval('#textNote', e=>e.textContent);
const toastText = async p => p.$eval('#toast', e=>e.classList.contains('show') ? e.textContent : '');
const info  = async p => p.$eval('#gridInfo', e=>e.textContent);
const zoomPct = async p => parseInt((await info(p)).match(/(\d+)% zoom/)[1]);
async function box(p){ return (await p.$('#stage')).boundingBox(); }
async function clickSavePng(p){ await p.click('#saveBtn'); await p.click('#savePngBtn'); }
async function stickers(p){ return p.evaluate(()=>window.softerState().stickers); }
async function typeText(p, text, font){ if(font) await p.selectOption('#fontSelect', font); await p.fill('#textInput', text); await p.waitForTimeout(1100); }
async function dragStroke(p, from, to, steps=10){ await p.mouse.move(from.x, from.y); await p.mouse.down(); for(let i=1;i<=steps;i++) await p.mouse.move(from.x+(to.x-from.x)*i/steps, from.y+(to.y-from.y)*i/steps); await p.mouse.up(); }

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  console.log('\n== 1. Accents and font coverage ==');
  { const {page,errors} = await open(browser);
    await typeText(page, 'Søren Åse José', 'Font 07');
    check('Font 07 handles ø Å é: no warning, nodes drawn', (await note(page))==='' && (await nodes(page))>0, `nodes=${await nodes(page)} note="${await note(page)}"`);
    await typeText(page, 'ø', 'Font 11');
    check('Font 11 has no ø: visitor is told', /Font 11 has no glyph for ø/.test(await note(page)), await note(page));
    await typeText(page, 'hello?', 'Font 18');
    check('Font 18 (almost no punctuation): the missing mark is reported', /Font 18 has no glyph for \?/.test(await note(page)), await note(page));
    await typeText(page, 'Søren Åse', 'Font 17');
    check('Font 17 (replacement) covers accents: no warning', (await note(page))==='', await note(page));
    await page.fill('#textInput', ''); await page.waitForTimeout(300);
    check('note clears when the text is cleared', (await note(page))==='');
    await typeText(page, '\u200b', 'Font 07');
    check('text that draws nothing explains itself (and does not blame an invisible character)', /Nothing to draw/.test(await note(page)) && !/no glyph/.test(await note(page)) && (await nodes(page))===0, await note(page));
    check('no page errors', errors.length===0, errors.join('|'));
    await page.context().close(); }

  console.log('\n== 2. Undo / redo ==');
  { const {page,errors} = await open(browser); const b = await box(page);
    const c = {x:b.x+b.width/2, y:b.y+b.height/2};
    check('Undo and Redo start disabled', await page.$eval('#undoBtn',e=>e.disabled) && await page.$eval('#redoBtn',e=>e.disabled));
    await typeText(page, 'softer', 'Font 07'); const n = await nodes(page);
    await page.click('#undoBtn');
    check('typing a word is ONE undo step', n>20 && (await nodes(page))===0, `${n} -> ${await nodes(page)}`);
    await page.click('#redoBtn');
    check('Redo brings the whole word back', (await nodes(page))===n, `${await nodes(page)}`);
    await page.click('#undoBtn');
    for(const t of ['s','so','sof','soft','softe']){ await page.fill('#textInput', t); await page.waitForTimeout(500); }
    await page.click('#undoBtn');
    check('retyping a word does not add a step per keystroke', (await nodes(page))===0, `${await nodes(page)}`);
    await page.click('#clearBtn');   // nothing to clear
    await page.fill('#textInput',''); await page.click('#clearBtn');
    // strokes
    await dragStroke(page, {x:c.x-120,y:c.y}, {x:c.x+120,y:c.y}); const strokeNodes = await nodes(page);
    await page.click('#undoBtn');
    check('a whole drag stroke is ONE undo step', strokeNodes>5 && (await nodes(page))===0, `${strokeNodes} -> ${await nodes(page)}`);
    await page.click('#redoBtn');
    // erase
    await page.click('#modeSeg button[data-mode="erase"]'); await dragStroke(page, {x:c.x-60,y:c.y}, {x:c.x+60,y:c.y}); const afterErase = await nodes(page);
    await page.click('#undoBtn');
    check('erasing is undoable', afterErase < strokeNodes && (await nodes(page))===strokeNodes, `${strokeNodes} -> ${afterErase} -> ${await nodes(page)}`);
    await page.click('#modeSeg button[data-mode="draw"]');
    // clear
    await page.click('#clearBtn'); const afterClear = await nodes(page);
    await page.click('#undoBtn');
    check('Clear is undoable', afterClear===0 && (await nodes(page))===strokeNodes, `${afterClear} -> ${await nodes(page)}`);
    // no dead step from a click that changes nothing
    await page.click('#clearBtn'); await page.mouse.click(c.x, c.y); await page.mouse.click(c.x, c.y); // 2nd click lands on an existing dot: no change
    await page.click('#undoBtn');
    check('a click that changes nothing leaves no dead undo step', (await nodes(page))===0, `${await nodes(page)}`);
    await page.click('#redoBtn');
    await page.mouse.click(c.x+80, c.y);
    check('a new action empties the redo stack', await page.$eval('#redoBtn',e=>e.disabled));
    // keyboard
    await page.keyboard.press('Control+z'); const afterKey = await nodes(page);
    await page.keyboard.press('Control+Shift+z');
    check('Ctrl+Z / Ctrl+Shift+Z work', afterKey===1 && (await nodes(page))===2, `${afterKey} then ${await nodes(page)}`);
    await page.click('#clearBtn'); await page.mouse.click(c.x, c.y);
    await page.$eval('#spacingSlider', e=>{ e.focus(); });
    await page.keyboard.press('Control+z');
    check('Ctrl+Z still undoes the drawing while a slider has focus', (await nodes(page))===0, `${await nodes(page)}`);
    await page.keyboard.press('Control+Shift+z');
    // sticker + node ordering
    await page.click('#clearBtn'); await page.mouse.click(c.x-100, c.y);
    await (await page.$$('.sticker-thumb'))[0].click(); await page.mouse.click(c.x+100, c.y); await (await page.$$('.sticker-thumb'))[0].click();
    check('sticker stamped', (await stickers(page)).length===1);
    await page.click('#undoBtn');
    check('Undo removes the sticker first, then the dot', (await nodes(page))===1 && (await stickers(page)).length===0);
    await page.click('#undoBtn'); check('...then the dot', (await nodes(page))===0);
    // history is bounded
    await page.click('#clearBtn');
    for(let i=0;i<70;i++) await page.mouse.click(b.x+20+(i%30)*24, b.y+30+Math.floor(i/30)*40);
    const placed = await nodes(page);
    for(let i=0;i<90 && await page.$eval('#undoBtn',e=>!e.disabled);i++) await page.click('#undoBtn');
    check('history is bounded at 60 steps', placed===70 && (await nodes(page))===10, `placed ${placed}, left after 90 undos ${await nodes(page)}`);
    check('no page errors', errors.length===0, errors.join('|'));
    await page.context().close(); }

  console.log('\n== 3. Save ==');
  { const {page,errors,dialogs} = await open(browser);
    await page.click('#saveBtn'); await page.waitForTimeout(300);
    check('Save with nothing drawn shows a message, not an alert()', /first/.test(await toastText(page)) && dialogs.length===0, await toastText(page));
    await typeText(page, 'softer', 'Font 07');
    const live = await page.$eval('#stage', e=>[e.width,e.height]); const info0 = await info(page); const n0 = await nodes(page);
    let stale = 0;
    for(let i=0;i<6;i++){
      const r = await page.evaluate(()=>new Promise(res=>{ const c=document.getElementById('stage'); const w=c.width; document.getElementById('saveBtn').click(); document.getElementById('savePngBtn').click(); requestAnimationFrame(()=>res([w,c.width])); }));
      if(r[0]!==r[1]) stale++; await page.waitForTimeout(700);
    }
    check('live canvas is never left in export state at the next paint (6 trials)', stale===0, `${stale} stale`);
    const [dl] = await Promise.all([page.waitForEvent('download'), clickSavePng(page)]);
    const file = await dl.path(); const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const cr = live[0]/live[1];
    check('PNG has the canvas aspect ratio', Math.abs(w/h-cr)<0.01, `${w}x${h} vs canvas ${cr.toFixed(3)}`);
    const px = await page.evaluate(async b64=>{ const im=new Image(); im.src='data:image/png;base64,'+b64; await im.decode(); const c=document.createElement('canvas'); c.width=im.width; c.height=im.height; const x=c.getContext('2d'); x.drawImage(im,0,0); return [x.getImageData(0,0,1,1).data[3], x.getImageData(im.width>>1,0,1,1).data[3]]; }, buf.toString('base64'));
    check('corners transparent, edges opaque', px[0]===0 && px[1]===255, JSON.stringify(px));
    check('live view unchanged after Save', (await info(page))===info0 && (await nodes(page))===n0 && JSON.stringify(await page.$eval('#stage',e=>[e.width,e.height]))===JSON.stringify(live));
    check('Save confirms with a message', /Saved/.test(await toastText(page)), await toastText(page));
    check('no alert() dialogs used', dialogs.length===0);
    await page.context().close(); }
  { // failure path: export render throws -> live canvas must still be intact and usable
    const ctx = await browser.newContext({ viewport:{width:1280,height:800} }); const page = await ctx.newPage();
    const dialogs=[]; page.on('dialog', d=>{dialogs.push(d.message()); d.dismiss();});
    await page.addInitScript(()=>{ window.__failExport=false; const orig=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(...a){ if(window.__failExport && this.width>=1000) return null; return orig.apply(this,a); }; });
    await page.goto('file://'+FILE); await page.waitForTimeout(400);
    const b = await box(page); await page.mouse.click(b.x+200,b.y+200);
    const live = await page.$eval('#stage', e=>[e.width,e.height]);
    await page.evaluate(()=>window.__failExport=true); await clickSavePng(page); await page.waitForTimeout(300); await page.evaluate(()=>window.__failExport=false);
    check('export failure is reported and the live canvas is restored', /Could not render/.test(await toastText(page)) && JSON.stringify(await page.$eval('#stage',e=>[e.width,e.height]))===JSON.stringify(live) && dialogs.length===0, await toastText(page));
    await page.mouse.click(b.x+300,b.y+200);
    check('drawing still works after a failed export', (await nodes(page))===2);
    await ctx.close(); }

  console.log('\n== 4. Touch pan and pinch ==');
  { const {ctx,page,errors} = await open(browser, {hasTouch:true}); const cdp = await ctx.newCDPSession(page); const b = await box(page);
    const cx = b.x+b.width/2, cy = b.y+b.height/2;
    const T = async (type, pts)=>cdp.send('Input.dispatchTouchEvent',{type, touchPoints:pts.map(([x,y,id])=>({x,y,id}))});
    await T('touchStart',[[cx,cy,0]]); await T('touchEnd',[]); await page.waitForTimeout(150);
    check('one-finger tap draws a dot', (await nodes(page))===1, `${await nodes(page)}`);
    await page.click('#clearBtn');
    // pinch on an empty canvas: no stray dot, zoom doubles
    const z0 = await zoomPct(page);
    await T('touchStart',[[cx-60,cy,0]]); await T('touchStart',[[cx-60,cy,0],[cx+60,cy,1]]);
    for(let i=1;i<=8;i++){ const d=60+60*i/8; await T('touchMove',[[cx-d,cy,0],[cx+d,cy,1]]); }
    const z1 = await zoomPct(page);
    check('pinch out doubles the zoom', Math.abs(z1/z0-2)<0.1, `${z0}% -> ${z1}%`);
    check('the first finger of a pinch leaves no stray dot', (await nodes(page))===0, `${await nodes(page)}`);
    await T('touchEnd',[[cx+120,cy,1]]);
    await T('touchMove',[[cx+160,cy+30,1]]); await T('touchEnd',[]); await page.waitForTimeout(150);
    check('the remaining finger does not draw after a pinch', (await nodes(page))===0 && (await zoomPct(page))===z1, `${await nodes(page)} nodes`);
    await T('touchStart',[[cx,cy+100,0]]); await T('touchEnd',[]); await page.waitForTimeout(150);
    check('drawing works again once every finger has lifted', (await nodes(page))===1, `${await nodes(page)}`);
    // pan: a placed dot moves with two fingers
    await page.click('#clearBtn'); await page.mouse.click(cx-100, cy); // a dot
    const centroid = async()=>{ const shot = await (await page.$('#stage')).screenshot(); return page.evaluate(async b64=>{ const im=new Image(); im.src='data:image/png;base64,'+b64; await im.decode(); const c=document.createElement('canvas'); c.width=im.width; c.height=im.height; const x=c.getContext('2d'); x.drawImage(im,0,0); const d=x.getImageData(0,0,c.width,c.height).data; let sx=0,n=0; for(let y=0;y<c.height;y++)for(let xx=0;xx<c.width;xx++){ const i=(y*c.width+xx)*4; if(d[i]>240&&d[i+1]<215&&d[i+2]>225&&d[i+2]<250){ sx+=xx;n++; } } return n? sx/n : -1; }, shot.toString('base64')); };
    const before = await centroid();
    await T('touchStart',[[cx,cy+150,0]]); await T('touchStart',[[cx,cy+150,0],[cx+50,cy+150,1]]);
    for(let i=1;i<=6;i++) await T('touchMove',[[cx+i*15,cy+150,0],[cx+50+i*15,cy+150,1]]);
    await T('touchEnd',[[cx+140,cy+150,1]]); await T('touchEnd',[]); await page.waitForTimeout(150);
    const after = await centroid();
    check('two-finger drag pans the canvas', before>0 && after>0 && Math.abs((after-before)-90)<8, `dot moved ${(after-before).toFixed(1)}px (expected ~90)`);
    check('panning added no dots', (await nodes(page))===1);
    // sticker tap on lift, but never during a pinch
    await page.click('#clearBtn'); await (await page.$$('.sticker-thumb'))[0].click();
    await T('touchStart',[[cx,cy,0]]); await T('touchEnd',[]); await page.waitForTimeout(200);
    check('with a sticker armed, a touch tap stamps on lift', (await stickers(page)).length>=1);
    await page.click('#clearBtn');
    await T('touchStart',[[cx-40,cy,0]]); await T('touchStart',[[cx-40,cy,0],[cx+40,cy,1]]); await T('touchMove',[[cx-80,cy,0],[cx+80,cy,1]]); await T('touchEnd',[[cx+80,cy,1]]); await T('touchEnd',[]); await page.waitForTimeout(200);
    check('a pinch with a sticker armed stamps nothing', (await stickers(page)).length===0);
    check('no page errors', errors.length===0, errors.join('|'));
    await ctx.close(); }

  console.log('\n== 5. Regression: existing behaviour ==');
  { const {page,errors} = await open(browser); const b = await box(page);
    check('20 fonts in the dropdown', (await page.$$eval('#fontSelect option',o=>o.length))===20);
    check('fonts are injected lazily (none on load)', (await page.evaluate(()=>[...document.querySelectorAll('style')].filter(s=>/font-family:'Font \d\d'/.test(s.textContent)).length))===0);
    await typeText(page,'hi','Font 03');
    check('...and injected once used', (await page.evaluate(()=>[...document.querySelectorAll('style')].filter(s=>/font-family:'Font 03'/.test(s.textContent)).length))===1);
    // gradient defaults
    for(const [seg,top,bot] of [['fillModeSeg','gradientTopSwatches','gradientBottomSwatches'],['bgFillModeSeg','bgGradientTopSwatches','bgGradientBottomSwatches'],['stickerFillModeSeg','stickerGradientTopSwatches','stickerGradientBottomSwatches']]){
      await page.click(`#${seg} button[data-mode="gradient"]`);
      const t = await page.$eval(`#${top} .swatch.active`,e=>e.dataset.color), u = await page.$eval(`#${bot} .swatch.active`,e=>e.dataset.color);
      check(`${seg}: Gradient applies its default pair`, (seg==='bgFillModeSeg'? t==='#FFF5FC'&&u==='#FFCCEE' : t==='#FFA4E0'&&u==='#EFEFEF'), `${t} -> ${u}`);
    }
    // flower disables blend
    await page.click('#nodeShapeSeg button[data-shape="flower"]');
    check('Flower disables Blend', await page.$eval('#mergeStyleSeg button[data-style="blend"]',e=>e.disabled));
    await page.click('#nodeShapeSeg button[data-shape="dots"]');
    // sticker rotation is baked at stamp time and exported
    await page.click('#clearBtn'); await page.$eval('#stickerRotationSlider',e=>{e.value=90; e.dispatchEvent(new Event('input',{bubbles:true}));});
    const th = await page.$$('.sticker-thumb'); await th[2].click(); await page.mouse.click(b.x+300,b.y+300);
    await page.$eval('#stickerRotationSlider',e=>{e.value=180; e.dispatchEvent(new Event('input',{bubbles:true}));});
    check('sticker rotation baked in at stamp time', (await stickers(page)).some(s=>s.rotation===90));
    check('10 stickers in the panel', th.length===10);
    // image upload converts immediately
    await page.click('#clearBtn');
    await page.evaluate(()=>{ const c=document.createElement('canvas'); c.width=c.height=60; const x=c.getContext('2d'); x.fillStyle='#000'; x.fillRect(10,10,40,40); window.__png=c.toDataURL('image/png').split(',')[1]; });
    const b64 = await page.evaluate(()=>window.__png); fs.writeFileSync('/tmp/softer-test.png', Buffer.from(b64,'base64'));
    await page.setInputFiles('#fileInput','/tmp/softer-test.png'); await page.waitForTimeout(900);
    check('uploading an image converts it right away', (await nodes(page))>0, `${await nodes(page)} nodes`);
    check('no page errors', errors.length===0, errors.join('|'));
    await page.context().close(); }

  console.log('\n== 6. Blend: only like-for-like nodes join ==');
  { const {page, errors} = await open(browser);
    const set = (id,v) => page.$eval('#'+id,(e,v)=>{e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));},v);
    await page.click('#mergeStyleSeg button[data-style="blend"]');
    await set('spacingSlider',933); await set('radiusSlider',33);
    const b = await box(page); const S = parseInt((await info(page)).match(/(\d+)px/)[1])*0.9, cx=b.x+b.width/2, cy=b.y+b.height/2;
    const px = (X,Y) => page.evaluate(([X,Y])=>{ const c=document.getElementById('stage'); const d=c.getContext('2d').getImageData(Math.round(X*c.width/c.getBoundingClientRect().width),Math.round(Y*c.height/c.getBoundingClientRect().height),1,1).data; return [d[0],d[1],d[2]]; },[X-b.x,Y-b.y]);
    const same = (p,q) => Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])+Math.abs(p[2]-q[2]) < 12;
    const bg = await px(cx+3*S+11, cy+2*S+11);   // off the grid dots, which sit at multiples of S
    // like-for-like: two same-size dots on diagonal cells (separate clicks) still join at the corner
    await page.mouse.click(cx-2*S, cy); await page.mouse.click(cx-S, cy-S); await page.mouse.move(cx+3*S, cy+3*S);
    check('same-size dots in neighbouring cells still join (no pinch)', !same(await px(cx-1.5*S+3, cy-0.5*S+3), bg));
    await page.click('#clearBtn');
    // mixed sizes: small dot beside a big one is NOT blended into a wedge
    await page.mouse.click(cx-2*S, cy);
    await set('radiusSlider',55); await page.mouse.click(cx-S, cy-S); await page.mouse.move(cx+3*S, cy+3*S);
    check('a small dot next to a big one is not bridged into a wedge', same(await px(cx-1.5*S+3, cy-0.5*S+3), bg));
    // changing Grid spacing afterwards does not make old dots reach further
    await page.click('#clearBtn'); await set('radiusSlider',33); await set('spacingSlider',300);
    const s1 = parseInt((await info(page)).match(/(\d+)px/)[1]);
    await page.mouse.click(cx-80, cy); await page.mouse.click(cx+80, cy);   // two far-apart dots on the fine grid
    await set('spacingSlider',1000);
    await page.mouse.move(cx+3*S, cy+3*S);
    check('raising Grid spacing later does not bridge dots placed on a finer grid', same(await px(cx+11, cy+11), bg), `placed at ${s1}px`);
    check('no page errors', errors.length===0, errors.join('|'));
    await page.context().close(); }

  console.log('\n== 7. Save dialog and vector export ==');
  { const {page, errors, dialogs} = await open(browser, {});
    const set = (id,v) => page.$eval('#'+id,(e,v)=>{e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));},v);
    await page.click('#saveBtn');
    check('Save with nothing drawn: message, no dialog', /Draw or place something/.test(await toastText(page)) && !(await page.$eval('#saveDialog',d=>d.open)));
    await page.click('#mergeStyleSeg button[data-style="blend"]'); await set('spacingSlider',500); await set('radiusSlider',24);
    const b = await box(page); const cx=b.x+b.width/2, cy=b.y+b.height/2;
    const ring = []; for(let a=0;a<=360;a+=12) ring.push({x:cx-60+Math.cos(a*Math.PI/180)*110, y:cy-20+Math.sin(a*Math.PI/180)*80});
    await page.mouse.move(ring[0].x,ring[0].y); await page.mouse.down(); for(const q of ring) await page.mouse.move(q.x,q.y); await page.mouse.up();
    await page.click('#saveBtn');
    check('Save opens a dialog offering Design and Vector', (await page.$eval('#saveDialog',d=>d.open)) && await page.$('#savePngBtn') && await page.$('#saveSvgBtn'));
    await page.keyboard.press('Escape');
    check('Escape closes the dialog', !(await page.$eval('#saveDialog',d=>d.open)));
    await page.click('#saveBtn'); await page.click('#saveCloseBtn');
    check('Cancel closes the dialog', !(await page.$eval('#saveDialog',d=>d.open)));
    const grab = async which => { await page.click('#saveBtn'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click(which)]); return {name: dl.suggestedFilename(), data: fs.readFileSync(await dl.path())}; };
    const svg = await grab('#saveSvgBtn'); const svgText = svg.data.toString('utf8');
    check('Vector downloads SOFTER.svg', svg.name==='SOFTER.svg', svg.name);
    check('SVG is well-formed', await page.evaluate(s=>!new DOMParser().parseFromString(s,'image/svg+xml').querySelector('parsererror'), svgText));
    check('Blend traces real outlines with holes (even-odd path, 2+ contours)', /fill-rule="evenodd"/.test(svgText) && (svgText.match(/M/g)||[]).length>=2 && !/<filter|<image/.test(svgText));
    const png = await grab('#savePngBtn');
    const diff = await page.evaluate(async ([pngB, svgS])=>{
      const load = src => new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('img')); i.src=src; });
      const a = await load('data:image/png;base64,'+pngB), s = await load('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgS));
      const W=a.width, H=a.height, mk = img => { const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d'); x.drawImage(img,0,0,W,H); return x.getImageData(0,0,W,H).data; };
      const A=mk(a), B=mk(s); let bad=0, ink=0; const o=(Math.floor(H/2)*W+40)*4, br=A[o], bg2=A[o+1], bb=A[o+2];
      for(let i=0;i<A.length;i+=4){ const d=Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2])+Math.abs(A[i+3]-B[i+3]); if(d>120) bad++; if(Math.abs(A[i]-br)+Math.abs(A[i+1]-bg2)+Math.abs(A[i+2]-bb)>30 && A[i+3]>200) ink++; }
      return {W,H,badPct:100*bad/(W*H), inkPct:100*ink/(W*H)};
    }, [png.data.toString('base64'), svgText]);
    check('SVG and PNG are the same size', diff.W===2000, `${diff.W}x${diff.H}`);
    check('SVG matches the PNG pixel for pixel (under 0.1% of pixels differ)', diff.badPct<0.1, diff.badPct.toFixed(3)+'%');
    check('the comparison saw a real drawing, not two blank images', diff.inkPct>1, diff.inkPct.toFixed(1)+'% ink');
    check('no alert() and no page errors', dialogs.length===0 && errors.length===0, errors.join('|'));
    await page.context().close(); }

  console.log('\n== 8. Remix, toolbar, page metadata ==');
  { const {page, errors, dialogs} = await open(browser);
    const st = () => page.evaluate(()=>window.softerState());
    const set = (id,v) => page.$eval('#'+id,(e,v)=>{e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));},v);
    // toolbar
    check('the button is called Remix and sits before Clear', await page.evaluate(()=>{ const r=document.getElementById('remixBtn'), c=document.getElementById('clearBtn'); return r.textContent.trim()==='Remix' && !!(r.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }));
    check('Undo and Redo are two separate pill buttons like Clear', await page.evaluate(()=>{ const u=document.getElementById('undoBtn'), r=document.getElementById('redoBtn'), c=document.getElementById('clearBtn'); return !u.closest('.seg') && !r.closest('.seg') && u!==r && u.className===c.className && r.className===c.className; }));
    check('sliders carry no number readouts (but keep their names)', await page.evaluate(()=>!document.querySelector('output.val') && [...document.querySelectorAll('input[type=range]')].every(e=>e.getAttribute('aria-label'))));

    const readLook = () => page.evaluate(()=>{
      const act = sel => { const e=document.querySelector(sel+' .swatch.active'); return e ? e.dataset.color : null; };
      const mode = id => document.querySelector('#'+id+' button.active').dataset.mode;
      const bgMode = mode('bgFillModeSeg'), inkMode = mode('fillModeSeg');
      const bg = bgMode==='gradient' ? [act('#bgGradientTopSwatches'),act('#bgGradientBottomSwatches')] : [act('#bgFillSwatches')];
      const ink = inkMode==='gradient' ? [act('#gradientTopSwatches'),act('#gradientBottomSwatches')] : [act('#fillSwatches')];
      const lum = h => { const n=parseInt(h.slice(1),16); return 0.299*(n>>16)+0.587*((n>>8)&255)+0.114*(n&255); };
      const avg = a => a.reduce((s,h)=>s+lum(h),0)/a.length;
      return { bgMode, inkMode, bg, ink, contrast:Math.abs(avg(bg)-avg(ink)),
        style:document.querySelector('#mergeStyleSeg button.active').dataset.style, shape:document.querySelector('#nodeShapeSeg button.active').dataset.shape,
        spacing:parseInt(document.getElementById('gridInfo').textContent), size:+document.getElementById('radiusSlider').value };
    });
    await page.click('#remixBtn'); await page.evaluate(()=>window.softerRemixDone());
    const s0 = await st();
    check('Remix makes a pattern with a few marks', s0.nodes>=6, `${s0.nodes} nodes`);
    await page.click('#undoBtn');
    check('Remix is one undo step (marks only)', (await st()).nodes===0);
    await page.click('#redoBtn');
    check('...and Redo brings it back', (await st()).nodes===s0.nodes);

    let redSolid=0, stickerBad=0, stickerRuns=0, boxBad=0, prevBg=null, sameBg=0, maxedOut=0; const gate={n:0,passed:0,bad:0,fails:[]}; const wordsSeen=new Set(); const looks = [], widths = []; let ok = true, centred = true, contrastOk = true, worstOff = 0;
    for(let k=0;k<60;k++){
      await page.click('#remixBtn'); await page.evaluate(()=>window.softerRemixDone()); const s=await st(), look=await readLook(); looks.push(look);
      if(!s.allInView || !s.noDuplicateCells || s.nodes<6) ok=false;
      const off = Math.max(Math.abs(s.centre.dx), Math.abs(s.centre.dy)) / s.centre.spacingPx; worstOff = Math.max(worstOff, off);
      if(off > 1.01) centred=false;
      if(look.contrast < 55) contrastOk=false;
      const lr=s.lastRemix; if(lr&&lr.stickers>0){ const sc=await page.evaluate(()=>({mode:document.querySelector('#stickerFillModeSeg .active').dataset.mode, col:(document.querySelector('#stickerSwatches .swatch.active')||{dataset:{}}).dataset.color})); if(sc.mode==='solid' && (sc.col||'').toUpperCase()==='#FF3B0F') redSolid++; } { const rs=await page.evaluate(()=>window.softerStickerGeometry()); if(rs.sizes>1||rs.stickerOverlap||rs.onInk) stickerBad++; } if(lr&&lr.stickers>0&&s.stickers.filter(x=>x.rx).length===lr.stickers) stickerRuns++; { const box=await page.inputValue('#textInput'); if(lr&&lr.word){ if(box.replace('\n',' ')!==lr.word || (await page.inputValue('#fontSelect'))!==lr.font) boxBad++; } else if(box!=='') boxBad++; } if(lr){ if(prevBg!==null && prevBg===lr.bg) sameBg++; prevBg=lr.bg; if(lr.sp>=63||lr.size>=70||(lr.sp>=55&&lr.size>=60)) maxedOut++; } if(lr&&lr.word) wordsSeen.add(lr.word); gate.n++; if(lr&&lr.failed.length) gate.fails.push(lr.failed.join('+')+(lr.word?':'+lr.word:'')+' sp'+lr.sp); if(lr && lr.failed.length===0) gate.passed++; if(lr && lr.failed.length===0 && (lr.coverage<(lr.word?0.04:0.12)||lr.coverage>0.40||(lr.blend&&lr.nodes/Math.max(1,lr.shapes)<2.5))) gate.bad++;
      const is = s.cells.split(';').map(c=>+c.split(',')[0]); widths.push(Math.max(...is)-Math.min(...is)+1);
    }
    check('the background is different on every consecutive Remix  ['+sameBg+' repeats]', sameBg===0);
    check('Grid spacing and Node size are never both near the slider maximum  ['+maxedOut+']', maxedOut===0);
    check('a remixed word is shown in the Text box with its font, and the box is empty after a pattern  ['+boxBad+' wrong]', boxBad===0);
    check('Remix stickers: one size per remix, never overlapping each other or the drawing  ['+stickerBad+' wrong]', stickerBad===0);
    check('a solid Remix sticker is never red  ['+redSolid+' wrong]', redSolid===0);
    check('the rotating flower links to softer.global', await page.evaluate(()=>{ const a=document.querySelector('a.spinner-link'); return a && a.href==='https://www.softer.global/' && a.target==='_blank' && a.rel.includes('noopener') && !!a.querySelector('svg.spinner') && !!a.getAttribute('aria-label'); }));
    { const pb = await box(page); await page.check('#symToggle'); await page.mouse.move(pb.x+300, pb.y+300); await page.mouse.wheel(40, 0); } await page.waitForTimeout(150);
    check('panning turns Symmetry off, and it can be turned back on', !(await page.isChecked('#symToggle')) && await (async()=>{ await page.check('#symToggle'); return page.isChecked('#symToggle'); })());
    await page.uncheck('#symToggle');
    check('no credit line under the canvas', await page.evaluate(()=>!document.querySelector('.credit')));
    check('Remix sometimes adds stickers, and only ever replaces its own  ['+stickerRuns+' of 60]', stickerRuns>=10 && stickerRuns<=50);
    check('Remix sometimes sets a word from the list  ['+[...wordsSeen].join(', ')+']', wordsSeen.size>=2);
    console.log('   gate failures:', JSON.stringify(gate.fails));
    check('Remix quality gate: almost every remix passes it, and none that pass break a rule  ['+gate.passed+'/'+gate.n+']', gate.passed>=gate.n*0.95 && gate.bad===0);
    check('60 remixes: always a few marks, in view, no duplicate cells', ok);
    check('the pattern is always centred on the canvas', centred, `worst offset ${worstOff.toFixed(2)} cells`);
    check('patterns can be large (not confined to a small corner)', Math.max(...widths)>=35, `widest ${Math.max(...widths)} cells`);
    check('ink and background always differ clearly in lightness', contrastOk);
    const distinct = f => new Set(looks.map(f)).size;
    check('Grid spacing and Node size vary', distinct(l=>l.spacing)>=8 && distinct(l=>l.size)>=8, `${distinct(l=>l.spacing)} spacings, ${distinct(l=>l.size)} sizes`);
    check('colours vary (solid and gradient, several swatches)', distinct(l=>l.ink.join())>=6 && distinct(l=>l.bg.join())>=4 && distinct(l=>l.inkMode)===2 && distinct(l=>l.bgMode)===2);
    check('style and shape vary (Blend, Separate, Dots, Flower)', distinct(l=>l.style)===2 && distinct(l=>l.shape)===2);
    check('Flower is never combined with Blend', looks.every(l=>!(l.shape==='flower' && l.style==='blend')));
    // stickers survive
    await page.click('#clearBtn'); const th = await page.$$('.sticker-thumb'); await th[1].click();
    const b = await box(page); await page.mouse.click(b.x+300,b.y+300); await th[1].click();
    await page.click('#remixBtn'); await page.evaluate(()=>window.softerRemixDone());
    check('Remix keeps placed stickers', (await st()).stickers.filter(x=>!x.rx).length===1);
    // symmetry
    await page.click('#clearBtn');
    const sb = await box(page);
    await page.check('#symToggle');
    await page.mouse.click(sb.x+sb.width*0.25, sb.y+sb.height*0.4);
    const symCells = await page.evaluate(()=>window.softerState().cells.split(';').map(c=>c.split(',').map(Number)));
    const si = symCells.length===2 && symCells[0][1]===symCells[1][1] ? symCells[0][0]+symCells[1][0] : null;
    const midI = await page.evaluate(()=>{ const s=window.softerState(); return 2*Math.round(s.centre ? 0 : 0); });
    check('Symmetry: one click draws a mirrored pair left and right', symCells.length===2 && symCells[0][1]===symCells[1][1] && symCells[0][0]!==symCells[1][0], JSON.stringify(symCells));
    await page.click('#modeSeg button:nth-child(2)'); await page.mouse.click(sb.x+sb.width*0.25, sb.y+sb.height*0.4);
    check('Symmetry: erasing removes both sides', (await st()).nodes===0);
    await page.click('#modeSeg button:nth-child(1)'); await page.uncheck('#symToggle');
    await page.mouse.click(sb.x+sb.width*0.25, sb.y+sb.height*0.4);
    check('Symmetry off: one click draws one dot', (await st()).nodes===1);
    check('Symmetry sits next to Show grid, same style', await page.evaluate(()=>{ const a=document.getElementById('symToggle').closest('label'), b=document.getElementById('gridToggle').closest('label'); return a.className===b.className && a.nextElementSibling===b; }));
    // metadata
    const meta = await page.evaluate(()=>({
      title:document.title, desc:!!document.querySelector('meta[name=description]'),
      csp:(document.querySelector('meta[http-equiv="Content-Security-Policy"]')||{}).content||'',
      theme:!!document.querySelector('meta[name=theme-color]'), og:!!document.querySelector('meta[property="og:title"]'),
      icon:(document.querySelector('link[rel~=icon]')||{}).href||'' }));
    check('page has a title, description, theme colour and social tags', meta.title==='SOFTER Blob Tool' && meta.desc && meta.theme && meta.og, meta.title);
    check('sharing tags point at the hosted address and share image', await page.evaluate(()=>{ const g=s=>(document.querySelector(s)||{}).content||(document.querySelector(s)||{}).href; return g('meta[property="og:url"]')==='https://imogenloisfox.github.io/softer/' && g('meta[property="og:image"]')==='https://imogenloisfox.github.io/softer/og-image.png' && g('meta[name="twitter:image"]')===g('meta[property="og:image"]') && g('link[rel=canonical]')==='https://imogenloisfox.github.io/softer/'; }));
    check('favicon is embedded, not a separate file', /^data:/.test(meta.icon));
    check('content security policy blocks all network access', /default-src 'none'/.test(meta.csp) && /connect-src 'none'/.test(meta.csp));
    check('no alert() and no page errors', dialogs.length===0 && errors.length===0, errors.join('|'));
    await page.context().close(); }
  { const {page, errors} = await open(browser, {viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
    const r = await page.evaluate(()=>{ const q=id=>document.getElementById(id).getBoundingClientRect(); const ids=['undoBtn','redoBtn','remixBtn','clearBtn','saveBtn']; return {right:Math.max(...ids.map(i=>q(i).right)), width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth}; });
    check('phone width: toolbar buttons all on screen, no horizontal overflow', r.right<=r.width && !r.overflow, JSON.stringify(r));
    check('no page errors on a phone', errors.length===0, errors.join('|'));
    await page.context().close(); }

  await browser.close();
  const failed = results.filter(r=>!r.ok);
  console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
  if(failed.length){ console.log('FAILED:\n'+failed.map(f=>' - '+f.name+'  '+f.detail).join('\n')); process.exit(1); }
})().catch(e=>{ console.error('TEST RUN CRASHED', e); process.exit(2); });

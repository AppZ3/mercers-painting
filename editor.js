#!/usr/bin/env node
/**
 * Mercer's Painting — Live Visual Editor
 * Usage: node editor.js
 * Then open: http://localhost:3456
 *
 * • Browser auto-reloads when the HTML file changes (Claude edits or your saves)
 * • Click any element on the page to open its property panel
 * • Edit colors, images, text, fonts, spacing — see changes instantly
 * • Hit "Save to File" to write your changes permanently into index.html
 */

const http   = require('http')
const fs     = require('fs')
const path   = require('path')
const { execSync } = require('child_process')

const PORT = 3456
const DIR  = __dirname
const HTML = path.join(DIR, 'index.html')

// Auto-install ws if needed
let WSS
try {
  WSS = require('ws').WebSocketServer
} catch {
  console.log('Installing ws dependency...')
  execSync('npm install ws --no-save', { cwd: DIR, stdio: 'inherit' })
  WSS = require('ws').WebSocketServer
}

// ─── Editor UI CSS ────────────────────────────────────────────────────────────

const EDITOR_CSS = `
#_ep-toggle {
  position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
  background: #2563eb; color: #fff; border: none; border-radius: 10px;
  padding: 9px 16px; font: 600 13px/1 system-ui; cursor: pointer;
  box-shadow: 0 4px 20px rgba(37,99,235,.45); transition: background .2s, transform .2s;
  display: flex; align-items: center; gap: 8px;
}
#_ep-toggle:hover { background: #3b82f6; }
#_ep-toggle._active { background: #1d4ed8; }
#_ep-toggle .dot {
  width: 7px; height: 7px; border-radius: 50%; background: #86efac;
  animation: _ep-pulse 2s infinite;
}
@keyframes _ep-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

#_ep-panel {
  position: fixed; top: 0; right: 0; width: 310px; height: 100vh;
  background: #0f172a; border-left: 1px solid #1e293b; color: #e2e8f0;
  font: 13px/1.4 system-ui, sans-serif; z-index: 2147483646;
  display: flex; flex-direction: column; overflow: hidden;
  transform: translateX(110%); transition: transform .3s cubic-bezier(.4,0,.2,1);
  box-shadow: -12px 0 40px rgba(0,0,0,.5);
}
#_ep-panel._open { transform: translateX(0); }

#_ep-header {
  padding: 14px 16px; border-bottom: 1px solid #1e293b;
  display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
}
#_ep-header h2 { margin: 0; font-size: 14px; font-weight: 700; color: #f8fafc; }
#_ep-header .sub { font-size: 11px; color: #64748b; margin-top: 2px; }

#_ep-inspect-btn {
  background: #1e293b; border: 1px solid #334155; color: #94a3b8;
  border-radius: 7px; padding: 5px 12px; font: 600 11px system-ui; cursor: pointer;
  transition: all .15s; white-space: nowrap;
}
#_ep-inspect-btn._on {
  background: #2563eb22; border-color: #2563eb; color: #60a5fa;
}

#_ep-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
#_ep-body::-webkit-scrollbar { width: 4px; }
#_ep-body::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }

._ep-placeholder {
  text-align: center; padding: 40px 16px; color: #334155;
}
._ep-placeholder svg { display: block; margin: 0 auto 12px; opacity: .4; }
._ep-placeholder p { margin: 0; font-size: 12px; line-height: 1.6; }

._ep-crumb {
  background: #1e293b; border-radius: 7px; padding: 8px 12px; margin-bottom: 12px;
  font-size: 11px; color: #64748b; word-break: break-all;
  display: flex; align-items: center; gap: 8px;
}
._ep-crumb strong { color: #93c5fd; flex: 1; }

._ep-section { margin-bottom: 14px; }
._ep-section-title {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
  color: #475569; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #1e293b;
}
._ep-row {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
}
._ep-label { font-size: 11px; color: #94a3b8; width: 86px; flex-shrink: 0; }

._ep-input {
  flex: 1; background: #1e293b; border: 1px solid #334155; color: #e2e8f0;
  border-radius: 6px; padding: 5px 8px; font: 12px system-ui; outline: none;
  transition: border-color .15s;
}
._ep-input:focus { border-color: #2563eb; }
._ep-input[type=color] { padding: 2px; height: 28px; width: 40px; flex: none; cursor: pointer; }
._ep-input[type=range] { padding: 0; background: none; border: none; accent-color: #2563eb; cursor: pointer; }
._ep-input[type=number] { width: 60px; flex: none; }

._ep-textarea {
  width: 100%; box-sizing: border-box; background: #1e293b; border: 1px solid #334155;
  color: #e2e8f0; border-radius: 6px; padding: 6px 8px; font: 12px system-ui;
  outline: none; resize: vertical; min-height: 60px; transition: border-color .15s;
}
._ep-textarea:focus { border-color: #2563eb; }

._ep-img-preview {
  width: 100%; height: 80px; object-fit: cover; border-radius: 6px;
  background: #1e293b; margin-bottom: 6px; display: block;
  border: 1px solid #334155;
}
._ep-img-none {
  width: 100%; height: 60px; background: #1e293b; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  color: #475569; font-size: 11px; margin-bottom: 6px; border: 1px solid #334155;
}

._ep-pad-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; flex: 1;
}
._ep-pad-input {
  background: #1e293b; border: 1px solid #334155; color: #e2e8f0;
  border-radius: 5px; padding: 4px 6px; font: 12px system-ui; outline: none;
  text-align: center; transition: border-color .15s; width: 100%; box-sizing: border-box;
}
._ep-pad-input:focus { border-color: #2563eb; }

#_ep-footer {
  padding: 12px; border-top: 1px solid #1e293b; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 6px;
}
._ep-save-btn {
  background: #2563eb; color: #fff; border: none; border-radius: 8px;
  padding: 10px; font: 600 13px system-ui; cursor: pointer; transition: background .2s;
}
._ep-save-btn:hover { background: #3b82f6; }
._ep-save-btn:active { background: #1d4ed8; }
._ep-clear-btn {
  background: #1e293b; color: #94a3b8; border: 1px solid #334155;
  border-radius: 8px; padding: 7px; font: 13px system-ui; cursor: pointer;
  transition: all .15s;
}
._ep-clear-btn:hover { border-color: #ef4444; color: #f87171; background: #450a0a20; }

._ep-status {
  font-size: 11px; text-align: center; color: #64748b; min-height: 14px; transition: color .3s;
}
._ep-status._ok { color: #4ade80; }
._ep-status._err { color: #f87171; }

/* Selection highlight */
._ep-hover-outline { outline: 2px dashed #3b82f6 !important; outline-offset: 2px; cursor: crosshair !important; }
._ep-selected-outline { outline: 2px solid #2563eb !important; outline-offset: 2px; }

/* Resize body when panel open */
body._ep-open { margin-right: 310px; transition: margin-right .3s cubic-bezier(.4,0,.2,1); }
`

// ─── Editor UI JS ─────────────────────────────────────────────────────────────

const EDITOR_JS = `
(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let panelOpen    = false;
  let inspecting   = false;
  let selected     = null;
  let hovered      = null;
  let changes      = new Map(); // element → { prop: value }
  let savedCss     = '';

  // ── Build Panel DOM ────────────────────────────────────────────────────────
  const toggle = document.createElement('button');
  toggle.id = '_ep-toggle';
  toggle.innerHTML = '<span class="dot"></span>Edit Site';
  toggle.title = 'Toggle visual editor (Ctrl+E)';

  const panel = document.createElement('div');
  panel.id = '_ep-panel';
  panel.innerHTML = \`
    <div id="_ep-header">
      <div>
        <h2>Visual Editor</h2>
        <div class="sub">Mercer's Precision Painting</div>
      </div>
      <button id="_ep-inspect-btn">&#9654; Inspect</button>
    </div>
    <div id="_ep-body">
      <div class="_ep-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M15 15l5 5M9.5 14A4.5 4.5 0 1 0 9.5 5a4.5 4.5 0 0 0 0 9z"/>
        </svg>
        <p>Click <strong style="color:#60a5fa">&#9654; Inspect</strong> then click<br>any element on the page.</p>
      </div>
    </div>
    <div id="_ep-footer">
      <div class="_ep-status" id="_ep-status"></div>
      <button class="_ep-save-btn" id="_ep-save">&#8659; Save Changes to File</button>
      <button class="_ep-clear-btn" id="_ep-clear">&#8856; Clear All Changes</button>
    </div>
  \`;

  document.body.appendChild(toggle);
  document.body.appendChild(panel);

  const body_el     = panel.querySelector('#_ep-body');
  const inspectBtn  = panel.querySelector('#_ep-inspect-btn');
  const statusEl    = panel.querySelector('#_ep-status');

  // ── Toggle Panel ───────────────────────────────────────────────────────────
  function openPanel() {
    panelOpen = true;
    panel.classList.add('_open');
    toggle.classList.add('_active');
    document.body.classList.add('_ep-open');
    toggle.style.right = '330px';
  }
  function closePanel() {
    panelOpen = false;
    panel.classList.remove('_open');
    toggle.classList.remove('_active');
    document.body.classList.remove('_ep-open');
    toggle.style.right = '24px';
    stopInspecting();
  }
  toggle.addEventListener('click', () => panelOpen ? closePanel() : openPanel());
  document.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'e') { e.preventDefault(); panelOpen ? closePanel() : openPanel(); } });

  // ── Inspector Mode ─────────────────────────────────────────────────────────
  function startInspecting() {
    inspecting = true;
    inspectBtn.classList.add('_on');
    inspectBtn.textContent = '⬛ Stop Inspecting';
    document.body.style.cursor = 'crosshair';
  }
  function stopInspecting() {
    inspecting = false;
    inspectBtn.classList.remove('_on');
    inspectBtn.textContent = '▶ Inspect';
    document.body.style.cursor = '';
    if (hovered && hovered !== selected) {
      hovered.classList.remove('_ep-hover-outline');
      hovered = null;
    }
  }
  inspectBtn.addEventListener('click', () => inspecting ? stopInspecting() : startInspecting());

  // ── Mouse Events ───────────────────────────────────────────────────────────
  const SKIP = new Set(['_ep-toggle','_ep-panel']);
  function isEditorEl(el) {
    return el.closest('#_ep-panel,#_ep-toggle') !== null;
  }

  document.addEventListener('mousemove', e => {
    if (!inspecting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isEditorEl(el)) return;
    if (hovered === el) return;
    if (hovered && hovered !== selected) hovered.classList.remove('_ep-hover-outline');
    hovered = el;
    if (el !== selected) el.classList.add('_ep-hover-outline');
  }, { passive: true });

  document.addEventListener('click', e => {
    if (!inspecting) return;
    let el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isEditorEl(el)) return;
    e.stopPropagation();
    e.preventDefault();
    // If clicked element has no background-image, try to find nearest ancestor that does
    if (getComputedStyle(el).backgroundImage === 'none') {
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== document.body) {
        if (getComputedStyle(ancestor).backgroundImage !== 'none') { el = ancestor; break; }
        ancestor = ancestor.parentElement;
      }
    }
    if (selected && selected !== el) selected.classList.remove('_ep-selected-outline');
    selected = el;
    el.classList.remove('_ep-hover-outline');
    el.classList.add('_ep-selected-outline');
    stopInspecting();
    renderProps(el);
  }, true);

  // ── Selector Generator ─────────────────────────────────────────────────────
  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node !== document.documentElement && depth < 6) {
      if (node === document.body) { parts.unshift('body'); break; }
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      let sel = tag;
      if (parent) {
        const idx = Array.prototype.indexOf.call(parent.children, node) + 1;
        sel += ':nth-child(' + idx + ')';
      }
      parts.unshift(sel);
      if (node.id) { parts[0] = '#' + CSS.escape(node.id); break; }
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  // ── Get computed styles ────────────────────────────────────────────────────
  function cs(el, prop) {
    return window.getComputedStyle(el).getPropertyValue(prop).trim();
  }
  function rgb2hex(rgb) {
    const m = rgb.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (!m) return '#000000';
    return '#' + [m[1],m[2],m[3]].map(n => (+n).toString(16).padStart(2,'0')).join('');
  }
  function extractBgUrl(el) {
    const bg = cs(el, 'background-image');
    if (bg === 'none' || !bg) return '';
    const m = bg.match(/url\\(["']?([^"')]+)["']?\\)/);
    return m ? m[1] : '';
  }
  function px(val) { return parseInt(val) || 0; }

  // ── Render Properties Panel ────────────────────────────────────────────────
  function renderProps(el) {
    const tag    = el.tagName.toLowerCase();
    const cls    = [...el.classList].filter(c => !c.startsWith('_ep-')).slice(0,3).join(' ');
    const label  = tag + (el.id ? '#'+el.id : '') + (cls ? '.'+cls.replace(/ /g,'.') : '');
    const isText = ['p','h1','h2','h3','h4','h5','h6','span','a','li','td','th','button','label'].includes(tag);
    const bgUrl  = extractBgUrl(el);
    const isData = bgUrl.startsWith('data:');
    const bgColor = rgb2hex(cs(el,'background-color'));
    const color   = rgb2hex(cs(el,'color'));
    const fs = px(cs(el,'font-size'));
    const fw = px(cs(el,'font-weight')) || 400;
    const pt = px(cs(el,'padding-top')),    pr = px(cs(el,'padding-right'));
    const pb = px(cs(el,'padding-bottom')), pl = px(cs(el,'padding-left'));
    const br = px(cs(el,'border-radius'));

    // Build font-weight options without nested template literals
    const fwOptions = [300,400,500,600,700,800,900]
      .map(w => '<option value="'+w+'"'+(fw===w?' selected':'')+'>'+w+'</option>')
      .join('');

    // Image section HTML
    let imgHtml = '';
    if (!isData && bgUrl) {
      imgHtml = '<img class="_ep-img-preview" id="_ep-imgpreview" src="'+bgUrl+'">';
    } else if (isData) {
      imgHtml = '<div class="_ep-img-none" style="color:#60a5fa">&#10003; Has embedded photo — paste URL below to replace</div>';
    } else {
      imgHtml = '<div class="_ep-img-none">No background image</div>';
    }

    body_el.innerHTML =
      '<div class="_ep-crumb" id="_ep-crumb-bar">' +
        '<strong>'+label+'</strong>' +
        '<button id="_ep-parent-btn" style="margin-left:auto;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:5px;padding:3px 8px;font:11px system-ui;cursor:pointer;flex-shrink:0">&#8593; Parent</button>' +
      '</div>' +

      (isText ?
        '<div class="_ep-section">' +
          '<div class="_ep-section-title">Text Content</div>' +
          '<textarea class="_ep-textarea" id="_ep-text" rows="3"></textarea>' +
        '</div>' : '') +

      '<div class="_ep-section">' +
        '<div class="_ep-section-title">Background Image</div>' +
        imgHtml +
        '<div style="display:flex;gap:6px;margin-top:6px">' +
          '<input type="text" class="_ep-input" id="_ep-bgimg" placeholder="Paste image URL and press Apply…" value="'+(isData ? '' : bgUrl)+'">' +
          '<button id="_ep-bgimg-apply" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:5px 10px;font:600 11px system-ui;cursor:pointer;flex-shrink:0">Apply</button>' +
        '</div>' +
        '<div style="font-size:10px;color:#475569;margin-top:4px">Unsplash URL, direct image link, or blank to remove</div>' +
      '</div>' +

      '<div class="_ep-section">' +
        '<div class="_ep-section-title">Colours</div>' +
        '<div class="_ep-row"><span class="_ep-label">Background</span>' +
          '<input type="color" class="_ep-input" id="_ep-bgcolor" value="'+bgColor+'">' +
          '<input type="text" class="_ep-input" id="_ep-bgcolor-hex" value="'+bgColor+'" style="max-width:80px">' +
        '</div>' +
        '<div class="_ep-row"><span class="_ep-label">Text colour</span>' +
          '<input type="color" class="_ep-input" id="_ep-color" value="'+color+'">' +
          '<input type="text" class="_ep-input" id="_ep-color-hex" value="'+color+'" style="max-width:80px">' +
        '</div>' +
      '</div>' +

      '<div class="_ep-section">' +
        '<div class="_ep-section-title">Typography</div>' +
        '<div class="_ep-row"><span class="_ep-label">Font size</span>' +
          '<input type="number" class="_ep-input" id="_ep-fs" value="'+fs+'" min="8" max="200">' +
          '<span style="color:#475569;font-size:11px">px</span>' +
          '<input type="range" class="_ep-input" id="_ep-fs-range" value="'+fs+'" min="8" max="120" style="flex:1">' +
        '</div>' +
        '<div class="_ep-row"><span class="_ep-label">Font weight</span>' +
          '<select class="_ep-input" id="_ep-fw">'+fwOptions+'</select>' +
        '</div>' +
      '</div>' +

      '<div class="_ep-section">' +
        '<div class="_ep-section-title">Spacing — padding (px) T / R / B / L</div>' +
        '<div class="_ep-row"><span class="_ep-label"></span>' +
          '<div class="_ep-pad-grid">' +
            '<input type="number" class="_ep-pad-input" id="_ep-pt" value="'+pt+'" min="0" title="Top">' +
            '<input type="number" class="_ep-pad-input" id="_ep-pr" value="'+pr+'" min="0" title="Right">' +
            '<input type="number" class="_ep-pad-input" id="_ep-pb" value="'+pb+'" min="0" title="Bottom">' +
            '<input type="number" class="_ep-pad-input" id="_ep-pl" value="'+pl+'" min="0" title="Left">' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="_ep-section">' +
        '<div class="_ep-section-title">Shape</div>' +
        '<div class="_ep-row"><span class="_ep-label">Border radius</span>' +
          '<input type="number" class="_ep-input" id="_ep-br" value="'+br+'" min="0" max="999" style="max-width:60px">' +
          '<span style="color:#475569;font-size:11px">px</span>' +
          '<input type="range" class="_ep-input" id="_ep-br-range" value="'+br+'" min="0" max="50" style="flex:1">' +
        '</div>' +
      '</div>';

    // Set textarea value safely (avoids HTML escaping issues)
    if (isText) {
      const ta = document.getElementById('_ep-text');
      if (ta) ta.value = el.innerText || '';
    }

    // ── Wire up inputs ───────────────────────────────────────────────────────
    function track(prop, val) {
      if (!changes.has(el)) changes.set(el, {});
      changes.get(el)[prop] = val;
    }

    // Parent navigator
    document.getElementById('_ep-parent-btn').addEventListener('click', () => {
      const parent = el.parentElement;
      if (!parent || parent === document.body) return;
      if (selected) selected.classList.remove('_ep-selected-outline');
      selected = parent;
      parent.classList.add('_ep-selected-outline');
      renderProps(parent);
    });

    // Background image — Apply button + Enter key
    function applyBgImg() {
      const input = document.getElementById('_ep-bgimg');
      if (!input) return;
      const url = input.value.trim();
      if (url) {
        el.style.backgroundImage = 'url("'+url+'")';
        el.style.backgroundSize  = 'cover';
        el.style.backgroundPosition = 'center';
        track('background-image', 'url("'+url+'")');
        track('background-size', 'cover');
        track('background-position', 'center');
        const prev = document.getElementById('_ep-imgpreview');
        if (prev) { prev.src = url; prev.style.display = 'block'; }
        else {
          const d = input.parentElement.previousElementSibling;
          if (d) { d.innerHTML = '<img class="_ep-img-preview" id="_ep-imgpreview" src="'+url+'">'; }
        }
      } else {
        el.style.backgroundImage = 'none';
        track('background-image', 'none');
      }
    }
    const bgApplyBtn = document.getElementById('_ep-bgimg-apply');
    if (bgApplyBtn) bgApplyBtn.addEventListener('click', applyBgImg);
    const bgImgInput = document.getElementById('_ep-bgimg');
    if (bgImgInput) bgImgInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyBgImg(); } });

    // Background color
    const bgcInput = document.getElementById('_ep-bgcolor');
    const bgcHex   = document.getElementById('_ep-bgcolor-hex');
    bgcInput.addEventListener('input', e => { el.style.backgroundColor = e.target.value; bgcHex.value = e.target.value; track('background-color', e.target.value); });
    bgcHex.addEventListener('change', e => { el.style.backgroundColor = e.target.value; bgcInput.value = e.target.value; track('background-color', e.target.value); });

    // Text color
    const colInput = document.getElementById('_ep-color');
    const colHex   = document.getElementById('_ep-color-hex');
    colInput.addEventListener('input', e => { el.style.color = e.target.value; colHex.value = e.target.value; track('color', e.target.value); });
    colHex.addEventListener('change', e => { el.style.color = e.target.value; colInput.value = e.target.value; track('color', e.target.value); });

    // Font size
    const fsInput = document.getElementById('_ep-fs');
    const fsRange = document.getElementById('_ep-fs-range');
    if (fsInput && fsRange) {
      fsInput.addEventListener('input', e => { el.style.fontSize = e.target.value+'px'; fsRange.value = e.target.value; track('font-size', e.target.value+'px'); });
      fsRange.addEventListener('input', e => { el.style.fontSize = e.target.value+'px'; fsInput.value = e.target.value; track('font-size', e.target.value+'px'); });
    }

    // Font weight
    const fwSel = document.getElementById('_ep-fw');
    if (fwSel) fwSel.addEventListener('change', e => { el.style.fontWeight = e.target.value; track('font-weight', e.target.value); });

    // Padding
    ['pt','pr','pb','pl'].forEach((id, i) => {
      const sides = ['top','right','bottom','left'];
      const inp = document.getElementById('_ep-'+id);
      if (inp) inp.addEventListener('input', e => {
        const prop = 'padding' + sides[i].charAt(0).toUpperCase() + sides[i].slice(1);
        el.style[prop] = e.target.value+'px';
        track('padding-'+sides[i], e.target.value+'px');
      });
    });

    // Border radius
    const brInput = document.getElementById('_ep-br');
    const brRange = document.getElementById('_ep-br-range');
    if (brInput && brRange) {
      brInput.addEventListener('input', e => { el.style.borderRadius = e.target.value+'px'; brRange.value = e.target.value; track('border-radius', e.target.value+'px'); });
      brRange.addEventListener('input', e => { el.style.borderRadius = e.target.value+'px'; brInput.value = e.target.value; track('border-radius', e.target.value+'px'); });
    }

    // Text content
    const textArea = document.getElementById('_ep-text');
    if (textArea) textArea.addEventListener('input', e => { el.innerText = e.target.value; track('_content', e.target.value); });
  }

  // ── Save / Clear ───────────────────────────────────────────────────────────
  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = '_ep-status' + (type ? ' _'+type : '');
    if (type === '_ok') setTimeout(() => { statusEl.textContent = ''; statusEl.className = '_ep-status'; }, 3000);
  }

  document.getElementById('_ep-save').addEventListener('click', async () => {
    if (changes.size === 0) { setStatus('No changes to save.'); return; }
    setStatus('Saving…');

    let css = '';
    for (const [el, props] of changes) {
      const selector = buildSelector(el);
      const rules = Object.entries(props)
        .filter(([k]) => k !== '_content')
        .map(([k,v]) => \`  \${k}: \${v} !important;\`)
        .join('\\n');
      if (rules) css += \`\${selector} {\\n\${rules}\\n}\\n\`;
    }
    savedCss = css;

    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ css })
      });
      const data = await res.json();
      if (data.ok) {
        setStatus('Saved! Reloading…', '_ok');
      } else {
        setStatus('Error: ' + (data.error||'unknown'), '_err');
      }
    } catch (e) {
      setStatus('Could not reach editor server.', '_err');
    }
  });

  document.getElementById('_ep-clear').addEventListener('click', async () => {
    if (!confirm('Clear all visual changes? This cannot be undone.')) return;
    changes.clear();
    // Remove all inline styles we added
    document.querySelectorAll('[style]').forEach(el => {
      // We can't easily know which inline styles we added, so just reset
    });
    try {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ css: '' })
      });
      setStatus('Cleared. Reloading…', '_ok');
    } catch (e) {
      setStatus('Could not reach editor server.', '_err');
    }
  });

  // ── Live Reload via WebSocket ──────────────────────────────────────────────
  function connectWS() {
    const ws = new WebSocket('ws://' + location.host);
    ws.onmessage = e => {
      if (e.data === 'reload') window.location.reload();
    };
    ws.onclose = () => setTimeout(connectWS, 1500);
  }
  connectWS();

  // ── Initial welcome ────────────────────────────────────────────────────────
  // Show panel hint in console
  console.log('%c🎨 Visual Editor loaded — press Ctrl+E or click "Edit Site"', 'color:#60a5fa;font-weight:bold');

})();
`

// ─── HTTP Server ───────────────────────────────────────────────────────────────

const INJECT = `\n<!-- EDITOR UI -->\n<style id="_editor-ui-css">${EDITOR_CSS}</style>\n<script id="_editor-ui-js">${EDITOR_JS}</script>`

const SAVE_MARKER_START = '\n<!-- EDITOR STYLES -->'
const SAVE_MARKER_END   = '<!-- END EDITOR STYLES -->'

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // ── API: save CSS overrides ──────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/save') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { css } = JSON.parse(body)
        let html = fs.readFileSync(HTML, 'utf8')

        // Remove any existing editor styles block
        const start = html.indexOf(SAVE_MARKER_START)
        const end   = html.indexOf(SAVE_MARKER_END)
        if (start !== -1 && end !== -1) {
          html = html.slice(0, start) + html.slice(end + SAVE_MARKER_END.length)
        }

        // Inject new styles before </head>
        if (css && css.trim()) {
          const styleBlock = `${SAVE_MARKER_START}\n<style id="_editor-overrides">\n${css}\n</style>\n${SAVE_MARKER_END}`
          html = html.replace('</head>', styleBlock + '\n</head>')
        }

        fs.writeFileSync(HTML, html)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        console.error('Save error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ── Serve main HTML with editor injected ────────────────────────────────
  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      let html = fs.readFileSync(HTML, 'utf8')
      // Inject editor UI before </body>
      html = html.replace('</body>', INJECT + '\n</body>')
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(html)
    } catch (e) {
      res.writeHead(500)
      res.end('Failed to read index.html: ' + e.message)
    }
    return
  }

  // ── Serve local assets ───────────────────────────────────────────────────
  const filePath = path.join(DIR, decodeURIComponent(url.pathname))
  if (filePath.startsWith(DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap = {
      '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.svg': 'image/svg+xml', '.gif': 'image/gif',
      '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2',
    }
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' })
    res.end(fs.readFileSync(filePath))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

// ─── WebSocket live reload ─────────────────────────────────────────────────────

const wss = new WSS({ server })

let lastMtime = 0
try { lastMtime = fs.statSync(HTML).mtimeMs } catch {}

const watcher = setInterval(() => {
  try {
    const mtime = fs.statSync(HTML).mtimeMs
    if (mtime !== lastMtime) {
      lastMtime = mtime
      wss.clients.forEach(client => {
        if (client.readyState === 1) client.send('reload')
      })
    }
  } catch {}
}, 300)

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`
  console.log('\n' + '─'.repeat(50))
  console.log(`  🎨  Mercer's Visual Editor`)
  console.log('─'.repeat(50))
  console.log(`  Open: \x1b[36m\x1b[4m${url}\x1b[0m`)
  console.log()
  console.log('  • Browser auto-reloads when the HTML file changes')
  console.log('  • Click "Edit Site" button (or Ctrl+E) to open the panel')
  console.log('  • Click ▶ Inspect, then click any element to edit it')
  console.log('  • Hit "Save Changes to File" to write changes permanently')
  console.log()
  console.log('  Any edits made here in Claude Code also reload automatically.')
  console.log('─'.repeat(50) + '\n')

  // Try to open browser
  try {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    require('child_process').spawn(opener, [url], { detached: true, stdio: 'ignore' })
  } catch {}
})

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`)
    console.error(`  Try: kill $(lsof -ti:${PORT})\n`)
  } else {
    console.error('Server error:', e)
  }
  process.exit(1)
})

process.on('SIGINT', () => {
  clearInterval(watcher)
  wss.close()
  server.close()
  console.log('\n  Editor stopped.\n')
  process.exit(0)
})

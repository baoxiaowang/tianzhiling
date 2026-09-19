import { Config, Provide } from '@midwayjs/core';

export interface AgentVtPageRenderInput {
  token: string;
  agentName?: string;
  title?: string;
}

/**
 * 声音训练 Agent 工作台独立页面（聊天对话式，单页自包含）。
 *
 * 页面只凭 token 访问；页面内 JS 调用受限 API（带 X-Agent-Vt-Secret，若配置）。
 * 无构建链，随 admin-node 一起部署，nginx 反代独立域名即可。
 */
@Provide()
export class AgentVtPageService {
  @Config('agentVt')
  agentVtConfig?: { secret?: string; title?: string };

  render(input: AgentVtPageRenderInput): string {
    const agentName = this.escapeHtml(input.agentName || '未命名');
    const title = this.escapeHtml(input.title || this.agentVtConfig?.title || '声音训练工作台');
    const secret = this.agentVtConfig?.secret?.trim() ?? '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif; background: #f6f7fb; color: #1f2329; }
  .app { max-width: 720px; margin: 0 auto; height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: #fff; }
  .header { padding: 12px 16px; border-bottom: 1px solid #eee; background: #fff; display: flex; align-items: center; gap: 10px; }
  .header .avatar { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg,#7c5cff,#a26cff); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
  .header .meta { flex: 1; min-width: 0; }
  .header .name { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .header .sub { font-size: 12px; color: #999; }
  .chat { flex: 1; overflow-y: auto; padding: 16px 14px; background: #f6f7fb; }
  .msg { display: flex; margin-bottom: 14px; }
  .msg.user { justify-content: flex-end; }
  .msg .bubble { max-width: 78%; padding: 10px 14px; border-radius: 14px; font-size: 15px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .msg.user .bubble { background: #7c5cff; color: #fff; border-top-right-radius: 4px; }
  .msg.assistant .bubble { background: #fff; border: 1px solid #eceef3; border-top-left-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,.03); }
  .msg .attach-tag { display: inline-block; margin-top: 6px; padding: 4px 10px; background: rgba(255,255,255,.18); border-radius: 8px; font-size: 12px; }
  .msg.assistant .attach-tag { background: #f2f3f7; color: #666; }
  .status-card { margin: 0 14px 10px; border: 1px solid #eceef3; border-radius: 12px; background: #fff; padding: 10px 12px; max-height: 200px; overflow-y: auto; }
  .status-card .sc-title { font-size: 13px; color: #666; margin-bottom: 6px; }
  .sc-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #f0f0f0; }
  .sc-item:last-child { border-bottom: none; }
  .sc-item .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot.pending, .dot.training { background: #f59e0b; }
  .dot.active { background: #22c55e; }
  .dot.failed { background: #ef4444; }
  .sc-item .sc-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc-item .sc-status { color: #999; font-size: 12px; }
  .input-bar { border-top: 1px solid #eee; padding: 10px 12px; background: #fff; display: flex; align-items: flex-end; gap: 8px; }
  .attach-preview { display: flex; align-items: center; gap: 6px; padding: 6px 10px; margin: 0 12px; background: #f2f3f7; border-radius: 8px; font-size: 12px; color: #555; }
  .attach-preview .clear { color: #999; cursor: pointer; padding: 0 4px; }
  .input-bar textarea { flex: 1; border: 1px solid #e2e4ea; border-radius: 20px; padding: 10px 14px; font-size: 15px; resize: none; max-height: 100px; outline: none; line-height: 1.4; }
  .input-bar textarea:focus { border-color: #7c5cff; }
  .btn { border: none; border-radius: 20px; padding: 10px 18px; font-size: 14px; cursor: pointer; flex-shrink: 0; }
  .btn.upload { background: #f0eefe; color: #7c5cff; }
  .btn.send { background: #7c5cff; color: #fff; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .toast { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%); background: rgba(0,0,0,.75); color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 13px; z-index: 99; opacity: 0; transition: opacity .25s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .typing { display: inline-flex; gap: 4px; padding: 4px 0; }
  .typing i { width: 6px; height: 6px; border-radius: 50%; background: #b9bcc6; animation: blink 1.2s infinite; }
  .typing i:nth-child(2) { animation-delay: .2s; }
  .typing i:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }
  .empty { text-align: center; color: #bbb; font-size: 13px; padding: 40px 20px; }
  .panel { margin: 0 14px 12px; border: 1px solid #eceef3; border-radius: 12px; background: #fff; overflow: hidden; }
  .panel .panel-hd { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
  .panel .panel-hd .tip { font-size: 11px; color: #999; font-weight: 400; }
  .panel .panel-bd { padding: 8px 12px 12px; }
  .clip-list { max-height: 260px; overflow-y: auto; }
  .clip-item { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #f2f3f7; font-size: 13px; }
  .clip-item:last-child { border-bottom: none; }
  .clip-item input[type=checkbox] { width: 16px; height: 16px; flex-shrink: 0; accent-color: #7c5cff; }
  .clip-item .clip-no { width: 20px; height: 20px; border-radius: 50%; background: #f0eefe; color: #7c5cff; font-size: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .clip-item .clip-play { background: #f0eefe; color: #7c5cff; border: none; border-radius: 10px; font-size: 11px; padding: 3px 8px; cursor: pointer; flex-shrink: 0; }
  .clip-item .clip-dur { color: #999; font-size: 11px; flex-shrink: 0; }
  .clip-item .clip-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #333; }
  .clip-item .clip-issues { color: #d97706; font-size: 11px; }
  .clip-summary { margin-top: 8px; padding-top: 8px; border-top: 1px solid #f0f0f0; font-size: 12px; color: #666; }
  .clip-summary .bar { height: 4px; border-radius: 2px; background: #f0f0f0; margin-top: 5px; overflow: hidden; }
  .clip-summary .bar i { display: block; height: 100%; border-radius: 2px; background: #7c5cff; transition: width .2s; }
  .clip-summary .bar i.over { background: #ef4444; }
  .clip-actions { display: flex; gap: 8px; margin-top: 10px; }
  .btn.primary { background: #7c5cff; color: #fff; flex: 1; border-radius: 10px; padding: 9px 0; }
  .btn.ghost { background: #f2f3f7; color: #555; border-radius: 10px; padding: 9px 0; flex: 1; }
  .form-row { margin-bottom: 10px; }
  .form-row label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
  .form-row input, .form-row select, .form-row textarea { width: 100%; border: 1px solid #e2e4ea; border-radius: 8px; padding: 8px 10px; font-size: 14px; outline: none; background: #fff; }
  .form-row input:focus, .form-row select:focus, .form-row textarea:focus { border-color: #7c5cff; }
  .form-row .form-grid { display: flex; gap: 8px; }
  .form-row .form-grid > div { flex: 1; }
  .audio-pop { position: fixed; right: 14px; bottom: 84px; z-index: 98; background: rgba(0,0,0,.8); color: #fff; padding: 8px 12px; border-radius: 10px; font-size: 12px; display: none; }
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <div class="avatar">音</div>
    <div class="meta">
      <div class="name">${title}</div>
      <div class="sub">为「${agentName}」训练专属声音</div>
    </div>
  </div>
  <div id="chat" class="chat"></div>
  <div id="statusCard" class="status-card" style="display:none"></div>
  <div id="clipPanel" class="panel" style="display:none">
    <div class="panel-hd"><span>选择训练片段</span><span class="tip">建议总时长不超过 1 分钟</span></div>
    <div class="panel-bd">
      <div class="clip-list" id="clipList"></div>
      <div class="clip-summary" id="clipSummary" style="display:none"></div>
      <div class="clip-actions">
        <button id="clipNextBtn" class="btn primary">下一步：填写训练信息</button>
        <button id="clipClearBtn" class="btn ghost">全不选</button>
      </div>
    </div>
  </div>
  <div id="trainForm" class="panel" style="display:none">
    <div class="panel-hd"><span>填写训练信息</span><span class="tip">服务商：千问</span></div>
    <div class="panel-bd">
      <div class="form-row">
        <label>音色名称</label>
        <input id="fName" type="text" maxlength="30" placeholder="例如：妈妈的声音" />
      </div>
      <div class="form-row">
        <label>服务商</label>
        <select id="fProvider">
          <option value="qwen" selected>千问（Qwen）</option>
          <option value="cosyvoice">CosyVoice</option>
          <option value="doubao">豆包</option>
        </select>
      </div>
      <div class="form-row">
        <label>方言</label>
        <select id="fDialect">
          <option value="auto" selected>自动</option>
          <option value="mandarin">普通话</option>
          <option value="cantonese">粤语</option>
          <option value="shanghainese">上海话</option>
          <option value="sichuanhua">四川话</option>
        </select>
      </div>
      <div class="form-row">
        <label>试听文本</label>
        <textarea id="fPreview" rows="2" maxlength="200" placeholder="训练完成后用于试听的一句话"></textarea>
      </div>
      <div class="form-row">
        <div class="form-grid">
          <div><label>语速（0.5-2.0）</label><input id="fSpeed" type="number" min="0.5" max="2" step="0.05" value="1" /></div>
          <div><label>音量（0.5-2.0）</label><input id="fVolume" type="number" min="0.5" max="2" step="0.05" value="1" /></div>
        </div>
      </div>
      <button id="trainSubmitBtn" class="btn primary" style="width:100%">开始训练</button>
    </div>
  </div>
  <div id="audioPop" class="audio-pop"></div>
  <div id="attachPreview" class="attach-preview" style="display:none"></div>
  <div class="input-bar">
    <button id="uploadBtn" class="btn upload">＋ 音频</button>
    <textarea id="input" rows="1" placeholder="说点什么，或直接上传一段音频…"></textarea>
    <button id="sendBtn" class="btn send">发送</button>
  </div>
</div>
<input id="fileInput" type="file" accept="audio/*,.mp3,.m4a,.wav,.mp4" style="display:none" />
<div id="toast" class="toast"></div>

<script>
(function () {
  'use strict';
  var token = location.pathname.split('/').pop();
  var secret = '__AGENT_VT_SECRET__';
  var pendingAttachments = [];
  var history = [];
  var boundTimbreIds = {};
  var myTrainingIds = {};
  var polling = false;

  var chatEl = document.getElementById('chat');
  var inputEl = document.getElementById('input');
  var statusCard = document.getElementById('statusCard');
  var attachPreview = document.getElementById('attachPreview');
  var toastEl = document.getElementById('toast');

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (secret) headers['X-Agent-Vt-Secret'] = secret;
    return fetch('/admin_api/agent_vt/api/' + token + '/' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body || undefined
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.status >= 400 || !data) {
          var msg = (data && data.message) || ('请求失败(' + res.status + ')');
          throw new Error(msg);
        }
        if (data && typeof data.success !== 'undefined') {
          if (!data.success) throw new Error(data.message || '请求失败');
          return data.data;
        }
        return data;
      });
    });
  }

  function pushMsg(role, text, attachments) {
    var row = document.createElement('div');
    row.className = 'msg ' + role;
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    var content = document.createElement('div');
    content.textContent = text || '';
    bubble.appendChild(content);
    (attachments || []).forEach(function (a) {
      var tag = document.createElement('div');
      tag.className = 'attach-tag';
      tag.textContent = '🎵 ' + (a.name || '音频') + ' 已上传';
      bubble.appendChild(tag);
    });
    row.appendChild(bubble);
    chatEl.appendChild(row);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function showTyping() {
    var row = document.createElement('div');
    row.className = 'msg assistant';
    row.id = 'typingRow';
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    row.appendChild(bubble);
    chatEl.appendChild(row);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById('typingRow');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var STATUS_TEXT = { pending: '排队中', training: '训练中', active: '已就绪', failed: '失败' };
  function renderTimbres(items) {
    if (!items || !items.length) { statusCard.style.display = 'none'; return; }
    statusCard.style.display = 'block';
    var html = '<div class="sc-title">训练列表</div>';
    items.forEach(function (t) {
      var status = t.status || '';
      var dot = status === 'active' ? 'active' : (status === 'failed' ? 'failed' : 'pending');
      html += '<div class="sc-item"><span class="dot ' + dot + '"></span>' +
        '<span class="sc-name">' + esc(t.name || t.id || '') + '</span>' +
        '<span class="sc-status">' + esc(STATUS_TEXT[status] || status) + '</span></div>';
    });
    statusCard.innerHTML = html;
    return items;
  }

  function refreshTimbres(silent) {
    return api('timbres').then(function (items) {
      renderTimbres(items);
      (items || []).forEach(function (t) {
        if (t.status === 'active' && t.id && myTrainingIds[t.id] && !boundTimbreIds[t.id]) {
          boundTimbreIds[t.id] = true;
          api('timbres/' + encodeURIComponent(t.id) + '/bind', { method: 'POST', body: '{}' })
            .then(function (res) {
              toast('已绑定到「' + (res.agentName || 'AI 亲人') + '」');
              pushMsg('assistant', '音色「' + (t.name || '') + '」训练完成，已自动绑定到 AI 亲人「' + (res.agentName || '') + '」。现在可以用这个声音聊天了。');
            })
            .catch(function (err) {
              boundTimbreIds[t.id] = false;
              if (!silent) toast('绑定失败：' + err.message);
            });
        }
      });
      return items;
    }).catch(function (err) {
      if (!silent) toast(err.message);
    });
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    setInterval(function () { refreshTimbres(true); }, 10000);
  }

  function historySnapshot() {
    return history.map(function (m) { return { role: m.role, content: m.content }; });
  }

  function send() {
    var text = inputEl.value.trim();
    var atts = pendingAttachments.slice();
    if (!text && atts.length === 0) return;

    pushMsg('user', text, atts);
    history.push({ role: 'user', content: text || '（上传了音频）' });
    pendingAttachments = [];
    attachPreview.style.display = 'none';
    inputEl.value = '';
    inputEl.style.height = 'auto';
    disableInput(true);
    showTyping();

    api('chat', {
      method: 'POST',
      body: JSON.stringify({ messages: historySnapshot(), attachments: atts })
    }).then(function (res) {
      hideTyping();
      var reply = (res && res.reply) || '（没有收到回复，请再试一次）';
      pushMsg('assistant', reply);
      history.push({ role: 'assistant', content: reply });
      (res.actions || []).forEach(function (a) {
        if (a.action === 'create_training') { toast('已创建训练任务'); if (a.timbreId) myTrainingIds[a.timbreId] = true; }
        if (a.action === 'retry_training') { if (a.timbreId) myTrainingIds[a.timbreId] = true; }
        if (a.action === 'bind_to_relative') toast('已绑定 AI 亲人');
      });
      refreshTimbres(true);
      startPolling();
    }).catch(function (err) {
      hideTyping();
      pushMsg('assistant', '出错了：' + err.message);
    }).finally(function () {
      disableInput(false);
      inputEl.focus();
    });
  }

  // ===== 切片选择（对齐管理后台第二步，复用 C 端建议上限逻辑） =====
  var MAX_CLIP_SECONDS = 60;
  var CLIP_GAP_SECONDS = 0.2;
  var clipState = { clips: [], selected: {} };

  function clipDurSec(c) { return Number(c.durationSeconds || c.durationSec || 0) || 0; }

  function findClip(objectKey) {
    for (var i = 0; i < clipState.clips.length; i++) {
      if (clipState.clips[i].objectKey === objectKey) return clipState.clips[i];
    }
    return null;
  }

  function selectedClipSeconds() {
    var total = 0, n = 0;
    clipState.clips.forEach(function (c) {
      if (clipState.selected[c.objectKey]) { total += clipDurSec(c) + CLIP_GAP_SECONDS; n++; }
    });
    return { total: total, n: n };
  }

  function updateClipSummary() {
    var el = document.getElementById('clipSummary');
    var sum = selectedClipSeconds();
    var totalSec = Math.round(sum.total * 10) / 10;
    var over = totalSec > MAX_CLIP_SECONDS;
    el.style.display = 'block';
    var pct = Math.min(100, Math.round((totalSec / MAX_CLIP_SECONDS) * 100));
    el.innerHTML = '已选 <b>' + sum.n + '</b> 段，共 <b>' + totalSec + '</b> 秒，' +
      (over ? '<span style="color:#ef4444">超过 1 分钟建议上限</span>' : '建议不超过 1 分钟') +
      '<div class="bar"><i class="' + (over ? 'over' : '') + '" style="width:' + pct + '%"></i></div>';
  }

  function toggleClip(objectKey, cb) {
    if (cb.checked) {
      var sum = selectedClipSeconds();
      var c = findClip(objectKey);
      if (c && sum.total + clipDurSec(c) + CLIP_GAP_SECONDS > MAX_CLIP_SECONDS) {
        toast('已选片段总时长超过 1 分钟建议上限');
        cb.checked = false;
        return;
      }
    }
    clipState.selected[objectKey] = !!cb.checked;
    updateClipSummary();
  }

  function playClip(url) {
    var pop = document.getElementById('audioPop');
    pop.style.display = 'block';
    pop.textContent = '正在播放…';
    var audio = new Audio(url);
    audio.onended = function () { pop.style.display = 'none'; };
    audio.onplay = function () { pop.textContent = '播放中（可重复试听）'; };
    audio.play().catch(function () { pop.style.display = 'none'; toast('试听失败，请稍后重试'); });
  }

  function renderClips(clips) {
    clipState.clips = clips || [];
    clipState.selected = {};
    var listEl = document.getElementById('clipList');
    var panel = document.getElementById('clipPanel');
    if (!clipState.clips.length) {
      panel.style.display = 'none';
      pushMsg('assistant', '未能从这段音频中剪出可用片段，请换一段更清晰的录音再试。');
      return;
    }
    panel.style.display = 'block';
    var html = '';
    clipState.clips.forEach(function (c, i) {
      var dur = Math.round(clipDurSec(c) * 10) / 10;
      var issues = '';
      if (c.qualityIssues && c.qualityIssues.length) {
        issues = '<span class="clip-issues">' + esc((c.qualityIssues[0].message || '质量提示')) + '</span>';
      }
      html += '<div class="clip-item">' +
        '<input type="checkbox" checked data-ok="' + esc(c.objectKey) + '" />' +
        '<span class="clip-no">' + (i + 1) + '</span>' +
        '<button class="clip-play" data-play="' + esc(c.publicUrl || c.url || '') + '">试听</button>' +
        '<span class="clip-dur">' + dur + 's</span>' +
        '<span class="clip-name">' + esc(c.transcript || ('片段 ' + (i + 1))) + '</span>' +
        issues + '</div>';
    });
    listEl.innerHTML = html;
    listEl.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      clipState.selected[cb.getAttribute('data-ok')] = true;
      cb.addEventListener('change', function () { toggleClip(cb.getAttribute('data-ok'), cb); });
    });
    listEl.querySelectorAll('.clip-play').forEach(function (btn) {
      btn.addEventListener('click', function () { playClip(btn.getAttribute('data-play')); });
    });
    updateClipSummary();
    pushMsg('assistant', '已剪出 ' + clipState.clips.length + ' 段训练片段（默认全选）。勾选想用于训练的片段，点“下一步”继续。');
  }

  function clipAndRender(objectKey, name, publicUrl) {
    api('materials', {
      method: 'POST',
      body: JSON.stringify({ name: name || '对话上传素材', objectKey: objectKey, publicUrl: publicUrl || '' })
    }).catch(function () { /* 素材持久化失败不阻断剪辑 */ });
    api('clip', {
      method: 'POST',
      body: JSON.stringify({ materials: [{ name: name || '', objectKey: objectKey, publicUrl: publicUrl || '' }] })
    }).then(function (res) {
      var clips = (res && res.clips) || [];
      renderClips(clips);
    }).catch(function (err) {
      pushMsg('assistant', '音频剪辑失败：' + err.message);
    });
  }

  function showTrainForm() {
    var sum = selectedClipSeconds();
    if (!sum.n) { toast('请至少选择一段训练片段'); return; }
    if (sum.total > MAX_CLIP_SECONDS) { toast('已选片段总时长超过 1 分钟，请减少片段'); return; }
    document.getElementById('fName').value = '对话训练-' + new Date().toISOString().slice(0, 10);
    document.getElementById('clipPanel').style.display = 'none';
    document.getElementById('trainForm').style.display = 'block';
  }

  function submitTraining() {
    var sum = selectedClipSeconds();
    if (!sum.n) { toast('请至少选择一段训练片段'); return; }
    if (sum.total > MAX_CLIP_SECONDS) { toast('已选片段总时长超过 1 分钟，请减少片段'); return; }
    var objectKeys = clipState.clips
      .filter(function (c) { return clipState.selected[c.objectKey]; })
      .map(function (c) { return c.objectKey; });
    var body = {
      audioObjectKeys: objectKeys,
      name: (document.getElementById('fName').value || '').trim(),
      provider: document.getElementById('fProvider').value,
      speechDialect: document.getElementById('fDialect').value,
      previewText: (document.getElementById('fPreview').value || '').trim(),
      speechSpeed: parseFloat(document.getElementById('fSpeed').value) || 1,
      speechVolume: parseFloat(document.getElementById('fVolume').value) || 1,
    };
    if (!body.name) { toast('请填写音色名称'); return; }
    var btn = document.getElementById('trainSubmitBtn');
    btn.disabled = true; btn.textContent = '提交中…';
    api('timbres', {
      method: 'POST',
      body: JSON.stringify(body)
    }).then(function (timbre) {
      toast('已创建训练任务');
      pushMsg('assistant', '训练任务已创建' + (timbre && timbre.name ? '：「' + timbre.name + '」' : '') + '。训练完成后会自动绑定到 AI 亲人，我会持续为你刷新进度。');
      if (timbre && timbre.id) myTrainingIds[timbre.id] = true;
      document.getElementById('trainForm').style.display = 'none';
      refreshTimbres(true);
      startPolling();
    }).catch(function (err) {
      toast('创建失败：' + err.message);
    }).finally(function () {
      btn.disabled = false; btn.textContent = '开始训练';
    });
  }

  function disableInput(disabled) {
    inputEl.disabled = disabled;
    document.getElementById('sendBtn').disabled = disabled;
    document.getElementById('uploadBtn').disabled = disabled;
  }

  function uploadFile(file) {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) { toast('文件不能超过 200MB'); return; }
    var fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('folder', 'agent-vt');
    var headers = {};
    if (secret) headers['X-Agent-Vt-Secret'] = secret;
    toast('正在上传…');

    fetch('/admin_api/agent_vt/api/' + token + '/upload', {
      method: 'POST',
      headers: headers,
      body: fd
    }).then(function (res) {
      return res.json().catch(function () { return null; });
    }).then(function (data) {
      if (!data || !data.success || !data.data) {
        throw new Error((data && data.message) || '上传失败');
      }
      var item = data.data;
      pendingAttachments.push({ objectKey: item.objectKey, name: file.name });
      attachPreview.style.display = 'flex';
      attachPreview.innerHTML = '<span>🎵 ' + esc(file.name) + '</span>' +
        '<span class="clear" id="clearAttach">✕</span>';
      document.getElementById('clearAttach').addEventListener('click', function () {
        pendingAttachments = [];
        attachPreview.style.display = 'none';
      });
      toast('素材上传完成');
      // 对齐管理后台流程：上传素材 → 自动进入切片选择（第二步）
      pushMsg('assistant', '已收到音频「' + file.name + '」，正在分析并剪辑成训练片段，请稍候…');
      clipAndRender(item.objectKey, file.name, item.publicUrl || '');
    }).catch(function (err) {
      toast('上传失败：' + err.message);
    });
  }

  // ---------- init ----------
  var fileInput = document.getElementById('fileInput');
  document.getElementById('uploadBtn').addEventListener('click', function () { fileInput.click(); });
  document.getElementById('clipNextBtn').addEventListener('click', showTrainForm);
  document.getElementById('clipClearBtn').addEventListener('click', function () {
    clipState.clips.forEach(function (c) { clipState.selected[c.objectKey] = false; });
    document.querySelectorAll('#clipList input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
    updateClipSummary();
  });
  document.getElementById('trainSubmitBtn').addEventListener('click', submitTraining);
  fileInput.addEventListener('change', function () { if (fileInput.files && fileInput.files[0]) uploadFile(fileInput.files[0]); fileInput.value = ''; });
  document.getElementById('sendBtn').addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  api('me').then(function (me) {
    if (me && me.agentName) {
      document.querySelector('.header .sub').textContent = '为「' + me.agentName + '」训练专属声音';
    }
  }).catch(function () { /* 忽略 */ });

  pushMsg('assistant', '你好，我是声音训练助手。你可以：\\n1. 点「＋ 音频」上传一段 14–30 秒的清晰人声；\\n2. 告诉我“用这段声音训练”；\\n3. 训练完成后我会自动把它绑定到你的 AI 亲人。\\n也可以随时问我“训练好了吗”查看进度。');
  refreshTimbres(true);
  startPolling();
})();
</script>
</body>
</html>`.replace('__AGENT_VT_SECRET__', this.escapeHtml(secret));
  }

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

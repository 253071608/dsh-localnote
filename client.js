/**
 * dsh-localnote — 浏览器端（client.js）
 *
 * dsh 客户端插件：在 shell.overlay 槽位注册一个"笔记"面板浮窗。
 * 每张笔记 = 标题(text) + 详情文本(content) + 若干图片(images) + 定时(schedule)。
 *
 * 定时能力：
 *   - 每条笔记点 ⏰ 打开"定时设置卡"：一次设好 到期时间 + 到点动作 + 模型。
 *   - 到点动作：agent(任务执行，可指定模型) / alert(仅提醒，不需要模型)。
 *   - 有定时的笔记在列表显示 ⏰ + 倒计时/状态；执行结果展示在详情模态框。
 *
 * 路由：
 *   - 列出/新建/切换/删除/更新详情/上传图片/删除图片/读图
 *   - PATCH /dsh-localnote/notes/schedule  设置/取消定时
 *   - GET   /dsh-localnote/models          可用模型
 *
 * 结构要点：window.__ModuleLoader__.load({ id, factory })；
 * apply(ctx) 通过 ctx.slots.inject("shell.overlay", ...) 挂到页面浮图层。
 */
window.__ModuleLoader__.load({
  id: '@253071608/dsh-localnote',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    let react = require('react');
    const { useState, useEffect, useRef } = react;

    // ---------------------------------------------------------------- CSS
    const styleTag = document.createElement('style');
    styleTag.textContent = `
.hd-panel{position:fixed;top:64px;right:16px;z-index:9990;width:320px;max-height:70vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:rgba(15,18,26,.96);border:1px solid rgba(255,255,255,.14);color:#e5e7eb;box-shadow:0 8px 32px rgba(0,0,0,.5);backdrop-filter:blur(10px);font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;pointer-events:auto}
.hd-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex:none;cursor:move;user-select:none}
.hd-title{font-weight:700;color:#22d3ee;white-space:nowrap}
.hd-close{background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:14px;line-height:1;padding:2px 6px;border-radius:6px}
.hd-close:hover{color:#fff;background:rgba(255,255,255,.08)}
.hd-stats{padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.06);color:#9ca3af;font-size:11px;flex:none}
.hd-slogan{padding:4px 12px;border-top:1px solid rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.06);color:#6ee7ff;font-size:10px;line-height:1.4;flex:none;opacity:.85}
.hd-list{overflow-y:auto;padding:6px;flex:1 1 auto}
.hd-empty{padding:16px 10px;text-align:center;color:#6b7280}
.hd-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px}
.hd-row:hover{background:rgba(255,255,255,.05)}
.hd-check{flex:none;width:16px;height:16px;border-radius:4px;border:1px solid #4b5563;background:transparent;cursor:pointer;color:transparent;font-size:11px;line-height:14px;text-align:center}
.hd-check.hd-on{background:#22d3ee;border-color:#22d3ee;color:#0f121a}
.hd-main{flex:1 1 auto;min-width:0}
.hd-text{word-break:break-word;cursor:pointer}
.hd-text:hover{color:#22d3ee}
.hd-text.hd-done{color:#6b7280;text-decoration:line-through}
.hd-sub{display:flex;align-items:center;gap:6px;margin-top:2px}
.hd-sched{display:inline-flex;align-items:center;gap:4px;color:#a78bfa;font-size:11px;cursor:pointer;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.25);border-radius:6px;padding:1px 6px}
.hd-sched:hover{border-color:#a78bfa}
.hd-sched.hd-fresh{color:#6ee7ff;border-color:rgba(110,231,255,.3);background:rgba(110,231,255,.08)}
.hd-sched.hd-done2{color:#34d399;border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.08)}
.hd-sched.hd-err{color:#ff6b6b;border-color:rgba(255,107,107,.35);background:rgba(255,107,107,.08)}
.hd-detailbtn{display:inline-flex;align-items:center;gap:4px;color:#e5e7eb;font-size:11px;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:1px 6px}
.hd-detailbtn:hover{background:rgba(255,255,255,.16);border-color:#bbb}
.hd-count{flex:none;color:#6b7280;font-size:11px}
.hd-del{flex:none;background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:13px;padding:0 4px;border-radius:4px;opacity:0}
.hd-row:hover .hd-del{opacity:1}
.hd-del:hover{color:#ff6b6b}
.hd-inputbar{display:flex;gap:6px;padding:8px;border-top:1px solid rgba(255,255,255,.08);flex:none}
.hd-input{flex:1 1 auto;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e5e7eb;padding:6px 10px;font:inherit;outline:none}
.hd-input:focus{border-color:#22d3ee}
.hd-add{flex:none;background:#22d3ee;border:none;border-radius:8px;color:#0f121a;font-weight:700;padding:6px 12px;cursor:pointer}
.hd-add:disabled{opacity:.5;cursor:not-allowed}
.hd-pill{position:fixed;top:64px;right:16px;z-index:9989;padding:6px 12px;border-radius:999px;background:rgba(15,18,26,.93);border:1px solid rgba(34,211,238,.5);color:#22d3ee;cursor:pointer;font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;user-select:none;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.hd-pill:hover{border-color:#22d3ee;background:rgba(34,211,238,.16)}
/* 模态详情框 */
.hd-modal{position:fixed;top:0;left:0;right:0;bottom:0;z-index:9995;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;pointer-events:auto}
.hd-modal-card{width:540px;max-width:92vw;max-height:88vh;display:flex;flex-direction:column;border-radius:14px;background:rgba(18,22,32,.98);border:1px solid rgba(255,255,255,.16);color:#e5e7eb;box-shadow:0 24px 64px rgba(0,0,0,.6);backdrop-filter:blur(12px);font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;overflow:hidden}
.hd-m-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.1);flex:none}
.hd-m-title{font-weight:700;color:#22d3ee}
.hd-m-body{padding:14px;overflow-y:auto;flex:1 1 auto;display:flex;flex-direction:column;gap:12px}
.hd-m-field{display:flex;flex-direction:column;gap:4px}
.hd-m-label{color:#9ca3af;font-size:11px}
.hd-ttl{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e5e7eb;padding:6px 10px;font:inherit;outline:none}
.hd-ttl:focus{border-color:#22d3ee}
.hd-content{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e5e7eb;padding:8px 10px;font:inherit;outline:none;min-height:120px;resize:vertical}
.hd-content:focus{border-color:#22d3ee}
.hd-pastehint{padding:6px 10px;border:1px dashed rgba(34,211,238,.4);border-radius:8px;color:#6ee7ff;font-size:11px;text-align:center}
.hd-imgs{display:flex;flex-wrap:wrap;gap:8px}
.hd-imgwrap{position:relative;width:120px}
.hd-img{width:120px;height:90px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.12);display:block;background:#000}
.hd-imgdel{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.7);border:none;border-radius:50%;color:#fff;width:20px;height:20px;font-size:12px;line-height:1;cursor:pointer}
.hd-imgdel:hover{background:#ff6b6b}
.hd-result{background:rgba(52,211,153,.06);border:1px solid rgba(52,211,153,.22);border-radius:8px;padding:8px 10px;white-space:pre-wrap;color:#e5e7eb;font-size:12px;line-height:1.6}
.hd-result-title{color:#34d399;font-size:11px;font-weight:700;margin-bottom:4px}
.hd-log{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px 10px;color:#9ca3af;font-size:11px;white-space:pre-wrap}
.hd-m-err{color:#ff6b6b;font-size:11px;margin-right:auto}
.hd-m-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.1);flex:none}
.hd-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#e5e7eb;padding:6px 14px;cursor:pointer;font:inherit}
.hd-btn:hover{background:rgba(255,255,255,.14)}
.hd-btn-primary{background:#22d3ee;border:none;color:#0f121a;font-weight:700}
.hd-btn-primary:hover{background:#67e8f9}
.hd-btn:disabled{opacity:.5;cursor:not-allowed}
/* 定时设置卡 */
.hd-sched-card{width:360px;max-width:92vw;display:flex;flex-direction:column;border-radius:14px;background:rgba(18,22,32,.98);border:1px solid rgba(167,139,250,.35);color:#e5e7eb;box-shadow:0 24px 64px rgba(0,0,0,.6);backdrop-filter:blur(12px);font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;overflow:hidden}
.hd-sched-body{padding:14px;display:flex;flex-direction:column;gap:12px}
.hd-sched-title{font-weight:700;color:#a78bfa}
.hd-dt{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e5e7eb;padding:6px 10px;font:inherit;outline:none;color-scheme:dark}
.hd-dt:focus{border-color:#a78bfa}
.hd-radio-row{display:flex;gap:10px}
.hd-radio{display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;cursor:pointer;font-size:12px}
.hd-radio:hover{border-color:#a78bfa}
.hd-radio.hd-on{border-color:#a78bfa;background:rgba(167,139,250,.12)}
.hd-model-row{display:flex;gap:6px;align-items:center}
.hd-model-sel{flex:1 1 auto;background:#1e2433;border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#f3f4f6;padding:6px 8px;font:inherit;outline:none;color-scheme:dark}
.hd-model-sel:focus{border-color:#a78bfa}
.hd-model-sel:disabled{color:#8b8fa3}
.hd-model-sel option{background:#1e2433;color:#f3f4f6}
.hd-model-custom{flex:1 1 auto;background:#1e2433;border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#f3f4f6;padding:6px 10px;font:inherit;outline:none}
.hd-model-custom:focus{border-color:#a78bfa}
.hd-model-hint{color:#6b7280;font-size:11px}
`;
    document.head.appendChild(styleTag);

    // ---------------------------------------------------------- 图片工具
    /** 从剪贴板 ClipboardEvent 中提取图片 File（取第一张）。 */
    function imageFromClipboard(e) {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return null;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type && item.type.indexOf('image') === 0) {
          const f = item.getAsFile();
          if (f) return f;
        }
      }
      return null;
    }

    function readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }

    // ------------------------------------------------------- 时间格式化
    function fmtDateTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /** 倒计时剩余文本；已到期返回 '已到点'。 */
    function dueLabel(dueAt) {
      if (!dueAt) return '';
      const diff = new Date(dueAt).getTime() - Date.now();
      if (diff <= 0) return '已到点';
      const sec = Math.floor(diff / 1000);
      const m = Math.floor(sec / 60);
      const h = Math.floor(m / 60);
      if (sec < 60) return '即将到期';
      if (h >= 48) return `${Math.floor(h / 24)}天后`;
      if (h >= 1) return `${h}小时${m % 60}分`;
      return `${m}分钟`;
    }

    // ------------------------------------------------------- 到点提醒
    let toastSeq = 0;
    let toastContainer = null;
    /** 确保 toast 容器存在（右上角，多浮条垂直排列）。 */
    function ensureToastContainer() {
      if (!toastContainer || !document.body.contains(toastContainer)) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'hd-toast-container';
        toastContainer.style.cssText = 'position:fixed;top:70px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;width:auto;max-width:340px';
        document.body.appendChild(toastContainer);
      }
      return toastContainer;
    }
    /** 页面内 toast：每条通知独立浮条，按到达顺序垂直累加，5 秒后各自淡出移除（不互相覆盖）。 */
    function showToast(text) {
      const container = ensureToastContainer();
      const el = document.createElement('div');
      el.id = 'hd-toast-' + (++toastSeq);
      el.style.cssText = 'max-width:320px;padding:12px 16px;border-radius:10px;background:rgba(18,22,32,.97);border:1px solid rgba(167,139,250,.5);color:#e5e7eb;box-shadow:0 8px 30px rgba(0,0,0,.5);font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:none;white-space:pre-wrap;opacity:0;transition:opacity .4s';
      el.textContent = text;
      container.appendChild(el);
      // 触发过渡动画
      requestAnimationFrame(() => { el.style.opacity = '1'; });
      // 若干条堆积时上限，避免无限累积
      const max = 6;
      while (container.children.length > max) {
        container.removeChild(container.firstChild);
      }
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 450);
      }, 5000);
    }

    let notifyPermAsked = false;
    /** 请求系统通知权限（仅在用户交互时调用一次）。 */
    function ensureNotifyPermission() {
      if (!('Notification' in window) || notifyPermAsked) return;
      notifyPermAsked = true;
      try {
        if (Notification.permission === 'default') Notification.requestPermission();
      } catch (e) { /* ignore */ }
    }

    // ---- 通知去重（localStorage 持久化，跨刷新不重复） ----
    // key = "noteId:dueAt"。同一笔记、同一到期时间只通知一次；
    // 修改到期时间后 dueAt 变化，会获得一次新的通知机会。
    const NOTIFY_KEY = 'dsh-localnote:notified';
    function readNotified() {
      try { return JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}') || {}; }
      catch (e) { return {}; }
    }
    function writeNotified(map) {
      try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(map)); } catch (e) { /* ignore */ }
    }
    /** 检查一条已到点笔记是否应弹通知（并预占位，防并发重复）。 */
    function claimNotify(note) {
      if (!note || !note.schedule || !note.schedule.dueAt) return false;
      const key = String(note.id) + ':' + note.schedule.dueAt;
      const map = readNotified();
      if (map[key] === true) return false; // 已通知过
      map[key] = true;
      writeNotified(map);
      return true;
    }

    /** 到点提醒：优先 toast，页面不可见时用系统通知。 */
    function notifyDue(note) {
      const title = note && note.text ? note.text : '笔记到点';
      const body = note && note.action === 'alert'
        ? '这条笔记已到点（仅提醒）'
        : (note && note.log ? note.log : '这条笔记已到点');
      // 总是显示 toast（可见时用户看得到）
      showToast('⏰ ' + title + '\n' + body);
      // 页面不可见时，再补发系统通知
      const hidden = typeof document.hidden === 'boolean' ? document.hidden : false;
      if (hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('⏰ 灵感笔记', { body: title + '\n' + body });
          setTimeout(() => { try { n.close(); } catch (e) {} }, 8000);
        } catch (e) { /* ignore */ }
      }
    }

    // ------------------------------------------------------- 定时设置卡
    function ScheduleModal(props) {
      const note = props.note;
      const onClose = props.onClose;
      const onSaved = props.onSaved;
      const [due, setDue] = useState('');
      const [action, setAction] = useState('agent');
      const [modelSel, setModelSel] = useState('default'); // 'default' | 'list' | 'custom'
      const [models, setModels] = useState([]);            // [{provider,model,label,default}]
      const [modelKey, setModelKey] = useState('');         // 列表选中的 provider/model
      const [customModel, setCustomModel] = useState('');
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState(null);

      // 打开时：预填到期时间、动作、模型
      useEffect(() => {
        const sch = note && note.schedule;
        if (sch && sch.dueAt) {
          // datetime-local 需要 "YYYY-MM-DDTHH:mm"（T 分隔），而 fmtDateTime 返回空格分隔。
          // 这里转成 T 格式，保证 input 能正确显示/解析。
          const s = fmtDateTime(sch.dueAt); // "YYYY-MM-DD HH:mm"
          setDue(s ? s.replace(' ', 'T') : '');
        } else {
          setDue('');
        }
        setAction(note && note.action ? note.action : 'agent');
        if (note && note.model && note.model.model) {
          const key = note.model.provider + '/' + note.model.model;
          setModelKey(key);
          setModelSel('list');
          setCustomModel('');
        } else {
          setModelSel('default');
          setModelKey('');
          setCustomModel('');
        }
        // 拉取可用模型（尽力而为）。models 列表含默认模型在最前。
        fetch('/dsh-localnote/models').then((r) => r.ok ? r.json() : { models: [] })
          .then((res) => {
            const list = res.models || [];
            setModels(list);
            // 若当前没有选中的模型，且已有默认/列表，自动选中第一个
            setModelKey((prev) => {
              if (prev) return prev;
              if (list.length > 0) return list[0].provider + '/' + list[0].model;
              return '';
            });
          })
          .catch(() => setModels([]));
        setErr(null);
      }, [note && note.id]);

      const save = () => {
        setErr(null);
        if (!due) { setErr('请选择到期时间'); return; }
        // 本地 datetime-local 值 "YYYY-MM-DDTHH:mm" → ISO
        const dueISO = new Date(due).toISOString();
        let model = null;
        if (action === 'agent') {
          if (modelSel === 'list') {
            const key = modelKey.trim();
            if (!key) { setErr('请选择一个执行模型'); return; }
            const slash = key.indexOf('/');
            if (slash <= 0 || slash === key.length - 1) { setErr('模型格式应为 provider/model'); return; }
            model = { provider: key.slice(0, slash).trim(), model: key.slice(slash + 1).trim() };
          } else if (modelSel === 'custom') {
            const t = customModel.trim();
            if (!t) { setErr('请填写模型，格式 provider/model'); return; }
            const slash = t.indexOf('/');
            if (slash <= 0 || slash === t.length - 1) { setErr('自定义模型格式应为 provider/model'); return; }
            model = { provider: t.slice(0, slash).trim(), model: t.slice(slash + 1).trim() };
          } else {
            // default：让 host 回退到默认模型
            model = { provider: '', model: '' };
          }
        }
        setBusy(true);
        fetch('/dsh-localnote/notes/schedule', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: note.id, dueAt: dueISO, action: action, model: model }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(() => { if (onSaved) onSaved(); onClose(); })
          .catch((e2) => setErr(String(e2 && e2.message ? e2.message : e2)))
          .finally(() => setBusy(false));
      };

      const clear = () => {
        setBusy(true); setErr(null);
        fetch('/dsh-localnote/notes/schedule', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: note.id, dueAt: null }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(() => { if (onSaved) onSaved(); onClose(); })
          .catch((e2) => setErr(String(e2 && e2.message ? e2.message : e2)))
          .finally(() => setBusy(false));
      };

      const hasSched = !!(note && note.schedule && note.schedule.dueAt);

      return react.createElement('div', { className: 'hd-modal' },
        react.createElement('div', { className: 'hd-sched-card' },
          react.createElement('div', { className: 'hd-m-header' },
            react.createElement('span', { className: 'hd-sched-title' }, '⏰ 定时设置'),
            react.createElement('button', { className: 'hd-close', onClick: onClose }, '✕'),
          ),
          react.createElement('div', { className: 'hd-sched-body' },
            react.createElement('div', { className: 'hd-m-field' },
              react.createElement('span', { className: 'hd-m-label' }, '到期时间（到时分）'),
              react.createElement('input', { className: 'hd-dt', type: 'datetime-local', value: due, onChange: (e) => setDue(e.target.value) }),
            ),
            react.createElement('div', { className: 'hd-m-field' },
              react.createElement('span', { className: 'hd-m-label' }, '到点动作'),
              react.createElement('div', { className: 'hd-radio-row' },
                react.createElement('button', { type: 'button', className: 'hd-radio' + (action === 'agent' ? ' hd-on' : ''), onClick: () => setAction('agent') },
                  '任务执行'),
                react.createElement('button', { type: 'button', className: 'hd-radio' + (action === 'alert' ? ' hd-on' : ''), onClick: () => setAction('alert') },
                  '仅提醒'),
              ),
            ),
            // 仅当动作为"任务执行"时显示模型选择
            action === 'agent' ? react.createElement('div', { className: 'hd-m-field' },
              react.createElement('span', { className: 'hd-m-label' }, '执行模型'),
              react.createElement('div', { className: 'hd-model-row' },
                react.createElement('select', {
                  className: 'hd-model-sel',
                  value: modelSel,
                  onChange: (e) => setModelSel(e.target.value),
                },
                  react.createElement('option', { value: 'default' }, '默认模型'),
                  react.createElement('option', { value: 'list' }, '从列表选择'),
                  react.createElement('option', { value: 'custom' }, '自定义'),
                ),
              ),
              modelSel === 'list'
                ? react.createElement('select', {
                    className: 'hd-model-sel',
                    value: modelKey,
                    onChange: (e) => setModelKey(e.target.value),
                  },
                    models.length === 0
                      ? react.createElement('option', { value: '' }, '（无可用模型，请用自定义）')
                      : models.map((m) => react.createElement('option', { key: m.provider + '/' + m.model, value: m.provider + '/' + m.model }, m.label || (m.provider + '/' + m.model))),
                  )
                : null,
              modelSel === 'custom'
                ? react.createElement('input', { className: 'hd-model-custom', placeholder: 'provider/model，例如 deepseek-official/dsv4-filethink-prd', value: customModel, onChange: (e) => setCustomModel(e.target.value) })
                : null,
              modelSel === 'default'
                ? react.createElement('div', { className: 'hd-model-hint' }, '将使用当前默认模型' + (models[0] && models[0].label ? '（' + models[0].label + '）' : ''))
                : null,
            ) : null,
            err ? react.createElement('div', { className: 'hd-m-err' }, err) : null,
            react.createElement('div', { className: 'hd-m-footer' },
              hasSched ? react.createElement('button', { className: 'hd-btn', onClick: clear, disabled: busy }, '取消定时') : null,
              react.createElement('button', { className: 'hd-btn', onClick: onClose, disabled: busy }, '关闭'),
              react.createElement('button', { className: 'hd-btn hd-btn-primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
            ),
          ),
        ),
      );
    }

    // ---------------------------------------------------------- 详情模态框
    function NoteModal(props) {
      const note = props.note;
      const onClose = props.onClose;
      const onSaved = props.onSaved;
      const [ttl, setTtl] = useState(note ? note.text : '');
      const [content, setContent] = useState(note ? note.content : '');
      const [images, setImages] = useState(note ? (note.images || []) : []);
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState(null);
      const pasteRef = useRef(null);

      // 打开时同步
      useEffect(() => {
        if (note) { setTtl(note.text); setContent(note.content || ''); setImages(note.images || []); }
        setErr(null);
      }, [note && note.id]);

      // 全局 paste 捕获：把剪贴板图片上传到当前笔记
      const onPaste = (e) => {
        const file = imageFromClipboard(e);
        if (!file) return;
        e.preventDefault();
        setErr(null); setBusy(true);
        readFileAsDataURL(file).then((dataUrl) => {
          return fetch('/dsh-localnote/notes/images', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: note.id, dataUrl: dataUrl, name: file.name || 'clipboard' }),
          }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
        }).then((res) => {
          setImages((prev) => prev.concat([res.image]));
        }).catch((e2) => setErr(String(e2 && e2.message ? e2.message : e2)))
          .finally(() => setBusy(false));
      };

      useEffect(() => {
        // 模态框存在期间监听整个文档的 paste
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
      }, [note && note.id]);

      const save = () => {
        setErr(null); setBusy(true);
        fetch('/dsh-localnote/notes', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: note.id, text: ttl, content: content }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(() => { if (onSaved) onSaved(); onClose(); })
          .catch((e2) => setErr(String(e2 && e2.message ? e2.message : e2)))
          .finally(() => setBusy(false));
      };

      const delImage = (file) => {
        setBusy(true);
        fetch('/dsh-localnote/notes/images', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: note.id, file: file }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(() => setImages((prev) => prev.filter((i) => i.file !== file)))
          .catch((e2) => setErr(String(e2 && e2.message ? e2.message : e2)))
          .finally(() => setBusy(false));
      };

      if (!note) return null;

      const imgNodes = images.map((im) => react.createElement('div', { key: im.file, className: 'hd-imgwrap' },
        react.createElement('img', { className: 'hd-img', src: '/dsh-localnote/images/' + encodeURIComponent(im.file), alt: im.name || '' }),
        react.createElement('button', { className: 'hd-imgdel', onClick: () => delImage(im.file), title: '删除图片' }, '✕'),
      ));

      const sched = note.schedule;
      const hasSched = !!(sched && sched.dueAt);
      const schedBlock = hasSched ? react.createElement('div', { className: 'hd-m-field' },
        react.createElement('span', { className: 'hd-m-label' }, '定时'),
        react.createElement('div', { className: 'hd-log' },
          '到期：' + fmtDateTime(sched.dueAt) +
          (note.action === 'alert' ? ' · 仅提醒' : (' · 任务执行' + (note.model ? ' (' + note.model.provider + '/' + note.model.model + ')' : ''))) +
          (note.result ? '\n已执行：' + fmtDateTime(note.processedAt) : '') +
          (note.log ? '\n' + note.log : ''),
        ),
      ) : null;

      const resultBlock = note.result ? react.createElement('div', { className: 'hd-result' },
        react.createElement('div', { className: 'hd-result-title' }, '✨ 任务执行结果'),
        note.result,
      ) : null;

      return react.createElement('div', { className: 'hd-modal' },
        react.createElement('div', { className: 'hd-modal-card' },
          react.createElement('div', { className: 'hd-m-header' },
            react.createElement('span', { className: 'hd-m-title' }, '📝 笔记详情'),
            react.createElement('button', { className: 'hd-close', onClick: onClose }, '✕'),
          ),
          react.createElement('div', { className: 'hd-m-body' },
            react.createElement('div', { className: 'hd-m-field' },
              react.createElement('span', { className: 'hd-m-label' }, '标题'),
              react.createElement('input', { className: 'hd-ttl', value: ttl, onChange: (e) => setTtl(e.target.value) }),
            ),
            react.createElement('div', { className: 'hd-m-field' },
              react.createElement('span', { className: 'hd-m-label' }, '详细内容'),
              react.createElement('textarea', { className: 'hd-content', value: content, placeholder: '记录详细内容…（可粘贴截图）', onChange: (e) => setContent(e.target.value) }),
            ),
            schedBlock,
            resultBlock,
            react.createElement('div', { className: 'hd-m-field' },
              react.createElement('span', { className: 'hd-m-label' }, '图片'),
              react.createElement('div', { ref: pasteRef, className: 'hd-pastehint' }, '📋 在框内 Ctrl/Cmd+V 粘贴截图，自动添加到下方'),
              images.length > 0
                ? react.createElement('div', { className: 'hd-imgs' }, imgNodes)
                : react.createElement('div', { className: 'hd-empty' }, '暂无图片'),
            ),
          ),
          react.createElement('div', { className: 'hd-m-footer' },
            err ? react.createElement('span', { className: 'hd-m-err' }, err) : null,
            react.createElement('button', { className: 'hd-btn', onClick: onClose, disabled: busy }, '取消'),
            react.createElement('button', { className: 'hd-btn hd-btn-primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
          ),
        ),
      );
    }

    // ---------------------------------------------------------- 面板组件
    function HelloPanel(props) {
      const [open, setOpen] = useState(false);
      const [notes, setNotes] = useState(null);
      const [stats, setStats] = useState(null);
      const [text, setText] = useState('');
      const [content, setContent] = useState('');   // 新建时的内容
      const [showContent, setShowContent] = useState(false); // 是否展开内容框
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState(null);
      const inputRef = useRef(null);
      const panelRef = useRef(null);
      // 可拖动偏移
      const [pos, setPos] = useState({ x: 0, y: 0 });
      // 当前打开的详情笔记（null = 未打开）
      const [editing, setEditing] = useState(null);
      // 当前打开的定时设置笔记（null = 未打开）
      const [scheduling, setScheduling] = useState(null);
      // 倒计时/通知监控的"心跳"：每次自增触发重渲染
      const [tick, setTick] = useState(0);

      const onHeaderDown = (e) => {
        if (e.button !== 0) return;
        const startX = e.clientX, startY = e.clientY;
        const baseX = pos.x, baseY = pos.y;
        const el = panelRef.current;
        const onMove = (ev) => {
          let nx = baseX + (ev.clientX - startX);
          let ny = baseY + (ev.clientY - startY);
          // 靠近边缘/任务栏时把它夹紧在可视区内，防止拖丢。面板是
          // position:fixed;top:64px;right:16px + translate(x,y)，这里按
          // 反方向换算：translate 只能把面板从视觉上往(css)位置偏移，
          // 所以 clamp 目标是让面板主体的可见部分始终留在视口内。
          if (el) {
            const r = el.getBoundingClientRect();
            const baseR = { left: r.left - baseX, top: r.top - baseY, width: r.width, height: r.height };
            const vw = window.innerWidth, vh = window.innerHeight;
            // 视觉上有 margin 遗留在屏幕内的最小安全边
            const minX = 20 - baseR.left;
            const maxX = vw - 20 - (baseR.left + baseR.width);
            const minY = 20 - baseR.top;
            const maxY = vh - 20 - (baseR.top + baseR.height);
            nx = Math.max(minX, Math.min(maxX, nx));
            ny = Math.max(minY, Math.min(maxY, ny));
          }
          setPos({ x: nx, y: ny });
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.userSelect = '';
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.userSelect = 'none';
        e.preventDefault();
      };

      const load = () => {
        Promise.all([
          fetch('/dsh-localnote/notes').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
          fetch('/dsh-localnote/stats').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
        ]).then(([n, s]) => {
          setNotes(n.notes);
          setStats(s);
        }).catch((e) => setErr(String(e && e.message ? e.message : e)));
      };

      useEffect(() => {
        if (!open) return;
        setErr(null);
        load();
      }, [open]);

      // 常驻监控：无论面板是否打开，定期刷新倒计时 + 检查到点笔记并发通知。
      // 每 15 秒一次。通知去重用 localStorage（noteId:dueAt），跨刷新不重复。
      useEffect(() => {
        let live = true;
        const check = () => {
          fetch('/dsh-localnote/notes').then((r) => r.ok ? r.json() : { notes: [] })
            .then((res) => {
              if (!live) return;
              const list = res.notes || [];
              const now = Date.now();
              for (const n of list) {
                if (!n.schedule || !n.schedule.dueAt) continue;
                const dueMs = new Date(n.schedule.dueAt).getTime();
                if (dueMs > now) continue; // 未到点
                // host 已处理过（fired）的笔记不再弹通知，避免刷新后重复提醒
                if (n.fired) continue;
                // localStorage 去重：同一笔记+同一到期时间只弹一次
                if (!claimNotify(n)) continue;
                notifyDue(n);
              }
            })
            .catch(() => { /* ignore */ });
          if (live) setTick((t) => t + 1); // 触发倒计时重渲染
        };
        check();
        const t = setInterval(check, 15000);
        return () => { live = false; clearInterval(t); };
      }, []);

      const addNote = () => {
        const t = text.trim();
        if (!t || busy) return;
        setBusy(true); setErr(null);
        const body = { text: t };
        const c = content.trim();
        if (c) body.content = c;
        fetch('/dsh-localnote/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(() => { setText(''); setContent(''); setShowContent(false); load(); })
          .catch((e) => setErr(String(e && e.message ? e.message : e)))
          .finally(() => setBusy(false));
      };

      const toggle = (id) => {
        fetch('/dsh-localnote/notes/toggle', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); })
          .then(load)
          .catch((e) => setErr(String(e && e.message ? e.message : e)));
      };

      const del = (id) => {
        fetch('/dsh-localnote/notes', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); })
          .then(load)
          .catch((e) => setErr(String(e && e.message ? e.message : e)));
      };

      const onKey = (e) => { if (e.key === 'Enter') addNote(); };

      const openEdit = (note) => setEditing(note);
      const openSched = (note) => setScheduling(note);

      // 笔记行里的定时状态胶囊
      const schedBadge = (n) => {
        if (!n.schedule || !n.schedule.dueAt) return null;
        if (n.error) return react.createElement('span', { className: 'hd-sched hd-err', title: n.error }, '⚠ 出错了');
        if (n.result) return react.createElement('span', { className: 'hd-sched hd-done2', title: '任务已执行' }, '✨ 已执行');
        if (n.processedAt) return react.createElement('span', { className: 'hd-sched hd-done2', title: '已到点' }, '✅ 已到点');
        return react.createElement('span', { className: 'hd-sched hd-fresh', title: '到期 ' + fmtDateTime(n.schedule.dueAt) },
          '⏰ ' + dueLabel(n.schedule.dueAt));
      };

      const body = !open ? null : react.createElement('div', { ref: panelRef, className: 'hd-panel', style: { transform: 'translate(' + pos.x + 'px,' + pos.y + 'px)' } },
        react.createElement('div', { className: 'hd-header', onMouseDown: onHeaderDown, title: '按住拖动面板' },
          react.createElement('span', { className: 'hd-title' }, '📝 灵感笔记'),
          react.createElement('button', { className: 'hd-close', onClick: () => setOpen(false) }, '✕'),
        ),
        react.createElement('div', { className: 'hd-slogan' }, '把"以后再说"的灵感，准时摆到你面前'),
        react.createElement('div', { className: 'hd-stats' },
          stats ? (stats.total + ' 条 · ' + stats.done + ' 已完成') : '…'
        ),
        react.createElement('div', { className: 'hd-list' },
          err
            ? react.createElement('div', { className: 'hd-empty' }, '出错了: ' + err)
            : !notes
              ? react.createElement('div', { className: 'hd-empty' }, '加载中…')
              : notes.length === 0
                ? react.createElement('div', { className: 'hd-empty' }, '还没有灵感，记一条吧')
                : notes.map((n) => react.createElement('div', { key: n.id, className: 'hd-row' },
                    react.createElement('button', {
                      className: 'hd-check' + (n.done ? ' hd-on' : ''),
                      onClick: () => toggle(n.id),
                      title: n.done ? '标记为未完成' : '标记为完成',
                    }, n.done ? '✓' : ''),
                    react.createElement('div', { className: 'hd-main' },
                      react.createElement('div', { className: 'hd-text' + (n.done ? ' hd-done' : ''), onClick: () => openEdit(n), title: '点击查看详情' }, n.text),
                      react.createElement('div', { className: 'hd-sub' },
                        react.createElement('span', { className: 'hd-detailbtn', onClick: () => openEdit(n), title: '查看/编辑笔记详情' }, '📄 详情'),
                        react.createElement('span', { className: 'hd-sched hd-fresh', onClick: () => openSched(n), title: '设置/修改定时' }, '⚙ 定时'),
                        schedBadge(n),
                        (n.images && n.images.length > 0)
                          ? react.createElement('span', { className: 'hd-count' }, '🖼' + n.images.length)
                          : null,
                      ),
                    ),
                    react.createElement('button', { className: 'hd-del', onClick: () => del(n.id), title: '删除' }, '✕'),
                  )),
        ),
        react.createElement('div', { className: 'hd-inputbar', style: { flexDirection: 'column', alignItems: 'stretch', gap: 6 } },
          react.createElement('div', { style: { display: 'flex', gap: 6 } },
            react.createElement('input', {
              ref: inputRef,
              className: 'hd-input',
              value: text,
              placeholder: '记一条灵感…',
              onChange: (e) => setText(e.target.value),
              onKeyDown: onKey,
            }),
            react.createElement('button', { className: 'hd-add', onClick: addNote, disabled: busy || !text.trim() }, '添加'),
          ),
          showContent
            ? react.createElement('textarea', {
                className: 'hd-content',
                value: content,
                placeholder: '想得越细越好…（可粘贴截图，添加后可在详情中补图）',
                onChange: (e) => setContent(e.target.value),
                style: { minHeight: 60 },
              })
            : null,
          react.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
            react.createElement('button', {
              type: 'button',
              className: 'hd-sched hd-fresh',
              onClick: () => setShowContent(!showContent),
              title: showContent ? '收起内容' : '展开内容',
            }, showContent ? '▲ 收起内容' : '▼ 内容'),
          ),
        ),
      );

      const pill = react.createElement('button', {
        className: 'hd-pill',
        onClick: () => setOpen(!open),
        style: { transform: 'translate(' + pos.x + 'px,' + pos.y + 'px)' },
        title: open ? '关闭' : '打开灵感笔记面板',
      }, open ? '关闭' : '📝 灵感');
      const modal = editing
        ? react.createElement(NoteModal, { note: editing, onClose: () => setEditing(null), onSaved: load })
        : null;
      const schedModal = scheduling
        ? react.createElement(ScheduleModal, { note: scheduling, onClose: () => setScheduling(null), onSaved: load })
        : null;
      return react.createElement('div', null,
        pill,
        body,
        modal,
        schedModal,
      );
    }

    // ---------------------------------------------------------- 插件主体
    const inject = ['slots'];

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-localnote',
      }, (props) => react.createElement(HelloPanel, Object.assign({}, props, {
        connection: ctx.get('connection'),
      }))));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

/**
 * dsh-localnote — 浏览器端（client.js）
 *
 * dsh 客户端插件：在 shell.overlay 槽位注册一个"笔记"面板浮窗。
 * 每张笔记 = 标题(text) + 详情文本(content) + 若干图片(images)。
 *
 * - 列出笔记（GET /dsh-localnote/notes）
 * - 新建标题（POST /dsh-localnote/notes）
 * - 切换完成态（PATCH /dsh-localnote/notes/toggle）
 * - 删除笔记（DELETE /dsh-localnote/notes）
 * - 更新详情（PATCH /dsh-localnote/notes）
 * - 上传图片（POST /dsh-localnote/notes/images）— 支持截屏粘贴
 * - 删除图片（DELETE /dsh-localnote/notes/images）
 * - 读图（GET /dsh-localnote/images/:file）
 *
 * 点笔记标题 → 打开模态详情框：多行文本编辑 + 粘贴截图成图片库。
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
.hd-panel{position:fixed;top:64px;right:16px;z-index:9990;width:300px;max-height:70vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:rgba(15,18,26,.96);border:1px solid rgba(255,255,255,.14);color:#e5e7eb;box-shadow:0 8px 32px rgba(0,0,0,.5);backdrop-filter:blur(10px);font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;pointer-events:auto}
.hd-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex:none;cursor:move;user-select:none}
.hd-title{font-weight:700;color:#22d3ee;white-space:nowrap}
.hd-close{background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:14px;line-height:1;padding:2px 6px;border-radius:6px}
.hd-close:hover{color:#fff;background:rgba(255,255,255,.08)}
.hd-stats{padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.06);color:#9ca3af;font-size:11px;flex:none}
.hd-list{overflow-y:auto;padding:6px;flex:1 1 auto}
.hd-empty{padding:16px 10px;text-align:center;color:#6b7280}
.hd-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}
.hd-row:hover{background:rgba(255,255,255,.05)}
.hd-check{flex:none;width:16px;height:16px;border-radius:4px;border:1px solid #4b5563;background:transparent;cursor:pointer;color:transparent;font-size:11px;line-height:14px;text-align:center}
.hd-check.hd-on{background:#22d3ee;border-color:#22d3ee;color:#0f121a}
.hd-text{flex:1 1 auto;word-break:break-word;cursor:pointer}
.hd-text:hover{color:#22d3ee}
.hd-text.hd-done{color:#6b7280;text-decoration:line-through}
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
.hd-modal-card{width:520px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;border-radius:14px;background:rgba(18,22,32,.98);border:1px solid rgba(255,255,255,.16);color:#e5e7eb;box-shadow:0 24px 64px rgba(0,0,0,.6);backdrop-filter:blur(12px);font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;overflow:hidden}
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
.hd-m-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.1);flex:none}
.hd-m-err{color:#ff6b6b;font-size:11px;margin-right:auto}
.hd-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#e5e7eb;padding:6px 14px;cursor:pointer;font:inherit}
.hd-btn:hover{background:rgba(255,255,255,.14)}
.hd-btn-primary{background:#22d3ee;border:none;color:#0f121a;font-weight:700}
.hd-btn-primary:hover{background:#67e8f9}
.hd-btn:disabled{opacity:.5;cursor:not-allowed}
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
            react.createElement('div', { ref: pasteRef, className: 'hd-pastehint' },
              '📋 在框内 Ctrl/Cmd+V 粘贴截图，自动添加到下方'),
            images.length > 0
              ? react.createElement('div', { className: 'hd-imgs' }, imgNodes)
              : react.createElement('div', { className: 'hd-empty' }, '暂无图片'),
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
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState(null);
      const inputRef = useRef(null);
      // 可拖动偏移
      const [pos, setPos] = useState({ x: 0, y: 0 });
      // 当前打开的详情笔记（null = 未打开）
      const [editing, setEditing] = useState(null);

      const onHeaderDown = (e) => {
        if (e.button !== 0) return;
        const startX = e.clientX, startY = e.clientY;
        const baseX = pos.x, baseY = pos.y;
        const onMove = (ev) => { setPos({ x: baseX + (ev.clientX - startX), y: baseY + (ev.clientY - startY) }); };
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

      const addNote = () => {
        const t = text.trim();
        if (!t || busy) return;
        setBusy(true); setErr(null);
        fetch('/dsh-localnote/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: t }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(() => { setText(''); load(); })
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

      const body = !open ? null : react.createElement('div', { className: 'hd-panel', style: { transform: 'translate(' + pos.x + 'px,' + pos.y + 'px)' } },
        react.createElement('div', { className: 'hd-header', onMouseDown: onHeaderDown, title: '按住拖动面板' },
          react.createElement('span', { className: 'hd-title' }, '📝 dsh-localnote 笔记'),
          react.createElement('button', { className: 'hd-close', onClick: () => setOpen(false) }, '✕'),
        ),
        react.createElement('div', { className: 'hd-stats' },
          stats ? (stats.total + ' 条 · ' + stats.done + ' 已完成') : '…'
        ),
        react.createElement('div', { className: 'hd-list' },
          err
            ? react.createElement('div', { className: 'hd-empty' }, '出错了: ' + err)
            : !notes
              ? react.createElement('div', { className: 'hd-empty' }, '加载中…')
              : notes.length === 0
                ? react.createElement('div', { className: 'hd-empty' }, '还没有笔记，加一条吧')
                : notes.map((n) => react.createElement('div', { key: n.id, className: 'hd-row' },
                    react.createElement('button', {
                      className: 'hd-check' + (n.done ? ' hd-on' : ''),
                      onClick: () => toggle(n.id),
                      title: n.done ? '标记为未完成' : '标记为完成',
                    }, n.done ? '✓' : ''),
                    react.createElement('span', {
                      className: 'hd-text' + (n.done ? ' hd-done' : ''),
                      onClick: () => openEdit(n),
                      title: '点击查看详情',
                    }, n.text),
                    (n.images && n.images.length > 0)
                      ? react.createElement('span', { className: 'hd-count' }, '🖼' + n.images.length)
                      : null,
                    react.createElement('button', { className: 'hd-del', onClick: () => del(n.id), title: '删除' }, '✕'),
                  )),
        ),
        react.createElement('div', { className: 'hd-inputbar' },
          react.createElement('input', {
            ref: inputRef,
            className: 'hd-input',
            value: text,
            placeholder: '加一条笔记标题…',
            onChange: (e) => setText(e.target.value),
            onKeyDown: onKey,
          }),
          react.createElement('button', { className: 'hd-add', onClick: addNote, disabled: busy || !text.trim() }, '添加'),
        ),
      );

      const pill = react.createElement('button', { className: 'hd-pill', onClick: () => setOpen(!open), style: { transform: 'translate(' + pos.x + 'px,' + pos.y + 'px)' } },
        open ? '关闭' : '📝 笔记');
      const modal = editing
        ? react.createElement(NoteModal, { note: editing, onClose: () => setEditing(null), onSaved: load })
        : null;
      return react.createElement('div', null, pill, body, modal);
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

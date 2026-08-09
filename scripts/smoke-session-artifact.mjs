// smoke test: session-store 产物消息持久化（artifact 字段必须完整存取）
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createSession, appendMessage, getSessionMessages, deleteSession } from '../src/chat/session-store.js';

let fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ': ' + name); if (!ok) fail++; };

// 用临时 HOME 隔离测试，避免污染真实 ~/.BizOwl
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'bizowl-session-test-'));
process.env.HOME = TMP_HOME;

const session = createSession('产物持久化测试');
const sid = session.id;
check('会话创建成功', !!sid);

// 模拟产物消息（与 chat.js onChatArtifact 里构造的结构一致）
const artifactMsg = {
  role: 'artifact',
  artifact: {
    id: 'art_test_001',
    kind: 'pdf',
    title: '2026 低空经济行业研究报告',
    filePath: '/tmp/fake-report.pdf',
    format: 'pdf',
    size: 256000,
    createdAt: Date.now(),
    source: 'report_export',
  },
  timestamp: new Date().toISOString(),
};
appendMessage(sid, artifactMsg);

// 也加一条普通助手消息，确认混排不影响
appendMessage(sid, { role: 'assistant', content: '报告已生成', timestamp: new Date().toISOString() });

// 读回
const msgs = getSessionMessages(sid);
check('消息总数 = 2', msgs.length === 2);
const loadedArt = msgs.find((m) => m.role === 'artifact');
check('产物消息存在', !!loadedArt);
check('artifact 对象完整保留', !!loadedArt && !!loadedArt.artifact);
check('artifact.title 正确', loadedArt?.artifact?.title === '2026 低空经济行业研究报告');
check('artifact.filePath 正确', loadedArt?.artifact?.filePath === '/tmp/fake-report.pdf');
check('artifact.format 正确', loadedArt?.artifact?.format === 'pdf');
check('artifact.size 正确', loadedArt?.artifact?.size === 256000);
check('artifact.source 正确', loadedArt?.artifact?.source === 'report_export');

// 清理
deleteSession(sid);
try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch {}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);

# AGENTS-zh.md

## 架构补充（当前有效）

- `apps/agent-runtime/src/graph/workflow.ts` 是 LangGraph 主图入口。Conversation Agent 产出 `user-input-complete` 后，后续 Request Agent、ProductDirector、Planner 和 Executor 流程必须经由该图编排，不要重新在 Conversation Agent 中直接串联这些 Agent。
- 当前 LangGraph 主流程为 `parse_user_input -> request_agent -> product_workflow`。新增工作流阶段时，应新增 LangGraph 节点和边，而不是在单个 Agent 目录内硬编码调用链。
- 保留 `/api/chat/stop`。前端点击停止时必须先调用该接口，让 API 触发服务端 `AbortController` 并把 `AbortSignal` 传给模型供应商请求，然后再中止浏览器侧 SSE fetch。
- `request_form.status` 需要随处理阶段更新，例如 `received`、`conversation_consumed`、`request_agent_running`、`request_analyzed`、`workflow_running`、`pending_user_confirmation`、`completed`、`stopped`、`failed`。
- `request_form_item.status` 也必须随用户可见决策更新。用户提交补充信息确认表单后，对应 `decision` 条目以及它引用的所有 `proposal` 条目都应标记为 `finish`，并把回答内容写入各自 `payload`。
- proposal 聚合必须保留来源身份。即使问题文本相同，只要 `source_task_id` 或 `source_agent` 不同，就代表不同的待确认 proposal，不能按文本去重，也不能用固定数量截断隐藏有效条目。

## 瑙掕壊

浣滀负 `meta-pm-agent` monorepo 鐨勫姟瀹炲瀷杞欢宸ョ▼浠ｇ悊寮€灞曞伐浣溿€備慨鏀瑰墠鍏堢悊瑙ｇ幇鏈夋灦鏋勶紝閬靛惊椤圭洰宸叉湁妯″紡锛屽苟鎶婃敼鍔ㄤ弗鏍奸檺鍒跺湪鐢ㄦ埛瑕佹眰鐨勭洰鏍囪寖鍥村唴銆?
## 鐩爣

浜や粯姝ｇ‘銆佸彲缁存姢锛屽苟鑳借瀺鍏ュ綋鍓?pnpm workspace銆乀urbo 鏋勫缓鍥俱€乀ypeScript 閰嶇疆銆佹暟鎹簱鎸佷箙鍖栨ā鍨嬨€丼SE 鍗忚鍜屽簲鐢ㄨ竟鐣岀殑鏀瑰姩銆傚湪鏈湴鐜鍏佽鐨勬儏鍐典笅锛屽畬鎴愬疄鐜板拰鐩稿簲楠岃瘉銆?
## 閲嶈瑙勫垯

- 浣跨敤鏍圭洰褰?`packageManager` 瀛楁寮哄埗鎸囧畾鐨?`pnpm` v11.3.0銆?- Workspace 鑼冨洿鏄?`apps/*` 鍜?`packages/*`銆?- Turbo 璐熻矗浠诲姟缂栨帓銆俙pnpm build` 浼氳繍琛?`turbo run build`锛屽苟閫氳繃 `dependsOn: ["^build"]` 纭繚鍏堟瀯寤?packages锛屽啀鏋勫缓 apps銆?- 杩愯搴旂敤寮€鍙戣剼鏈墠蹇呴』鍏堟瀯寤哄叡浜寘锛屽洜涓哄悇鍖呭叆鍙ｆ寚鍚?`dist/`锛岃€屼笉鏄?TypeScript 婧愮爜銆傞娆℃墽琛?`pnpm dev` 鍓嶈嚦灏戣繍琛屼竴娆?`pnpm build`銆?- 涓嶈鎻愪氦 `dist/`锛涚敓鎴愮殑鏋勫缓浜х墿宸茶 Git 蹇界暐銆?- 鏍圭洰褰曞強 Node.js 搴旂敤/鍖呬娇鐢?TypeScript 6.0.3銆傜敱浜?`baseUrl` 宸插簾寮冿紝鍩虹閰嶇疆涓殑 `ignoreDeprecations: "6.0"` 蹇呴』淇濈暀銆?- `apps/web` 浣跨敤 TypeScript 5.8.3锛屽苟鎷ユ湁鐙珛鐨?`baseUrl`銆乣paths` 鍜?`noEmit: true` 閰嶇疆銆備笉瑕佸崌绾у畠鐨?TypeScript 鐗堟湰銆?- `apps/web` 褰撳墠浣跨敤 React銆乂ite 鍜?Ant Design 6銆傚鐞嗗墠绔椂淇濈暀 Ant Design 6 鐨勫鍏ユ柟寮忓拰缁勪欢 API銆?- `packages/shared`銆乣packages/database` 鍜?`apps/agent-runtime` 浣跨敤 TypeScript project references锛屽苟鍚敤 `composite: true`銆傛柊澧炲彲瀵煎叆鍏变韩鍖呮椂閬靛惊姝ゆā寮忋€?- 淇濈暀 `packages/database/tsconfig.json` 涓殑 `"types": ["node"]`锛宲npm 涓ユ牸闅旂涓嶄細鑷姩鏆撮湶 `@types/node`銆?- `apps/agent-runtime/src/graph.ts` 鍘嗗彶涓婂瓨鍦ㄧ敱 `@langchain/langgraph` 鐗堟湰涓嶅尮閰嶅紩璧风殑 LangGraph typed-state API 绫诲瀷闂銆傚垎鏋愬寘绾?TypeScript 澶辫触鏃堕渶瑕佽€冭檻杩欎竴鐐广€?- `apps/web` 閫氳繃 `eslint-config-next` 閰嶇疆 ESLint锛涘鏋滄湰鍦扮己灏?Next 鐨?compiled parser 鍖咃紝lint 鍙兘澶辫触銆傛牴鐩綍 Turbo 鐨?lint 鍜?typecheck 浠诲姟褰撳墠娌℃湁瀹屾暣鐢熸晥鑴氭湰銆?
## 搴旂敤杈圭晫

淇濇寔浠ヤ笅鍖呬笌搴旂敤杈圭晫锛?
```text
apps/
  agent-runtime/   鍩轰簬 LangGraph/DeepAgents 鐨?PM Runtime锛圢ode.js锛宑omposite TypeScript锛?  api/             Hono HTTP API 鏈嶅姟锛堢鍙?3001锛孲SE 娴佸紡鍝嶅簲锛孭risma 鎸佷箙鍖栵級
  web/             Vite + React + Ant Design 6 鍓嶇锛圱ypeScript 5.8.3锛屾祬鑹蹭富棰橈級
  worker/          BullMQ Redis Worker
packages/
  shared/          鍏变韩绫诲瀷銆乑od Schema銆丏TO銆丄gent 鐘舵€?鍥?杩愯鏃剁被鍨?  database/        浠?dist/ 瀵煎嚭鐨?Prisma Client 鍗曚緥
```

- 浣跨敤 `.env` 绠＄悊鏈湴閰嶇疆銆傚鍒?`.env.example` 骞跺～鍐?`DATABASE_URL`銆丷edis 閰嶇疆銆乣OPENAI_API_KEY`銆乣LLM_MODEL` 鍜?`LLM_BASE_URL`銆?- Prisma 鍛戒护蹇呴』鍦?`packages/database` 涓嬭繍琛岋細`pnpm db:generate`銆乣pnpm db:push` 鎴?`pnpm db:migrate`銆?- 鏋勫缓 `@repo/database` 鍓嶅繀椤绘墽琛?`prisma generate`锛沗pnpm-workspace.yaml` 涓殑 `allowBuilds` 璐熻矗澶勭悊瀹夎闃舵鐨勮椤硅姹傘€?- 淇濇寔宸ヤ綔鍖?鑱婂ぉ璺敱鐨勫綋鍓嶅垝鍒嗭細`/workplace`銆乣/chat/:workspaceId`銆乣/chat/:workspaceId/:threadId`銆?- 鏍囧噯 Web 鐜涓殑鐩綍閫夋嫨鏃犳硶鍙潬鏆撮湶瀹屾暣缁濆璺緞銆備繚鐣欏彲缂栬緫璺緞杈撳叆锛屽苟鍦ㄥ彲鐢ㄦ椂淇濈暀瀹夸富鐜鎻愪緵鐨?`file.path` 澶勭悊銆?- 闄ら潪浠诲姟纭湁闇€瑕侊紝涓嶈淇敼渚濊禆鐗堟湰銆佺敓鎴愭枃浠躲€佹棤鍏虫ā鍧楁垨浠撳簱绾ч厤缃€?
## Web 结构规则

- 保持 `apps/web/src/App.tsx` 作为应用外壳。它负责串联 Provider、顶层状态、路由和页面选择，但不要堆积页面 JSX、API 客户端、SSE 读取器或 DTO 映射逻辑。
- 浏览器侧 API 调用放在 `apps/web/src/api/`。
- 共享 UI 常量和本地偏好 key 放在 `apps/web/src/constants/`。
- DTO 到视图模型的恢复逻辑放在 `apps/web/src/mappers/`。
- 路由级页面实现放在 `apps/web/src/pages/<page-name>/`，例如 `pages/workplace/` 和 `pages/chat/`。
- 路径解析和 History 辅助函数放在 `apps/web/src/router/`。
- 流事件 reducer、Markdown 工具和结构化块解析器放在 `apps/web/src/utils/`。
- 共享 React 视图组件放在 `apps/web/src/components/`，可复用弹窗放在 `apps/web/src/components/modals/`，可复用 Hook 放在 `apps/web/src/hooks/`。
- 在继续向 `App.tsx` 增加代码前，优先把逻辑移动到这些职责清晰的模块中。
- 助手消息 Markdown 渲染保持在 `apps/web/src/utils/markdown.tsx`；需要保留标准管道表格、链接、列表、代码块和行内强调的解析能力，不要改用 `dangerouslySetInnerHTML`。
## 联网搜索与工具授权

- `/api/chat` 请求体可以携带 `enabledTools`，当前只支持 `["web_search"]`。新增工具名称时先更新 `packages/shared` 中的共享 schema，再更新 API 校验和 runtime 使用方。
- 运行时工具权限统一放在 `apps/agent-runtime/src/agents/common/tool-access.ts`。当前 `web_search` 只授权给 Conversation Agent；后续要允许 Request Agent 或其他 Agent 使用联网搜索时，只在该集中授权表中扩展，不要在单个 Agent 内部绕过授权。
- `web_search` 的具体实现位于 `apps/agent-runtime/src/agents/common/web-search-tool.ts`。配置 `TAVILY_API_KEY` 时优先使用 Tavily Search；未配置时使用 Hacker News Algolia、OpenAlex 等免费公开索引作为无额外搜索依赖的兜底。
- 联网搜索后端不可用、超时或网络失败时，工具必须返回结构化结果，例如 `results: []` 和 `error` 字段，而不是抛出异常，避免中断 `/api/chat` SSE 流。
- 转发 `tool-call` 和 `tool-result` 事件时保留 `agentType`，方便后续多 Agent 工具调用在前端按来源展示。
## 前端展示补充

- 工具调用明细（包括 `web_search` 结果）应通过 `ToolCallsCard` 以折叠卡片展示在对应助手消息附近。
- `ToolCallsCard`、`UserInputCard` 和 `RequestAnalysisCard` 默认折叠，让中间数据可追溯但不挤占普通助手正文。
## 鑱婂ぉ鍜?Agent 鍗忚

- 淇濇寔 `/api/chat` 鐨?SSE 鍗忚銆傛帴鍙ｈ繑鍥?`text/event-stream`锛屼簨浠剁被鍨嬪寘鎷?`start`銆乣text`銆乣thinking`銆乣question-form-start`銆乣question-form-complete`銆乣user-input-start`銆乣user-input-complete`銆乣request-analysis-start`銆乣request-analysis-complete`銆乣todo-update`銆乣tool-call`銆乣tool-result`銆乣step-finish`銆乣finish` 鍜?`error`銆?- `thinking` 浜嬩欢鍙互鎼哄甫 `agentType`銆傝浆鍙戞垨杞崲娴佷簨浠舵椂蹇呴』淇濈暀璇ュ瓧娈点€?- Conversation Agent 鐨勬祦鐗囨浣跨敤 `agentType: "conversation"`銆?- Request Agent 鐨勬祦鐗囨浣跨敤 `agentType: "request"`銆?- 鍚庣画鏂板 Agent 鏃讹紝闇€瑕佸垎閰嶇ǔ瀹氱殑 `agentType`锛屽苟鍦?runtime 浜嬩欢銆丄PI 鎸佷箙鍖栧拰鍓嶇娓叉煋涓繚鎸佷竴鑷淬€?- `apps/agent-runtime` 浼氬湪杈撳嚭鐢ㄦ埛鍙 `text` 鍓嶈繃婊?`No files found in /` 绛?DeepAgent/杩愯鐜鍐呴儴鍣０銆備笉瑕佹妸鍐呴儴宸ュ叿鎴栫幆澧冨櫔澹伴噸鏂板紩鍏ユ櫘閫氬姪鎵嬫鏂囥€?
## 鎸佷箙鍖栬鍒?
- API 閫氳繃 Prisma/PostgreSQL 鎸佷箙鍖栬处鍙枫€佸伐浣滃尯銆佷細璇濄€佹秷鎭拰璇锋眰琛ㄥ崟鏁版嵁銆?- 鎸佷箙鍖栨暟鎹簲閫氳繃 API 鍔犺浇锛歚/api/account`銆乣/api/workspaces`銆乣/api/chats`銆乣/api/chats/:id/messages`銆?- 涓嶈鎶婅亰澶╂秷鎭巻鍙叉寔涔呭寲鍒版祻瑙堝櫒 `localStorage`銆傛祻瑙堝櫒鏈湴瀛樺偍鍙兘鐢ㄤ簬闈炴潈濞?UI 鍋忓ソ锛屼緥濡傚綋鍓嶅伐浣滃尯 id銆?- 鐢ㄦ埛娑堟伅鍦?Agent 鎵ц鍓嶆寔涔呭寲銆?- Conversation Agent 鐨勫姪鎵嬭緭鍑哄繀椤讳互 `message.type = "conversation"` 鎸佷箙鍖栥€?- Request Agent 鐨勫姪鎵嬭緭鍑哄繀椤讳互 `message.type = "request"` 鎸佷箙鍖栥€?- Agent 鎺ㄧ悊杩囩▼蹇呴』鍐欏叆 `message.meta.reasoningContent`銆?- Conversation Agent 鏁寸悊鍑虹殑缁撴瀯鍖栫敤鎴疯緭鍏ュ啓鍏?`message.user_input`銆?- Request Agent 鍒嗘瀽缁撴灉蹇呴』淇濈暀鍦?request 绫诲瀷娑堟伅姝ｆ枃涓紝骞跺悓姝ュ啓鍏?request-form items銆?- 淇敼鎸佷箙鍖栬亰澶?宸ヤ綔鍖哄崗璁椂锛岄渶瑕佸悓姝ユ洿鏂?API schemas銆乺epositories銆乻ervices銆乺outes/controllers銆佸墠绔?types锛屼互鍙婂巻鍙叉秷鎭仮澶?娓叉煋閫昏緫銆?
## 鍓嶇灞曠ず瑙勫垯

- 鎺ㄧ悊杩囩▼搴斿睍绀哄湪瀹冩墍灞炵殑涓氬姟闃舵闄勮繎銆?- Conversation Agent 鎺ㄧ悊灞曠ず鍦ㄦ櫘閫氬姪鎵嬫秷鎭銆?- Request Agent 鎺ㄧ悊灞曠ず鍦ㄢ€滅敤鎴疯緭鍏ユ暣鐞嗏€濅箣鍚庛€佲€淩equest Agent 鍒嗘瀽鈥濅箣鍓嶃€?- 鍚庣画鏂板 Agent 鏃讹紝缁х画鎸?`agentType` 鏀剧疆瀵瑰簲鎺ㄧ悊杩囩▼銆?- 鈥滅敤鎴疯緭鍏ユ暣鐞嗏€濆拰鈥淩equest Agent 鍒嗘瀽鈥濆崱鐗囬粯璁ゆ姌鍙犮€?- 鏂板鏍峰紡浼樺厛浣跨敤 Tailwind 宸ュ叿绫汇€傞櫎闈炴槑纭姹傛垨鏃犳硶閬垮厤锛屼笉瑕佸垱寤烘柊鐨?CSS/SCSS/Less/CSS Module 鏂囦欢銆?- 闄ら潪浠诲姟鏄庣‘闇€瑕侊紝涓嶈鏂板鍏ㄥ眬鏍峰紡瑙勫垯鎴栧唴鑱?`<style>`銆?
## 浠ｇ爜娉ㄩ噴瑙勫垯

鎵€鏈夌敓鎴愮殑鍚庣浠ｇ爜銆佸墠绔嚱鏁般€佺被銆佹湇鍔°€佷粨鍌ㄣ€丠ook銆丄gent銆佸伐浣滄祦鍜屽伐鍏峰嚱鏁伴兘蹇呴』鍖呭惈娉ㄩ噴銆?
- 浣跨敤绠€浣撲腑鏂囨敞閲娿€?- 绫汇€佸叿鏈変笟鍔″惈涔夌殑鎺ュ彛/绫诲瀷銆佸鍑哄嚱鏁般€佸叕鍏辨柟娉曘€丷eact Hook銆丼ervice銆丷epository銆丆ontroller銆丄gent 瀹炵幇銆丩angGraph 鑺傜偣鍜屽伐浣滄祦姝ラ浣跨敤 JSDoc銆?- 閲嶈涓氬姟閫昏緫銆佸垎鏀€佺姸鎬佽縼绉汇€佸浘杞崲鍜屽鏉傝绠椾娇鐢ㄥ崟琛屾敞閲娿€?- 娉ㄩ噴鎻忚堪涓氬姟鎰忓浘锛岃€屼笉鏄噸澶嶅疄鐜扮粏鑺傘€?- 閬垮厤 `// 瀹氫箟鍙橀噺` 杩欑被鏃犳剰涔夋敞閲娿€?
绀轰緥锛?
```ts
/**
 * 鑾峰彇褰撳墠宸ヤ綔鍖虹殑浜у搧涓婁笅鏂囥€? */
export async function getProductContext() {}

// 灏嗛渶姹傚垎鏋愮粨鏋滀氦缁?Planner Agent銆?graph.addEdge("request-agent", "planner-agent");
```

## 宸ヤ綔娴佺▼

1. 缂栬緫鍓嶉槄璇荤浉鍏虫簮鐮併€侀厤缃拰 package scripts銆?2. 妫€鏌ュ伐浣滄爲鐘舵€侊紝骞朵繚鐣欑敤鎴峰凡鏈夌殑鏃犲叧鏀瑰姩銆?3. 鎵惧嚭绗﹀悎浠撳簱鐜版湁妯″紡鐨勬渶灏忓畬鏁存敼鍔ㄣ€?4. 鍗忚鍙戠敓鍙樺寲鏃讹紝鍏堟洿鏂板叡浜被鍨嬫垨 Schema锛屽啀鏇存柊浣跨敤鏂广€?5. 杩愯渚濊禆鍏变韩鍖呯殑搴旂敤鎴栨祴璇曞墠锛屽厛鏋勫缓鎵€闇€鍏变韩鍖呫€?6. 浼樺厛鎵ц鑼冨洿鏈€灏忎絾鏈夋晥鐨勯獙璇侊紝鍐嶆牴鎹敼鍔ㄩ闄╂墿澶ч獙璇佽寖鍥淬€?7. 鍒嗘瀽 TypeScript 澶辫触鏃讹紝鑰冭檻 `apps/agent-runtime/src/graph.ts` 鐨勫凡鐭ョ被鍨嬮闄┿€?8. 鏈€缁堟鏌?diff锛屾帓闄ゆ剰澶栨敼鍔ㄣ€佺敓鎴愪骇鐗┿€佸瘑閽ユ硠闇层€佷緷璧栨紓绉诲拰鍗忚鍥炲綊銆?
## 杈撳嚭瑕佹眰

- 绠€瑕佽鏄庝慨鏀瑰唴瀹瑰強鍘熷洜銆?- 鍒楀嚭宸叉墽琛岀殑楠岃瘉鍛戒护鍙婂叾缁撴灉銆?- 璇存槑鏈兘鎵ц鐨勬祴璇曟垨妫€鏌ワ紝骞剁粰鍑哄叿浣撻樆濉炲師鍥犮€?- 鏄庣‘鍓╀綑椋庨櫓銆佸亣璁俱€佽縼绉绘楠ゆ垨蹇呰鐨勭幆澧冮厤缃€?- 鐩存帴寮曠敤鍙樻洿鏂囦欢锛屽苟淇濇寔鏈€缁堝洖澶嶇畝娲併€?

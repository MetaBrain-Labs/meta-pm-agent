1. 项目启动
用户打开软件后，可选择创建新项目或打开已有项目。
2. 模板选择（仅新项目）
若为新项目，弹出可关闭的模板选择窗口，用户从中选取所需的模板请求表单。
3. 对话发起
用户发起对话，对话内容存入数据库。
4. 首次传递
将请求表单（JSON 文件；若不存在或已完成则重新创建）和用户输入一并发送至 Conversation Agent。
5. Conversation Agent 处理
Conversation Agent 收到请求表单及用户输入后，按以下情形处理：  
● a. 若请求表单中存在待用户回答的问题，则向用户提问，流程在此暂停，返回步骤 3。  
● b. 若请求表单中包含与产品无关的杂谈内容，则直接回复用户。  
● c. 若请求表单中的产品设计任务已完成，则向用户发起确认（通过表单展示，用户可选：确认 / 退回 / 确认但补充）。  
  ○ 对于“确认但补充”，系统将生成一个全新的请求表单，而非在原表单上叠加修改。
随后，将用户输入拆解为若干条独立语句（可做轻微补充以保证语义完整、非病句），写入 user_input。
每条独立语句记录包含：  
● a. 序号
● b. 完整语句内容
● c. 类型（枚举：陈述 / 提问 / 补充 / 请求）
处理完成后，将结果发送给 Request Agent。
| 注意：Conversation Agent 完全不接触产品设计具体内容，仅负责拆解用户输入，以避免上下文污染导致
| 拆解产生偏向。  
6. 第一次程序校验
程序对以下内容进行检查：  
● a. 每条独立语句记录结构是否完整：序号、语句内容、类型均不得为空，且类型必须符合枚举值。  
● b. 请求表单中是否仍存在未回答的问题。
若任一检查不通过，流程暂停，将错误信息反馈给 Conversation Agent，并要求其重新发送。
7. Request Agent 处理
Request Agent 接收请求表单，读取产品上下文（概述性文档），对 user_input 下的独立语句逐条解析，并归类至以下三个部分：  
● a. 业务模型 (business_model)，可包含多条业务，每条业务包含：  
  ○ i. 序号  
  ○ ii. 用户目标  
  ○ iii. 目标约束（来源于用户输入，而非 Agent 自行生成，例如用户输入中“若 X，则 Y”里的 X）  
  ○ iv. 欠缺信息（由 Request Agent 提出它认为具有价值的缺失项），每条欠缺信息包括：  
    ⅰ. 序号  
    ⅱ. 描述  
    ⅲ. 重要程度（0–1 之间的数值，越高表示越重要，衡量标准：该问题能多大程度上减少关于用户真实目标的不确定性）
  ○ v. 覆盖的用户请求序号列表（一条业务可对应多条独立语句）
● b. Agent 问答 (questions)  
● c. 产品无关闲聊 (chitchat)
处理完成后，将结果发送给 ProductDirector Agent。
8. 第二次程序校验
程序对以下内容进行检查：  
● a. 每条业务记录结构是否完整：序号、用户目标、覆盖请求序号不得为空，所覆盖的序号必须存在；欠缺信息的重要程度数值需符合格式要求。  
● b. 是否存在未被覆盖或未处理的 user_input 语句。
若出现错误，流程暂停，向 Request Agent 反馈错误并要求重新发送。
若无错误且 chitchat 下存在新记录，则先由 Conversation Agent 回答闲聊内容，并告知用户业务正在执行中（过渡回复）。
9. ProductDirector Agent 调度
ProductDirector Agent 接收请求表单，按需读取产品上下文、产品设计知识图谱及联网调查结果，作出决策并执行相应动作：  
● a. 提出问题
若欠缺信息中存在值得转化，且 ProductDirector Agent 无法根据现有资料回答的问题，则编写 questions，罗列需向用户确认的问题，流程暂停，由 Conversation Agent 向用户提问，然后返回步骤 3。
一条问题包含：  
  ○ i. 序号  
  ○ ii. 问题内容  
  ○ iii. 用户回答（对应的独立语句序号）  
  ○ iv. 覆盖的欠缺信息序号
● b. 请求规划
向 Planner Agent 发起请求，依据 business_model 规划或更新有向无环图（DAG），详见步骤 10。  
● c. 任务派发
根据 task_execution 中的 DAG 向各 Executor Agent 按次序派发任务，并同步更新 task_execution 中的任务分配信息，详见步骤 11。  
  ○ i. 任务派发时，程序严格按照次序管理：仅当前一步未发生错误时，才发送下一步任务。
● d. 文档组装
向 Document Agent 请求组装所需文档，详见步骤 13。  
● e. 验收结果
验收 Planner Agent 及各 Executor Agent 的运行结果，并决定后续动作。  
● f. 总结工作
汇总本轮工作，更新产品上下文，再通过 Conversation Agent 向用户确认工作成果。  
  ○ i. 用户确认：程序按任务规划顺序自动将 Executor Agent 编写的知识图谱更新内容合并至产品知识图谱中，并将请求表单标记为已完成。  
  ○ ii. 用户退回：舍弃本次编写的更新，不执行合并。
● g. 其他任务
根据现有工具能力，可自由安排其他任务流程。
10. Planner Agent 规划
Planner Agent 收到 ProductDirector Agent 的请求及请求表单，基于 business_model 和现有产品设计，从零规划 DAG 或更新已有 DAG，并将结果写入/更新至 task_execution。  
task_execution 包含：  
● a. 序号  
● b. 任务流程图（DAG）  
● c. 任务分配（由 ProductDirector Agent 与 Executor Agent 共同维护）  
  ○ i. ID  
  ○ ii. 任务描述  
  ○ iii. 执行次序
  ○ iv. 负责 Agent  
  ○ v. 任务结果（由 Executor Agent 维护）  
    ⅰ. 思考部分
    ⅱ. 执行部分
    ⅲ. 错误部分
● d. 覆盖的业务（business_model）序号列表  
● e. 质量检测结果（由 Critique Agent 维护）
处理完成后，发送回 ProductDirector Agent。  
| 注意：Planner Agent 应仅专注于任务规划，仅知晓系统可执行能力，而不知晓存在哪些具体的 Executor Agent 以及其各自职责。
11. Executor Agent 执行任务
Executor Agent 接收 ProductDirector Agent 派发的任务，按<think>、<execute>、<error>分块输出思考、知识图谱更新内容及错误（如果有错），并 git 提交。
12. 第三次程序校验
程序检查知识图谱更新语句格式是否正确，并拆分 Executor Agent 的输出至task_execution的任务结果对应部分。
若出现错误，流程暂停，向 Executor Agent 反馈错误并要求重新发送。
13. Critique Agent 质量检查
● 单任务检查：Critique Agent 单独检查每个任务是否真实完成且有无出错。若发现错误，则向对应 Executor Agent 反馈并让其重试（同一任务设有重试次数上限）。  
● 全局检查：当所有任务全部完成且未出错后，Critique Agent 依据 DAG 及基于本次更新进行全局检查，评估本轮任务是否成功、是否呼应用户请求、是否与现有产品设计冲突，并将检查结果编写/更新至 task_execution 的质量检测结果字段。
● 元模型合规性：检查本轮所有新增节点和关系的类型、端点是否符合元模型定义。
● 溯源链完整性：本轮新增的“功能”是否能追溯到“决策”和“目标”？若溯源链中断，提出警告。
● 孤点检测：是否存在未被任何关系连接的孤立节点。
14. Document Agent 组装文档
Document Agent 接收 ProductDirector Agent 的请求，按需读取产品上下文及产品设计知识图谱，组装所需文档。处理完成后，回传至 ProductDirector Agent。
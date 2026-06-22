create table public.activity_log (
  id uuid primary key not null,
  user_id character varying(36),
  workspace_id character varying(36),
  entity_type character varying(50),
  entity_id character varying(36),
  action character varying(50),
  detail jsonb,
  created_at timestamp with time zone default CURRENT_TIMESTAMP
);

create table public.agent_run (
  id character varying(36) primary key not null,
  task_id character varying(36) not null,
  workspace_id character varying(36) not null,
  conversation_id character varying(36),
  agent_type character varying(50) not null,
  status character varying(30) default 'pending',
  input jsonb,
  output jsonb,
  error_message text,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  foreign key (task_id) references public.task (id)
  match simple on update no action on delete no action
);

create table public.artifact (
  id character varying(36) primary key not null,
  task_id character varying(36) not null,
  workspace_id character varying(36) not null,
  type character varying(50) not null,
  title character varying(255),
  content jsonb,
  version integer default 1,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  foreign key (task_id) references public.task (id)
  match simple on update no action on delete no action
);

create table public.conversation (
  id character varying(36) primary key not null,
  workspace_id character varying(36) not null,
  user_id character varying(36) not null,
  title character varying(255),
  type character varying(30) default 'chat',
  status character varying(20) default 'active',
  last_message_at timestamp with time zone,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  foreign key (user_id) references public."user" (id)
  match simple on update no action on delete no action,
  foreign key (workspace_id) references public.workspace (id)
  match simple on update no action on delete no action
);

create table public.message (
  id character varying(36) primary key not null,
  conversation_id character varying(36) not null,
  role character varying(20) not null,
  content text not null,
  meta jsonb,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  user_input jsonb,
  type character varying(20), -- 当role为assistant时，type指向其assistant的具体类型
  foreign key (conversation_id) references public.conversation (id)
  match simple on update no action on delete no action
);
comment on column public.message.type is '当role为assistant时，type指向其assistant的具体类型';

create table public.request_form (
  id character varying(36) primary key not null,
  chat_id character varying(36) not null,
  version integer not null default 1,
  status character varying(32) not null,
  summary text,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone default CURRENT_TIMESTAMP
);

create table public.request_form_item (
  id character varying(36) primary key not null,
  form_id character varying(36) not null,
  type character varying(32) not null,
  status character varying(32) not null,
  agent character varying(32),
  priority integer default 0,
  payload jsonb not null,
  parent_item_id character varying(36),
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone default CURRENT_TIMESTAMP,
  foreign key (form_id) references public.request_form (id)
  match simple on update no action on delete no action
);

create table public.product_knowledge_graph (
  id character varying(36) primary key not null,
  workspace_id character varying(36) not null,
  conversation_id character varying(36),
  request_form_id character varying(36),
  content text not null,
  version integer not null default 1,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone default CURRENT_TIMESTAMP,
  foreign key (workspace_id) references public.workspace (id)
  match simple on update no action on delete no action,
  foreign key (conversation_id) references public.conversation (id)
  match simple on update no action on delete set null,
  foreign key (request_form_id) references public.request_form (id)
  match simple on update no action on delete set null
);
create unique index product_knowledge_graph_workspace_id_key
  on public.product_knowledge_graph using btree (workspace_id);
comment on table public.product_knowledge_graph is '按工作区保存最终产品知识图谱，一个工作区只有一份当前图谱。';

create table public.task (
  id character varying(36) primary key not null,
  conversation_id character varying(36),
  workspace_id character varying(36) not null,
  user_id character varying(36) not null,
  type character varying(50) not null,
  status character varying(30) default 'pending',
  input jsonb,
  output jsonb,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone default CURRENT_TIMESTAMP,
  foreign key (conversation_id) references public.conversation (id)
  match simple on update no action on delete no action,
  foreign key (workspace_id) references public.workspace (id)
  match simple on update no action on delete no action
);

create table public."user" (
  id character varying(36) primary key not null,
  email character varying(255),
  username character varying(100),
  avatar text,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone default CURRENT_TIMESTAMP
);
create unique index user_email_key on "user" using btree (email);

create table public.workspace (
  id character varying(36) primary key not null,
  user_id character varying(36) not null,
  name character varying(255) not null,
  storage_type character varying(20) default 'local',
  local_path text,
  cloud_path text,
  sync_status character varying(20) default 'idle',
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone default CURRENT_TIMESTAMP,
  foreign key (user_id) references public."user" (id)
  match simple on update no action on delete no action
);


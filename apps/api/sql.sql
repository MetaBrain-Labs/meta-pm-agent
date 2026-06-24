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
  match simple on update cascade on delete restrict
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
  match simple on update cascade on delete restrict
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
  match simple on update cascade on delete restrict,
  foreign key (workspace_id) references public.workspace (id)
  match simple on update cascade on delete restrict
);

create table public.message (
  id character varying(36) primary key not null,
  conversation_id character varying(36) not null,
  role character varying(64) not null,
  content text not null,
  meta jsonb,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  user_input jsonb,
  type character varying(64), -- 当role为assistant时，type指向其assistant的具体类型
  foreign key (conversation_id) references public.conversation (id)
  match simple on update cascade on delete restrict
);
comment on column public.message.type is '当role为assistant时，type指向其assistant的具体类型';

create table public.product_knowledge_graph (
  id character varying(36) primary key not null,
  workspace_id character varying(36) not null,
  conversation_id character varying(36),
  request_form_id character varying(36),
  content text not null,
  version integer not null default 1,
  created_at timestamp with time zone default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone default CURRENT_TIMESTAMP,
  foreign key (conversation_id) references public.conversation (id)
  match simple on update no action on delete set null,
  foreign key (request_form_id) references public.request_form (id)
  match simple on update no action on delete set null,
  foreign key (workspace_id) references public.workspace (id)
  match simple on update no action on delete no action
);
create unique index product_knowledge_graph_workspace_id_key on product_knowledge_graph using btree (workspace_id);

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
  match simple on update cascade on delete restrict
);

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
  match simple on update cascade on delete set null,
  foreign key (workspace_id) references public.workspace (id)
  match simple on update cascade on delete restrict
);

create table public.task_execution (
  id character varying(36) primary key not null,
  conversation_id character varying(36) not null,
  request_form_id character varying(36),
  task_id character varying(64) not null,
  sequence integer not null,
  dag jsonb not null,
  assigned_agent character varying(32) not null,
  title character varying(255) not null,
  description text not null,
  covered_business_model_indexes jsonb not null,
  quality_result jsonb not null,
  status character varying(32) not null default 'planned',
  created_at timestamp(6) with time zone default now(),
  updated_at timestamp(6) with time zone default now()
);
create unique index task_execution_conversation_id_task_id_key on task_execution using btree (conversation_id, task_id);

create table public.token_usage (
  id character varying(36) primary key not null,
  conversation_id character varying(36) not null,
  message_id character varying(36),
  agent_type character varying(50) not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_input numeric(12,8) not null default 0,
  cost_output numeric(12,8) not null default 0,
  cost_total numeric(12,8) not null default 0,
  duration_ms integer,
  created_at timestamp with time zone not null default now(),
  cache_hit_input_tokens integer not null default 0,
  cache_miss_input_tokens integer not null default 0,
  foreign key (conversation_id) references public.conversation (id)
  match simple on update no action on delete cascade,
  foreign key (message_id) references public.message (id)
  match simple on update no action on delete set null
);
create index idx_token_usage_conversation on token_usage using btree (conversation_id);
create index idx_token_usage_message on token_usage using btree (message_id);
create index idx_token_usage_agent_type on token_usage using btree (conversation_id, agent_type);

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
  match simple on update cascade on delete restrict
);


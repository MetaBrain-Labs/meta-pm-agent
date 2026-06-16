create table public.chat (
  id character varying(36) primary key not null,
  title character varying(255),
  status character varying(32) default 'active',
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  updated_at timestamp without time zone default CURRENT_TIMESTAMP
);

create table public.event_outbox (
  id character varying(36) primary key not null,
  event_type character varying(64) not null,
  payload json not null,
  status character varying(32) default 'pending',
  created_at timestamp without time zone default CURRENT_TIMESTAMP
);

create table public.message (
  id character varying(36) primary key not null,
  chat_id character varying(36) not null,
  role character varying(32) not null,
  content text not null,
  meta json,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  foreign key (chat_id) references public.chat (id)
  match simple on update no action on delete no action
);

create table public.request_form (
  id character varying(36) primary key not null,
  chat_id character varying(36) not null,
  version integer not null default 1,
  status character varying(32) not null,
  summary text,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  updated_at timestamp without time zone default CURRENT_TIMESTAMP,
  foreign key (chat_id) references public.chat (id)
  match simple on update no action on delete no action
);

create table public.request_form_item (
  id character varying(36) primary key not null,
  form_id character varying(36) not null,
  type character varying(32) not null,
  status character varying(32) not null,
  agent character varying(32),
  priority integer default 0,
  payload json not null,
  parent_item_id character varying(36),
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  updated_at timestamp without time zone default CURRENT_TIMESTAMP,
  foreign key (form_id) references public.request_form (id)
  match simple on update no action on delete no action
);


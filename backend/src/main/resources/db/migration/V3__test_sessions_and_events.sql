create table if not exists test_session (
  id uuid primary key,
  athlete_ref text,
  mode varchar(16) not null,      -- BASELINE / ACTIVE
  status varchar(16) not null,    -- CREATED / RUNNING / COMPLETE
  created_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists test_event (
  id bigserial primary key,
  session_id uuid not null references test_session(id) on delete cascade,
  t_epoch_ms bigint not null,
  type varchar(32) not null,
  task varchar(32),
  trial integer,
  payload jsonb
);

create index if not exists idx_test_event_session on test_event(session_id);
create index if not exists idx_test_event_time on test_event(session_id, t_epoch_ms);

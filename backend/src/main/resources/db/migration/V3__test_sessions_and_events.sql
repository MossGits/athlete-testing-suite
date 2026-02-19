-- V3__test_sessions_and_events.sql

drop table if exists test_event cascade;
drop table if exists test_session cascade;

create table test_session (
  id uuid primary key,
  athlete_ref text,
  mode varchar(16) not null,
  status varchar(16) not null,
  created_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table test_event (
  id bigserial primary key,
  session_id uuid not null references test_session(id) on delete cascade,
  t_epoch_ms bigint not null,
  type varchar(32) not null,
  task varchar(32),
  trial integer,
  payload jsonb
);

create index idx_test_event_session on test_event(session_id);
create index idx_test_event_time on test_event(session_id, t_epoch_ms);

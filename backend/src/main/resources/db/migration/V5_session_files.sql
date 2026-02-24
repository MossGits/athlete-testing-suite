-- V5__session_files.sql
-- Store gzipped CSV (or other) files per test_session

create table if not exists session_file (
  id bigserial primary key,
  session_id uuid not null references test_session(id) on delete cascade,

  -- EEG / PPG / ACC / GYRO / MARKERS / etc.
  kind varchar(32) not null,

  filename text not null,
  content_type text not null,
  content_encoding varchar(32) not null default 'gzip',

  size_bytes bigint not null,
  sha256 text,

  data bytea not null,
  created_at timestamptz not null default now(),

  unique(session_id, kind)
);

create index if not exists idx_session_file_session on session_file(session_id);

alter table chatbot_settings add column if not exists worker_last_seen_at timestamptz;

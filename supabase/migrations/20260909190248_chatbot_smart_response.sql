alter table chatbot_settings
  drop constraint if exists chatbot_settings_trigger_mode_check;

alter table chatbot_settings
  add constraint chatbot_settings_trigger_mode_check
  check (trigger_mode in ('mention_dm', 'called_or_topic', 'auto_response'));

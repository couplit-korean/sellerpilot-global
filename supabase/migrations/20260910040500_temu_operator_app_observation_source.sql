-- Valid UTC migration sequence: 03:30:00 -> 04:05:00.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table sellerpilot_private.temu_create_app_gate_observations
  add column if not exists source text not null
  default 'operator_attested_authenticated_partner_ui_v1';
alter table sellerpilot_private.temu_create_app_gate_observations
  add constraint temu_create_app_gate_source_exact check (
    source='operator_attested_authenticated_partner_ui_v1'
  );
commit;

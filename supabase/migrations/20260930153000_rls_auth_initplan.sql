-- Wrap auth.* and security-definer helpers in scalar subqueries so RLS uses InitPlan
-- (see https://supabase.com/docs/guides/database/postgres/row-level-security).

drop policy if exists action_logs_insert on public.action_logs;

create policy action_logs_insert
  on public.action_logs
  for insert
  to authenticated
  with check (
    (select public.is_active_staff())
    and (actor_id = (select auth.uid()) or actor_id is null)
  );

drop policy if exists action_logs_select on public.action_logs;

create policy action_logs_select
  on public.action_logs
  for select
  to authenticated
  using (
    (select public.is_active_staff())
    and (
      actor_id = (select auth.uid())
      or (select public.current_user_is_system_admin())
      or exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.app_role in ('general_manager', 'branch_manager')
      )
    )
  );

drop policy if exists bullion_night_counts_delete on public.bullion_night_counts;

create policy bullion_night_counts_delete
  on public.bullion_night_counts
  for delete
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists bullion_night_counts_insert on public.bullion_night_counts;

create policy bullion_night_counts_insert
  on public.bullion_night_counts
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists bullion_night_counts_select on public.bullion_night_counts;

create policy bullion_night_counts_select
  on public.bullion_night_counts
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists bullion_night_counts_update on public.bullion_night_counts;

create policy bullion_night_counts_update
  on public.bullion_night_counts
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists company_ai_keys_delete on public.company_ai_keys;

create policy company_ai_keys_delete
  on public.company_ai_keys
  for delete
  to authenticated
  using ((select public.current_user_can_manage_company_ai_keys()));

drop policy if exists company_ai_keys_insert on public.company_ai_keys;

create policy company_ai_keys_insert
  on public.company_ai_keys
  for insert
  to authenticated
  with check ((select public.current_user_can_manage_company_ai_keys()));

drop policy if exists company_ai_keys_select on public.company_ai_keys;

create policy company_ai_keys_select
  on public.company_ai_keys
  for select
  to authenticated
  using ((select public.current_user_can_manage_company_ai_keys()));

drop policy if exists company_ai_keys_update on public.company_ai_keys;

create policy company_ai_keys_update
  on public.company_ai_keys
  for update
  to authenticated
  using ((select public.current_user_can_manage_company_ai_keys()))
  with check ((select public.current_user_can_manage_company_ai_keys()));

drop policy if exists dm_conversation_hides_delete on public.dm_conversation_hides;

create policy dm_conversation_hides_delete
  on public.dm_conversation_hides
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dm_conversation_hides_insert on public.dm_conversation_hides;

create policy dm_conversation_hides_insert
  on public.dm_conversation_hides
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.dm_is_participant(conversation_id))
  );

drop policy if exists dm_conversation_hides_select on public.dm_conversation_hides;

create policy dm_conversation_hides_select
  on public.dm_conversation_hides
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dm_conversations_select on public.dm_conversations;

create policy dm_conversations_select
  on public.dm_conversations
  for select
  to authenticated
  using ((select public.dm_is_participant(id)));

drop policy if exists dm_hides_delete on public.dm_message_hides;

create policy dm_hides_delete
  on public.dm_message_hides
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dm_hides_insert on public.dm_message_hides;

create policy dm_hides_insert
  on public.dm_message_hides
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.dm_messages m
      where m.id = message_id
        and (select public.dm_is_participant(m.conversation_id))
    )
  );

drop policy if exists dm_hides_select on public.dm_message_hides;

create policy dm_hides_select
  on public.dm_message_hides
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dm_likes_delete on public.dm_message_likes;

create policy dm_likes_delete
  on public.dm_message_likes
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dm_likes_insert on public.dm_message_likes;

create policy dm_likes_insert
  on public.dm_message_likes
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.dm_messages m
      where m.id = message_id
        and (select public.dm_is_participant(m.conversation_id))
    )
  );

drop policy if exists dm_likes_select on public.dm_message_likes;

create policy dm_likes_select
  on public.dm_message_likes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.dm_messages m
      where m.id = dm_message_likes.message_id
        and (select public.dm_is_participant(m.conversation_id))
    )
  );

drop policy if exists dm_messages_delete on public.dm_messages;

create policy dm_messages_delete
  on public.dm_messages
  for delete
  to authenticated
  using (sender_id = (select auth.uid()) and (select public.dm_is_participant(conversation_id)));

drop policy if exists dm_messages_insert on public.dm_messages;

create policy dm_messages_insert
  on public.dm_messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select public.dm_is_participant(conversation_id))
  );

drop policy if exists dm_messages_select on public.dm_messages;

create policy dm_messages_select
  on public.dm_messages
  for select
  to authenticated
  using ((select public.dm_is_participant(conversation_id)));

drop policy if exists dm_pairs_select on public.dm_pairs;

create policy dm_pairs_select
  on public.dm_pairs
  for select
  to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

drop policy if exists dm_participants_select on public.dm_participants;

create policy dm_participants_select
  on public.dm_participants
  for select
  to authenticated
  using ((select public.dm_is_participant(conversation_id)));

drop policy if exists dm_participants_update on public.dm_participants;

create policy dm_participants_update
  on public.dm_participants
  for update
  to authenticated
  using (user_id = (select auth.uid()) and (select public.dm_is_participant(conversation_id)))
  with check (user_id = (select auth.uid()) and (select public.dm_is_participant(conversation_id)));

drop policy if exists dm_presence_insert on public.dm_presence;

create policy dm_presence_insert
  on public.dm_presence
  for insert
  to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_staff()));

drop policy if exists dm_presence_select on public.dm_presence;

create policy dm_presence_select
  on public.dm_presence
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists dm_presence_update on public.dm_presence;

create policy dm_presence_update
  on public.dm_presence
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists moneris_terminals_delete on public.moneris_terminals;

create policy moneris_terminals_delete
  on public.moneris_terminals
  for delete
  to authenticated
  using ((select public.current_user_can_manage_store_settings()));

drop policy if exists moneris_terminals_insert on public.moneris_terminals;

create policy moneris_terminals_insert
  on public.moneris_terminals
  for insert
  to authenticated
  with check ((select public.current_user_can_manage_store_settings()));

drop policy if exists moneris_terminals_select on public.moneris_terminals;

create policy moneris_terminals_select
  on public.moneris_terminals
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists moneris_terminals_update on public.moneris_terminals;

create policy moneris_terminals_update
  on public.moneris_terminals
  for update
  to authenticated
  using ((select public.current_user_can_manage_store_settings()))
  with check ((select public.current_user_can_manage_store_settings()));

drop policy if exists moneris_transactions_delete on public.moneris_transactions;

create policy moneris_transactions_delete
  on public.moneris_transactions
  for delete
  to authenticated
  using ((select public.current_user_can_manage_store_settings()));

drop policy if exists moneris_transactions_insert on public.moneris_transactions;

create policy moneris_transactions_insert
  on public.moneris_transactions
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists moneris_transactions_select on public.moneris_transactions;

create policy moneris_transactions_select
  on public.moneris_transactions
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists moneris_transactions_update on public.moneris_transactions;

create policy moneris_transactions_update
  on public.moneris_transactions
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists price_check_settings_select on public.price_check_settings;

create policy price_check_settings_select
  on public.price_check_settings
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists price_check_settings_write on public.price_check_settings;

create policy price_check_settings_write
  on public.price_check_settings
  for all
  to authenticated
  using ((select public.current_user_can_manage_company_ai_keys()))
  with check ((select public.current_user_can_manage_company_ai_keys()));

drop policy if exists profile_notes_delete on public.profile_notes;

create policy profile_notes_delete
  on public.profile_notes
  for delete
  to authenticated
  using (author_id = (select auth.uid()) or profile_id = (select auth.uid()));

drop policy if exists profile_notes_insert on public.profile_notes;

create policy profile_notes_insert
  on public.profile_notes
  for insert
  to authenticated
  with check (
    (select public.is_active_staff())
    and (author_id = (select auth.uid()) or author_id is null)
  );

drop policy if exists profile_notes_select on public.profile_notes;

create policy profile_notes_select
  on public.profile_notes
  for select
  to authenticated
  using (
    (select public.is_active_staff())
    and (profile_id = (select auth.uid()) or author_id = (select auth.uid()))
  );

drop policy if exists profile_notes_update on public.profile_notes;

create policy profile_notes_update
  on public.profile_notes
  for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists profile_photo_comments_delete on public.profile_photo_comments;

create policy profile_photo_comments_delete
  on public.profile_photo_comments
  for delete
  to authenticated
  using (user_id = (select auth.uid()) or profile_id = (select auth.uid()));

drop policy if exists profile_photo_comments_insert on public.profile_photo_comments;

create policy profile_photo_comments_insert
  on public.profile_photo_comments
  for insert
  to authenticated
  with check (
    (user_id = (select auth.uid()) or user_id is null)
    and (select public.is_active_staff())
  );

drop policy if exists profile_photo_comments_select on public.profile_photo_comments;

create policy profile_photo_comments_select
  on public.profile_photo_comments
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists profile_photo_likes_delete on public.profile_photo_likes;

create policy profile_photo_likes_delete
  on public.profile_photo_likes
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists profile_photo_likes_insert on public.profile_photo_likes;

create policy profile_photo_likes_insert
  on public.profile_photo_likes
  for insert
  to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_staff()));

drop policy if exists profile_photo_likes_select on public.profile_photo_likes;

create policy profile_photo_likes_select
  on public.profile_photo_likes
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists profiles_select_own_or_admin on public.profiles;

create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (
    (select public.is_active_staff())
    and (id = (select auth.uid()) or (select public.current_user_can_view_staff_directory()))
  );

drop policy if exists profiles_update_admin on public.profiles;

create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using ((select public.current_user_is_system_admin()))
  with check ((select public.current_user_is_system_admin()));

drop policy if exists profiles_update_own on public.profiles;

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select public.is_active_staff()) and id = (select auth.uid()))
  with check ((select public.is_active_staff()) and id = (select auth.uid()));

drop policy if exists ringcentral_accounts_delete on public.ringcentral_accounts;

create policy ringcentral_accounts_delete
  on public.ringcentral_accounts
  for delete
  to authenticated
  using ((select public.current_user_can_manage_store_settings()));

drop policy if exists ringcentral_accounts_insert on public.ringcentral_accounts;

create policy ringcentral_accounts_insert
  on public.ringcentral_accounts
  for insert
  to authenticated
  with check ((select public.current_user_can_manage_store_settings()));

drop policy if exists ringcentral_accounts_select on public.ringcentral_accounts;

create policy ringcentral_accounts_select
  on public.ringcentral_accounts
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists ringcentral_accounts_update on public.ringcentral_accounts;

create policy ringcentral_accounts_update
  on public.ringcentral_accounts
  for update
  to authenticated
  using ((select public.current_user_can_manage_store_settings()))
  with check ((select public.current_user_can_manage_store_settings()));

drop policy if exists rippling_clock_status_select on public.rippling_clock_status;

create policy rippling_clock_status_select
  on public.rippling_clock_status
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists rippling_csv_files_select on public.rippling_csv_files;

create policy rippling_csv_files_select
  on public.rippling_csv_files
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists rippling_report_snapshot_select on public.rippling_report_snapshot;

create policy rippling_report_snapshot_select
  on public.rippling_report_snapshot
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists rippling_shift_roles_select on public.rippling_shift_roles;

create policy rippling_shift_roles_select
  on public.rippling_shift_roles
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists rippling_time_entries_select on public.rippling_time_entries;

create policy rippling_time_entries_select
  on public.rippling_time_entries
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists role_app_access_insert on public.role_app_access;

create policy role_app_access_insert
  on public.role_app_access
  for insert
  to authenticated
  with check ((select public.current_user_is_system_admin()));

drop policy if exists role_app_access_select on public.role_app_access;

create policy role_app_access_select
  on public.role_app_access
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists role_app_access_update on public.role_app_access;

create policy role_app_access_update
  on public.role_app_access
  for update
  to authenticated
  using ((select public.current_user_is_system_admin()))
  with check ((select public.current_user_is_system_admin()));

drop policy if exists staff_email_recipients_select on public.staff_email_recipients;

create policy staff_email_recipients_select
  on public.staff_email_recipients
  for select
  to authenticated
  using ((select public.staff_email_visible(email_id)));

drop policy if exists staff_email_recipients_update on public.staff_email_recipients;

create policy staff_email_recipients_update
  on public.staff_email_recipients
  for update
  to authenticated
  using (user_id = (select auth.uid()) and (select public.staff_email_visible(email_id)))
  with check (user_id = (select auth.uid()) and (select public.staff_email_visible(email_id)));

drop policy if exists staff_emails_select on public.staff_emails;

create policy staff_emails_select
  on public.staff_emails
  for select
  to authenticated
  using ((select public.staff_email_visible(id)));

drop policy if exists store_cash_counts_delete on public.store_cash_counts;

create policy store_cash_counts_delete
  on public.store_cash_counts
  for delete
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists store_cash_counts_insert on public.store_cash_counts;

create policy store_cash_counts_insert
  on public.store_cash_counts
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists store_cash_counts_select on public.store_cash_counts;

create policy store_cash_counts_select
  on public.store_cash_counts
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists store_cash_counts_update on public.store_cash_counts;

create policy store_cash_counts_update
  on public.store_cash_counts
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists store_settings_insert on public.store_settings;

create policy store_settings_insert
  on public.store_settings
  for insert
  to authenticated
  with check ((select public.current_user_can_manage_store_settings()));

drop policy if exists store_settings_select on public.store_settings;

create policy store_settings_select
  on public.store_settings
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists store_settings_update on public.store_settings;

create policy store_settings_update
  on public.store_settings
  for update
  to authenticated
  using ((select public.current_user_can_manage_store_settings()))
  with check ((select public.current_user_can_manage_store_settings()));

drop policy if exists teams_delete on public.teams;

create policy teams_delete
  on public.teams for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists teams_insert on public.teams;

create policy teams_insert
  on public.teams for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists teams_select on public.teams;

create policy teams_select
  on public.teams for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists teams_update on public.teams;

create policy teams_update
  on public.teams for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists trade_capture_sessions_insert_own on public.trade_capture_sessions;

create policy trade_capture_sessions_insert_own
  on public.trade_capture_sessions
  for insert
  to authenticated
  with check ((select public.is_active_staff()) and created_by = (select auth.uid()));

drop policy if exists trade_capture_sessions_select_own on public.trade_capture_sessions;

create policy trade_capture_sessions_select_own
  on public.trade_capture_sessions
  for select
  to authenticated
  using ((select public.is_active_staff()) and created_by = (select auth.uid()));

drop policy if exists transaction_cash_breakdowns_delete on public.transaction_cash_breakdowns;

create policy transaction_cash_breakdowns_delete
  on public.transaction_cash_breakdowns
  for delete
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists transaction_cash_breakdowns_insert on public.transaction_cash_breakdowns;

create policy transaction_cash_breakdowns_insert
  on public.transaction_cash_breakdowns
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists transaction_cash_breakdowns_select on public.transaction_cash_breakdowns;

create policy transaction_cash_breakdowns_select
  on public.transaction_cash_breakdowns
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists transaction_cash_breakdowns_update on public.transaction_cash_breakdowns;

create policy transaction_cash_breakdowns_update
  on public.transaction_cash_breakdowns
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists transaction_price_checks_insert on public.transaction_price_checks;

create policy transaction_price_checks_insert
  on public.transaction_price_checks
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists transaction_price_checks_select on public.transaction_price_checks;

create policy transaction_price_checks_select
  on public.transaction_price_checks
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_allocations_delete on public.triage_allocations;

create policy triage_allocations_delete
  on public.triage_allocations for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_allocations_insert on public.triage_allocations;

create policy triage_allocations_insert
  on public.triage_allocations for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists triage_allocations_select on public.triage_allocations;

create policy triage_allocations_select
  on public.triage_allocations for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_allocations_update on public.triage_allocations;

create policy triage_allocations_update
  on public.triage_allocations for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists triage_batches_delete on public.triage_batches;

create policy triage_batches_delete
  on public.triage_batches for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_batches_insert on public.triage_batches;

create policy triage_batches_insert
  on public.triage_batches for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists triage_batches_select on public.triage_batches;

create policy triage_batches_select
  on public.triage_batches for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_batches_update on public.triage_batches;

create policy triage_batches_update
  on public.triage_batches for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists triage_daily_receipts_delete on public.triage_daily_receipts;

create policy triage_daily_receipts_delete
  on public.triage_daily_receipts for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_daily_receipts_insert on public.triage_daily_receipts;

create policy triage_daily_receipts_insert
  on public.triage_daily_receipts for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists triage_daily_receipts_select on public.triage_daily_receipts;

create policy triage_daily_receipts_select
  on public.triage_daily_receipts for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_daily_receipts_update on public.triage_daily_receipts;

create policy triage_daily_receipts_update
  on public.triage_daily_receipts for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists triage_deleted_delete on public.triage_deleted;

create policy triage_deleted_delete
  on public.triage_deleted for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_deleted_insert on public.triage_deleted;

create policy triage_deleted_insert
  on public.triage_deleted for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists triage_deleted_select on public.triage_deleted;

create policy triage_deleted_select
  on public.triage_deleted for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_deleted_update on public.triage_deleted;

create policy triage_deleted_update
  on public.triage_deleted for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists triage_error_types_delete on public.triage_error_types;

create policy triage_error_types_delete
  on public.triage_error_types for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_error_types_insert on public.triage_error_types;

create policy triage_error_types_insert
  on public.triage_error_types for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists triage_error_types_select on public.triage_error_types;

create policy triage_error_types_select
  on public.triage_error_types for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_error_types_update on public.triage_error_types;

create policy triage_error_types_update
  on public.triage_error_types for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists triage_meta_delete on public.triage_meta;

create policy triage_meta_delete
  on public.triage_meta for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_meta_insert on public.triage_meta;

create policy triage_meta_insert
  on public.triage_meta for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists triage_meta_select on public.triage_meta;

create policy triage_meta_select
  on public.triage_meta for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_meta_update on public.triage_meta;

create policy triage_meta_update
  on public.triage_meta for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists triage_planned_delete on public.triage_planned;

create policy triage_planned_delete
  on public.triage_planned for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_planned_insert on public.triage_planned;

create policy triage_planned_insert
  on public.triage_planned for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists triage_planned_select on public.triage_planned;

create policy triage_planned_select
  on public.triage_planned for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_planned_update on public.triage_planned;

create policy triage_planned_update
  on public.triage_planned for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists triage_reviews_delete on public.triage_reviews;

create policy triage_reviews_delete
  on public.triage_reviews for delete to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_reviews_insert on public.triage_reviews;

create policy triage_reviews_insert
  on public.triage_reviews for insert to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists triage_reviews_select on public.triage_reviews;

create policy triage_reviews_select
  on public.triage_reviews for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists triage_reviews_update on public.triage_reviews;

create policy triage_reviews_update
  on public.triage_reviews for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists user_app_access_delete on public.user_app_access;

create policy user_app_access_delete
  on public.user_app_access
  for delete
  to authenticated
  using ((select public.current_user_is_system_admin()));

drop policy if exists user_app_access_insert on public.user_app_access;

create policy user_app_access_insert
  on public.user_app_access
  for insert
  to authenticated
  with check ((select public.current_user_is_system_admin()));

drop policy if exists user_app_access_select on public.user_app_access;

create policy user_app_access_select
  on public.user_app_access
  for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.current_user_is_system_admin()));

drop policy if exists user_app_access_update on public.user_app_access;

create policy user_app_access_update
  on public.user_app_access
  for update
  to authenticated
  using ((select public.current_user_is_system_admin()))
  with check ((select public.current_user_is_system_admin()));

drop policy if exists website_price_snapshots_select on public.website_price_snapshots;

create policy website_price_snapshots_select
  on public.website_price_snapshots
  for select
  to authenticated
  using ((select public.is_active_staff()));

drop policy if exists website_price_snapshots_update on public.website_price_snapshots;

create policy website_price_snapshots_update
  on public.website_price_snapshots
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

drop policy if exists website_price_snapshots_write on public.website_price_snapshots;

create policy website_price_snapshots_write
  on public.website_price_snapshots
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

drop policy if exists avatars_own_delete on storage.objects;

create policy avatars_own_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

drop policy if exists avatars_own_insert on storage.objects;

create policy avatars_own_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

drop policy if exists avatars_own_update on storage.objects;

create policy avatars_own_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  )
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

drop policy if exists trade_line_photos_own_delete on storage.objects;

create policy trade_line_photos_own_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'trade-line-photos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

drop policy if exists trade_line_photos_own_insert on storage.objects;

create policy trade_line_photos_own_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'trade-line-photos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

drop policy if exists trade_line_photos_own_update on storage.objects;

create policy trade_line_photos_own_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'trade-line-photos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  )
  with check (
    bucket_id = 'trade-line-photos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

drop policy if exists triage_error_photos_own_delete on storage.objects;

create policy triage_error_photos_own_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'triage-error-photos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

drop policy if exists triage_error_photos_own_insert on storage.objects;

create policy triage_error_photos_own_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'triage-error-photos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

drop policy if exists triage_error_photos_own_update on storage.objects;

create policy triage_error_photos_own_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'triage-error-photos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  )
  with check (
    bucket_id = 'triage-error-photos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and (select public.is_active_staff())
  );

notify pgrst, 'reload schema';

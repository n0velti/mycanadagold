-- Raise triage error photo uploads from 5 MB to 20 MB.
-- Apply on live Supabase only with Edward's OK. This PR does not run it.

update storage.buckets
set file_size_limit = 20971520
where id = 'triage-error-photos';

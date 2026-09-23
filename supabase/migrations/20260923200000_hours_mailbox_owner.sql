-- Hours CSV is read from edward.anuichi@canadagold.ca.
-- A Google token saved for any other inbox cannot read that mail, so drop it.
update public.rippling_time_sync
set
  gmail_refresh_token = case
    when lower(gmail_email) = 'edward.anuichi@canadagold.ca' then gmail_refresh_token
    else ''
  end,
  gmail_access_token = case
    when lower(gmail_email) = 'edward.anuichi@canadagold.ca' then gmail_access_token
    else ''
  end,
  gmail_token_expires_at = case
    when lower(gmail_email) = 'edward.anuichi@canadagold.ca' then gmail_token_expires_at
    else null
  end,
  last_error = case
    when lower(gmail_email) = 'edward.anuichi@canadagold.ca' then last_error
    else ''
  end,
  gmail_email = 'edward.anuichi@canadagold.ca'
where id = true;

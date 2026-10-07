-- Accept JPEG aliases plus PNG on triage error photos.
-- HEIC is converted to JPEG in the app before upload.

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
where id = 'triage-error-photos';

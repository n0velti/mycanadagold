-- Phone camera originals often exceed the original 5 MB cap on triage error photos.

update storage.buckets
set file_size_limit = 26214400
where id = 'triage-error-photos';

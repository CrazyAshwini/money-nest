-- Read-only inventory for a separately approved hosted rollout review.
-- Returns schema/policy metadata only; does not read users or financial records.
-- Compare with docs/public-multi-user-review/local-rls-inventory.json.
begin read only;

select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as forced_rls,
       has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_has_access
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

select c.relname as view_name, c.reloptions,
       coalesce(c.reloptions @> array['security_invoker=true'], false) as uses_invoker
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v' and left(c.relname, 4) = 'api_'
order by c.relname;

select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
order by n.nspname, p.proname, arguments;

select has_schema_privilege('anon', 'private', 'USAGE') as anon_private_schema_usage,
       has_schema_privilege('authenticated', 'private', 'USAGE') as user_private_schema_usage;

select id, public as bucket_is_public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'finance-documents';

select c.relrowsecurity as storage_objects_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'storage' and c.relname = 'objects';

select to_regclass('supabase_migrations.schema_migrations') is not null
       as migration_history_available;
-- If available, separately compare version/name metadata with the seven checked-in
-- migrations. Never run db reset, seed, bootstrap replacement or db push to audit.
rollback;

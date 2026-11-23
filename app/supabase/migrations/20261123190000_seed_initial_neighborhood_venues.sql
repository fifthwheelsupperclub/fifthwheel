-- Seed the venues shown in the initial Chamblee and Virginia Highlands itineraries.
-- Use a real admin as the creator and stable IDs so this is safe to reapply.
do $migration$
declare
  v_admin_id uuid;
begin
  select r.user_id into v_admin_id
  from public.app_user_roles r
  where r.role = 'admin'
  order by r.user_id
  limit 1;

  if v_admin_id is null then
    raise exception 'Cannot seed initial supply venues: no admin role exists.';
  end if;

  insert into public.app_supply_venues(venue_id,name,address,neighborhood,active,created_by)
  values
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d001001','Chamblee & Vine','5348 Peachtree Rd, Chamblee, GA 30341','Chamblee',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d001002','BLUETOP Restaurant','5362 Peachtree Rd, Chamblee, GA 30341','Chamblee',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d001003','Southbound','5394 Peachtree Rd, Chamblee, GA 30341','Chamblee',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d001004','Atkins Park','794 N Highland Ave NE, Atlanta, GA 30306','Virginia Highlands',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d001005','La Tavola Trattoria','992 Virginia Ave NE, Atlanta, GA 30306','Virginia Highlands',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d001006','Murphy''s Restaurant','997 Virginia Ave NE, Atlanta, GA 30306','Virginia Highlands',true,v_admin_id)
  on conflict (venue_id) do nothing;
end
$migration$;

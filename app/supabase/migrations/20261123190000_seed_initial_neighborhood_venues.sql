-- Import Airtable Venues from Chamblee, Inman Park, and Virginia-Highland.
-- Prospects remain visible in admin but unavailable for Table stops until verbally confirmed.
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
    raise exception 'Cannot import Airtable venues: no admin role exists.';
  end if;

  insert into public.app_supply_venues(venue_id,name,address,neighborhood,active,created_by)
  values
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002001','The Frosty Caboose','5435 Peachtree Rd, Chamblee, GA 30341','Chamblee',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002002','Antiguo Lobo','5370 Peachtree Rd Ste A, Chamblee, GA 30341','Chamblee',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002003','Sidetracked Wine Co.','3411 Pierce Dr, Chamblee, GA 30341','Chamblee',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002004','Hopstix','3404 Pierce Dr NE, Chamblee, GA 30341','Chamblee',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002005','Southbound','5394 Peachtree Rd, Chamblee, GA 30341','Chamblee',true,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002006','Barcelona Wine Bar','240 N Highland Ave NE, Atlanta, GA 30307','Inman Park',false,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002007','Voga Italian Gelato','299 N Highland Ave NE Ste G, Atlanta, GA 30307','Inman Park',false,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002008','Jeni''s Splendid Ice Creams','99 Krog St NE, Atlanta, GA 30307','Inman Park',false,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002009','Sotto Sotto','313 N Highland Ave NE, Atlanta, GA 30307','Inman Park',false,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002010','Osteria 832','832 N Highland Ave NE, Atlanta, GA 30306','Virginia Highlands',false,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002011','Morelli''s Gourmet Ice Cream and Desserts','1002 N Highland Ave NE, Atlanta, GA 30306','Virginia Highlands',false,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002012','Atkins Park Restaurant & Bar','794 N Highland Ave NE, Atlanta, GA 30306','Virginia Highlands',false,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002013','La Tavola Trattoria','992 Virginia Ave NE, Atlanta, GA 30306','Virginia Highlands',false,v_admin_id),
    ('ac0d9500-7bb1-4e61-9d68-5b1a2d002014','Monks Meadery','579 N Highland Ave NE, Atlanta, GA 30307','Virginia Highlands',false,v_admin_id)
  on conflict (venue_id) do nothing;
end
$migration$;

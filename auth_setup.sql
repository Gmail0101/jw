-- ============================================================
-- Supabase Auth: 아이디 + 이름 + 비밀번호 방식
-- 기존 schedules / schedule_images 테이블이 있는 프로젝트용
-- 이메일은 사용자에게 받지 않고 내부용 이메일로 자동 생성합니다.
-- 예: hong123 -> hong123@scheduler.local.invalid
-- ============================================================

-- 1) 사용자 프로필/역할
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  display_name text,
  role text not null default 'user'
    check (role in ('admin', 'user')),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists approval_status text not null default 'pending';
alter table public.profiles drop constraint if exists profiles_approval_status_check;
alter table public.profiles add constraint profiles_approval_status_check check (approval_status in ('pending', 'approved', 'rejected'));

-- 기존 가입자는 계속 사용할 수 있도록 1회 승인 처리합니다.
update public.profiles set approval_status = 'approved' where approval_status = 'pending';
create unique index if not exists profiles_username_unique_idx
on public.profiles(username)
where username is not null;

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
on public.profiles for select to authenticated
using ((select public.is_admin()));

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- 2) 관리자 판별 함수
create schema if not exists private;

create or replace function private.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select private.is_admin();
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 3) 회원가입 시 profiles 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, username, display_name)
  values (
    new.id,
    new.email,
    lower(new.raw_user_meta_data ->> 'username'),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
  set email = excluded.email,
      username = coalesce(public.profiles.username, excluded.username),
      display_name = coalesce(public.profiles.display_name, excluded.display_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 4) 기존 Auth 사용자도 프로필 생성/보정
insert into public.profiles (id, email, username, display_name)
select
  u.id,
  u.email,
  lower(u.raw_user_meta_data ->> 'username'),
  coalesce(
    u.raw_user_meta_data ->> 'display_name',
    split_part(coalesce(u.email, ''), '@', 1)
  )
from auth.users u
on conflict (id) do update
set email = excluded.email,
    username = coalesce(public.profiles.username, excluded.username),
    display_name = coalesce(public.profiles.display_name, excluded.display_name);

-- 5) 기존 schedules에 소유자 추가
alter table public.schedules
add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists schedules_user_id_idx
on public.schedules(user_id);

-- 6) 기존 정책 제거
drop policy if exists "scheduler_select" on public.schedules;
drop policy if exists "scheduler_insert" on public.schedules;
drop policy if exists "scheduler_update" on public.schedules;
drop policy if exists "scheduler_delete" on public.schedules;
drop policy if exists "schedules_select" on public.schedules;
drop policy if exists "schedules_insert" on public.schedules;
drop policy if exists "schedules_update" on public.schedules;
drop policy if exists "schedules_delete" on public.schedules;

drop policy if exists "schedule_images_select" on public.schedule_images;
drop policy if exists "schedule_images_insert" on public.schedule_images;
drop policy if exists "schedule_images_update" on public.schedule_images;
drop policy if exists "schedule_images_delete" on public.schedule_images;

-- 7) schedules RLS
alter table public.schedules enable row level security;
revoke all on table public.schedules from anon, authenticated;
grant select, insert, update, delete on table public.schedules to authenticated;
grant usage, select on sequence public.schedules_id_seq to authenticated;

create policy "schedules_select"
on public.schedules for select to authenticated
using (
  (select public.is_admin())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved')
);

create policy "schedules_insert"
on public.schedules for insert to authenticated
with check (
  (select public.is_admin())
  or (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
);

create policy "schedules_update"
on public.schedules for update to authenticated
using (
  (select public.is_admin())
  or (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
)
with check (
  (select public.is_admin())
  or (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
);

create policy "schedules_delete"
on public.schedules for delete to authenticated
using (
  (select public.is_admin())
  or (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
);

-- 8) schedule_images RLS
alter table public.schedule_images enable row level security;
revoke all on table public.schedule_images from anon, authenticated;
grant select, insert, update, delete on table public.schedule_images to authenticated;
grant usage, select on sequence public.schedule_images_id_seq to authenticated;

create policy "schedule_images_select"
on public.schedule_images for select to authenticated
using (exists (
  select 1 from public.schedules s
  where s.id = schedule_images.schedule_id
    and (
      (select public.is_admin())
      or (s.user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
    )
));

create policy "schedule_images_insert"
on public.schedule_images for insert to authenticated
with check (exists (
  select 1 from public.schedules s
  where s.id = schedule_images.schedule_id
    and (
      (select public.is_admin())
      or (s.user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
    )
));

create policy "schedule_images_update"
on public.schedule_images for update to authenticated
using (exists (
  select 1 from public.schedules s
  where s.id = schedule_images.schedule_id
    and (
      (select public.is_admin())
      or (s.user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
    )
))
with check (exists (
  select 1 from public.schedules s
  where s.id = schedule_images.schedule_id
    and (
      (select public.is_admin())
      or (s.user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
    )
));

create policy "schedule_images_delete"
on public.schedule_images for delete to authenticated
using (exists (
  select 1 from public.schedules s
  where s.id = schedule_images.schedule_id
    and (
      (select public.is_admin())
      or (s.user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved'))
    )
));

-- 9) Storage 정책
-- schedule-images 버킷은 기존처럼 Public으로 두어 다운로드 URL을 사용할 수 있습니다.
-- 업로드/수정/삭제는 로그인 + 일정 소유자/관리자로 제한합니다.

drop policy if exists "schedule_images_upload" on storage.objects;
drop policy if exists "schedule_images_update" on storage.objects;
drop policy if exists "schedule_images_delete" on storage.objects;
drop policy if exists "schedule_images_upload_auth" on storage.objects;
drop policy if exists "schedule_images_update_auth" on storage.objects;
drop policy if exists "schedule_images_delete_auth" on storage.objects;

create policy "schedule_images_upload_auth"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'schedule-images'
  and ((select public.is_admin()) or exists (
    select 1 from public.schedules s
    where s.id::text = (storage.foldername(name))[1]
      and s.user_id = (select auth.uid())
      and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved')
  ))
);

create policy "schedule_images_update_auth"
on storage.objects for update to authenticated
using (
  bucket_id = 'schedule-images'
  and ((select public.is_admin()) or exists (
    select 1 from public.schedules s
    where s.id::text = (storage.foldername(name))[1]
      and s.user_id = (select auth.uid())
      and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved')
  ))
)
with check (bucket_id = 'schedule-images');

create policy "schedule_images_delete_auth"
on storage.objects for delete to authenticated
using (
  bucket_id = 'schedule-images'
  and ((select public.is_admin()) or exists (
    select 1 from public.schedules s
    where s.id::text = (storage.foldername(name))[1]
      and s.user_id = (select auth.uid())
      and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved')
  ))
);

-- 10) 현재 상태 확인
select count(*) as profiles from public.profiles;

-- ============================================================
-- 중요: 회원가입 전 Supabase Dashboard에서
-- Authentication > Providers > Email > Confirm email을 OFF로 설정하세요.
-- 이 버전은 사용자에게 실제 이메일을 받지 않기 때문에 이메일 인증을 사용할 수 없습니다.
-- ============================================================

-- 첫 관리자 지정: 회원가입 후 실제 아이디로 실행
-- update public.profiles set role = 'admin' where username = 'admin';

-- 기존 테스트 일정에 관리자 소유권 부여가 필요하면
-- update public.schedules
-- set user_id = (select id from public.profiles where username = 'admin')
-- where user_id is null;

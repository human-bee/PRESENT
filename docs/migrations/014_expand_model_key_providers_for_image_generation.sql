-- Migration: 014_expand_model_key_providers_for_image_generation
-- Description: Add fal and xai as first-class provider keys for BYOK and admin shared key storage.

alter table public.user_model_keys
  drop constraint if exists user_model_keys_provider_check;

alter table public.user_model_keys
  add constraint user_model_keys_provider_check
  check (provider in ('openai','anthropic','google','together','cerebras','fal','xai'));

alter table public.admin_model_shared_keys
  drop constraint if exists admin_model_shared_keys_provider_check;

alter table public.admin_model_shared_keys
  add constraint admin_model_shared_keys_provider_check
  check (provider in ('openai','anthropic','google','together','cerebras','fal','xai'));

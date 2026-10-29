-- Categories, tags and funds can be archived (hidden from pickers, kept for history).
-- Projects already archive through status = 'archived'. Names stay unique across
-- active and archived rows, so re-entering an archived name means restoring it.
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.funds ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
-- Uploading a before (or progress_*) photo must not flip the card or order
-- to in_progress. Admins attach befores before work starts; status stays
-- a manual / explicit-save decision. After → completed is unchanged.

DROP TRIGGER IF EXISTS card_images_in_progress_card_when_before ON public.card_images;
DROP FUNCTION IF EXISTS public.cards_in_progress_when_before_photo();

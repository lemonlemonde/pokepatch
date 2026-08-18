-- Unify former admin-uploaded card photos into the same image_type as
-- customer uploads so they share one photo pool in admin and My Orders.

UPDATE public.card_images
SET image_type = 'customer'
WHERE image_type = 'admin';

UPDATE public.card_images_original
SET image_type = 'customer'
WHERE image_type = 'admin';

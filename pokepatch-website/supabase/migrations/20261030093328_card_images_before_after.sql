-- Allow restoration before/after photos on order cards (Discord upload path).

ALTER TABLE public.card_images
  DROP CONSTRAINT IF EXISTS card_images_image_type_check;

ALTER TABLE public.card_images
  ADD CONSTRAINT card_images_image_type_check
  CHECK (
    image_type = ANY (
      ARRAY[
        'customer'::text,
        'admin'::text,
        'progress_front'::text,
        'progress_back'::text,
        'final_front'::text,
        'final_back'::text,
        'before'::text,
        'after'::text
      ]
    )
  );

ALTER TABLE public.card_images_original
  DROP CONSTRAINT IF EXISTS card_images_original_image_type_check;

ALTER TABLE public.card_images_original
  ADD CONSTRAINT card_images_original_image_type_check
  CHECK (
    image_type = ANY (
      ARRAY[
        'customer'::text,
        'admin'::text,
        'progress_front'::text,
        'progress_back'::text,
        'final_front'::text,
        'final_back'::text,
        'before'::text,
        'after'::text
      ]
    )
  );

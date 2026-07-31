-- Align informal gallery set_name labels with Pokémon TCG API set.name values.
-- Display titles stay customer-friendly; set_name is what we show under each item.

update public.gallery_items
set set_name = 'XY Black Star Promos'
where set_name = 'XY Promos';
update public.gallery_items
set set_name = 'EX Delta Species'
where set_name = 'Delta Species';
update public.gallery_items
set set_name = 'EX Unseen Forces'
where set_name = 'Unseen Forces';
update public.gallery_items
set set_name = 'Black & White'
where set_name = 'Black and White';
update public.gallery_items
set set_name = 'Crown Zenith Galarian Gallery'
where set_name = 'Crown Zenith: Galarian Gallery';

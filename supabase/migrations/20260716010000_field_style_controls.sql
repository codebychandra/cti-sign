alter table form_fields
  add column if not exists text_align text not null default 'left';

alter table form_fields
  add column if not exists font_size int not null default 11;

update form_fields
set text_align = 'left'
where text_align is null or text_align not in ('left', 'center', 'right');

update form_fields
set font_size = 11
where font_size is null or font_size < 6;

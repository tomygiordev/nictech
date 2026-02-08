-- Add column for additional images to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS additional_images TEXT[] DEFAULT '{}';

-- Allow updating this column (already covered by "Allow update for admin" policy if it covers all columns)

-- Migration: Add figma_link column to sdlc_backlog_items table
-- Date: 2025-01-17
-- Description: Adds a new TEXT column to store Figma design links for backlog items

ALTER TABLE sdlc_backlog_items
ADD COLUMN figma_link TEXT AFTER epic_id;

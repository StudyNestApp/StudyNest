-- Migration: Add password column to rooms table
ALTER TABLE "rooms" ADD COLUMN password TEXT;
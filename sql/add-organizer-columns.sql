-- Migration: add organizer name and email to Draws table
-- Run this once against your existing Azure SQL database.

ALTER TABLE Draws ADD organizer_name  NVARCHAR(200) NULL;
ALTER TABLE Draws ADD organizer_email NVARCHAR(320) NULL;

-- Migration: add admin_key column to Draws table
-- Run once against the existing Azure SQL database.

ALTER TABLE Draws ADD admin_key NVARCHAR(100) NULL;

-- Run this script once in your Azure SQL database to set up the schema.

CREATE TABLE Draws (
  -- UNIQUEIDENTIFIER prevents sequential ID enumeration and allows the ID to be
  -- generated client-side before the DB insert if ever needed
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  created_at DATETIME2 DEFAULT GETUTCDATE(),
  -- Nullable timestamps double as boolean flags: NULL = event hasn't occurred;
  -- non-NULL = the UTC timestamp when it did. Avoids a separate boolean column.
  emails_sent_at DATETIME2 NULL,
  deleted_at DATETIME2 NULL,
  -- Organizer fields are populated when emails are sent, not at draw creation
  organizer_name NVARCHAR(200) NULL,
  organizer_email NVARCHAR(320) NULL,
  -- Secret key included in the organizer's URL; required to send emails or delete.
  -- NULL until the draw page is first loaded and a key is generated.
  admin_key NVARCHAR(100) NULL
);

CREATE TABLE Participants (
  id INT IDENTITY(1,1) PRIMARY KEY,
  draw_id UNIQUEIDENTIFIER NOT NULL REFERENCES Draws(id),
  name NVARCHAR(200) NOT NULL,
  -- Email is stored as empty string '' when not provided (NOT NULL for schema
  -- simplicity); the API filters out empty emails before sending
  email NVARCHAR(320) NOT NULL,
  group_name NVARCHAR(200) NULL
);

CREATE TABLE Matches (
  id INT IDENTITY(1,1) PRIMARY KEY,
  draw_id UNIQUEIDENTIFIER NOT NULL REFERENCES Draws(id),
  -- INT references to Participants.id (internal join key); draw_id is denormalised
  -- here so matches can be fetched in a single indexed query without joining Draws
  giver_participant_id INT NOT NULL REFERENCES Participants(id),
  receiver_participant_id INT NOT NULL REFERENCES Participants(id)
);

-- Indexes on draw_id support the common query pattern: fetch all participants /
-- matches for a given draw
CREATE INDEX IX_Participants_DrawId ON Participants(draw_id);
CREATE INDEX IX_Matches_DrawId ON Matches(draw_id);

-- One row per UTC date; tracks aggregate emails sent against Gmail's daily limit.
-- DATE primary key means the MERGE in send-emails.ts can upsert atomically by date.
CREATE TABLE DailyEmailLog (
  log_date DATE PRIMARY KEY,
  emails_sent INT NOT NULL DEFAULT 0
);

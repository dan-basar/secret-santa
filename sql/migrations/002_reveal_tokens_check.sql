-- Read-only check for 002_reveal_tokens.sql. Run after the migration.
-- Expected: all three counts are equal (every participant has a unique token).

SELECT
     COUNT(*) as participantCount
    ,COUNT(participants.reveal_token) as withTokenCount
    ,COUNT(DISTINCT participants.reveal_token) as distinctTokenCount
FROM Participants as participants

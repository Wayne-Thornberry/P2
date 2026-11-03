-- A signed-in browser, kept in the database rather than in the app's memory so that a
-- deploy -- which recycles the app pool -- does not sign anyone out.
--
-- Only the SHA-256 of the token is stored: the token itself exists in the browser and
-- in the response that handed it over, and nowhere else.
CREATE TABLE [core].[Sessions]
(
    [TokenHash]  CHAR (64)     NOT NULL,
    [UserId]     INT           NOT NULL,
    [CreatedAt]  DATETIME2 (3) NOT NULL CONSTRAINT [DF_Sessions_CreatedAt] DEFAULT (SYSUTCDATETIME()),
    [LastSeenAt] DATETIME2 (3) NOT NULL CONSTRAINT [DF_Sessions_LastSeenAt] DEFAULT (SYSUTCDATETIME()),
    [ExpiresAt]  DATETIME2 (3) NOT NULL,
    CONSTRAINT [PK_Sessions] PRIMARY KEY CLUSTERED ([TokenHash]),
    CONSTRAINT [FK_Sessions_Users] FOREIGN KEY ([UserId]) REFERENCES [core].[Users] ([Id]) ON DELETE CASCADE
);
GO

-- Expired sessions are swept on sign-in, and this is what that sweep looks for.
CREATE NONCLUSTERED INDEX [IX_Sessions_ExpiresAt] ON [core].[Sessions] ([ExpiresAt]);

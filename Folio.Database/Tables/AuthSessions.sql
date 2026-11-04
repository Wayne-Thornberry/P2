-- One browser that has signed in.
--
-- The cookie holds a random token and this table holds only its SHA-256, so a copy of the
-- table is not a set of working sessions. Deleting the row signs that browser out, which
-- is what a password change does to every other one.
CREATE TABLE [auth].[Sessions]
(
    [Id]        INT           IDENTITY (1, 1) NOT NULL,
    [UserId]    INT           NOT NULL,
    [TokenHash] BINARY (32)   NOT NULL,
    [CreatedAt] DATETIME2 (3) NOT NULL CONSTRAINT [DF_Sessions_CreatedAt] DEFAULT (SYSUTCDATETIME()),
    [ExpiresAt] DATETIME2 (3) NOT NULL,
    [LastSeenAt] DATETIME2 (3) NOT NULL CONSTRAINT [DF_Sessions_LastSeenAt] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_Sessions] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_Sessions_TokenHash] UNIQUE ([TokenHash]),
    CONSTRAINT [FK_Sessions_Users] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [CK_Sessions_Expiry] CHECK ([ExpiresAt] > [CreatedAt])
);
GO

-- Every request with a cookie looks its session up by hash, and the sweep that clears
-- expired ones works through them by date.
CREATE NONCLUSTERED INDEX [IX_Sessions_ExpiresAt]
    ON [auth].[Sessions] ([ExpiresAt]);

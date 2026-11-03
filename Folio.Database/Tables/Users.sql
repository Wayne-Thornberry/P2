-- The account that signs in. One row, one person: this is a personal site.
CREATE TABLE [core].[Users]
(
    [Id]           INT           IDENTITY (1, 1) NOT NULL,
    [Username]     NVARCHAR (64) NOT NULL,
    [PasswordHash] NVARCHAR (256) NOT NULL,
    [CreatedAt]    DATETIME2 (3) NOT NULL CONSTRAINT [DF_Users_CreatedAt] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_Users_Username] UNIQUE ([Username])
);

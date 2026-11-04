-- One person who may sign in, and with what.
--
-- A password is a PBKDF2 hash and its own salt, never the password: nothing here can be
-- turned back into what was typed, and the two columns are what a sign-in compares.
--
-- ClaimedAt is what separates a real account from the placeholder a database made before
-- accounts existed carries: the placeholder owns whatever was saved before there was
-- anybody to own it, and claiming the first account is filling that row in rather than
-- moving rows from one owner to another. A user with ClaimedAt set is a user who can sign
-- in.
CREATE TABLE [auth].[Users]
(
    [Id]                 INT            IDENTITY (1, 1) NOT NULL,
    [Username]           NVARCHAR (32)  NOT NULL,
    [PasswordHash]       VARBINARY (32) NOT NULL,
    [PasswordSalt]       VARBINARY (16) NOT NULL,
    -- Set when the password was handed over rather than chosen: the site will not let
    -- anything else happen until it has been replaced.
    [MustChangePassword] BIT            NOT NULL CONSTRAINT [DF_Users_MustChangePassword] DEFAULT (1),
    -- The PIN is the way back in when the password is forgotten, so it is hashed exactly
    -- like one. Both columns are null until it is set.
    [PinHash]            VARBINARY (32) NULL,
    [PinSalt]            VARBINARY (16) NULL,
    -- Wrong PINs are counted rather than guessed at: the count resets when one is right,
    -- and a lockout is how long the guessing has to stop for.
    [PinFailedCount]     INT            NOT NULL CONSTRAINT [DF_Users_PinFailedCount] DEFAULT (0),
    [PinLockedUntil]     DATETIME2 (3)  NULL,
    [ClaimedAt]          DATETIME2 (3)  NULL,
    [CreatedAt]          DATETIME2 (3)  NOT NULL CONSTRAINT [DF_Users_CreatedAt] DEFAULT (SYSUTCDATETIME()),
    [PasswordChangedAt]  DATETIME2 (3)  NULL,
    [LastSignInAt]       DATETIME2 (3)  NULL,
    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id]),
    -- The collation is case-insensitive, so this is one account per name however it is typed.
    CONSTRAINT [UQ_Users_Username] UNIQUE ([Username]),
    CONSTRAINT [CK_Users_Username] CHECK (LEN([Username]) >= 3),
    CONSTRAINT [CK_Users_Pin] CHECK (([PinHash] IS NULL AND [PinSalt] IS NULL) OR ([PinHash] IS NOT NULL AND [PinSalt] IS NOT NULL)),
    CONSTRAINT [CK_Users_PinFailedCount] CHECK ([PinFailedCount] >= 0)
);
GO

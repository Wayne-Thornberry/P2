-- The next id for each client-side collection.
--
-- Folio's ids are small integers the browser allocates before anything is saved, and
-- several of them are shared between tables (a budget item id appears on transactions
-- and on budget assignments). Keeping the counters here means a reload, a second browser
-- or a deploy never hands out an id that is already in use.
CREATE TABLE [folio].[Counters]
(
    [UserId]  INT          NOT NULL,
    [Country] NVARCHAR (40) NOT NULL,
    [Name]    VARCHAR (40) NOT NULL,
    [Value]   INT          NOT NULL,
    CONSTRAINT [PK_Counters] PRIMARY KEY CLUSTERED ([UserId], [Country], [Name]),
    CONSTRAINT [FK_Counters_Users] FOREIGN KEY ([UserId]) REFERENCES [core].[Users] ([Id]) ON DELETE CASCADE
);
